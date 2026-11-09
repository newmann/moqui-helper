import * as fs from 'fs';
import * as path from 'path';
import { ScreenMember, memberId, sameMember } from '../index/screenMembers';
import { WorkspaceIndex } from '../index/workspace';
import { Range, SymbolRecord } from '../types';
import { MemberRef } from './classify';
import { resolveRuntimeScreenPath, resolveScreenLocation } from './resolve';

export interface MemberQuery {
  role: MemberRef['role'];
  lookup: string;
  range: Range;
  dynamic: boolean;
  location?: string;
  locationDynamic?: boolean;
  fragmentKind?: 'section' | 'form';
  formTag?: 'form-single' | 'form-list';
  formKey?: string;
}

export type MemberTarget =
  | { type: 'member'; member: ScreenMember }
  | { type: 'screen'; record: SymbolRecord };

export type MemberResolveResult =
  | { status: 'skip' }
  | { status: 'ok'; targets: MemberTarget[]; exclusive: boolean }
  | { status: 'missing'; range: Range; messageKey: string; messageArgs: string[] };

export function resolveMemberRef(ref: MemberQuery, fromFsPath: string, index: WorkspaceIndex): MemberResolveResult {
  if (ref.dynamic || ref.locationDynamic || !ref.lookup) {
    return { status: 'skip' };
  }
  switch (ref.role) {
    case 'transition':
      return resolveTransition(ref, fromFsPath, index);
    case 'url-name':
      return resolveUrlName(ref, fromFsPath, index);
    case 'screen-path':
      return resolveScreenPath(ref, fromFsPath, index);
    case 'transition-include':
      return resolveIncludedTransition(ref, fromFsPath, index);
    case 'section':
      return resolveSection(ref, fromFsPath, index);
    case 'fragment':
      return resolveFragment(ref, fromFsPath, index);
    case 'form':
      return resolveLocalForm(ref, fromFsPath, index);
    case 'subscreens-default':
      return resolveDefaultItem(ref, fromFsPath, index);
    case 'field':
      return resolveField(ref, fromFsPath, index);
    default:
      return { status: 'skip' };
  }
}

export function sameNameMembers(member: ScreenMember, index: WorkspaceIndex): ScreenMember[] {
  if (member.kind === 'field') {
    return index.membersIn(member.fsPath).filter(
      (item) => item.kind === 'field' && item.formKey === member.formKey && item.name === member.name,
    );
  }
  return index.screenScope(member.fsPath).filter((item) => {
    if (item.kind !== member.kind || item.name !== member.name) {
      return false;
    }
    if (member.kind === 'form' && item.tag !== member.tag) {
      return false;
    }
    return true;
  });
}

export function linkedTransitions(member: ScreenMember, index: WorkspaceIndex): ScreenMember[] | 'ambiguous' {
  if (member.kind !== 'transition') {
    return [member];
  }
  if (sameNameMembers(member, index).length > 1) {
    return 'ambiguous';
  }
  const linked = new Map<string, ScreenMember>();
  const consider = (item: ScreenMember): boolean => {
    if (item.kind !== 'transition' || sameNameMembers(item, index).length > 1) {
      return false;
    }
    linked.set(memberId(item), item);
    return true;
  };
  if (!consider(member)) {
    return 'ambiguous';
  }
  if (member.tag === 'transition-include') {
    const remote = includedTransition(member, index);
    if (remote === 'ambiguous') {
      return 'ambiguous';
    }
    if (remote && !consider(remote)) {
      return 'ambiguous';
    }
  }
  for (const ref of index.allMemberRefs()) {
    if (ref.role !== 'transition-include') {
      continue;
    }
    const resolved = resolveMemberRef(ref, ref.fsPath, index);
    if (resolved.status !== 'ok' || !resolved.exclusive) {
      continue;
    }
    const target = resolved.targets.find((item) => item.type === 'member');
    if (!target || target.type !== 'member' || !linked.has(memberId(target.member))) {
      continue;
    }
    const include = index.membersIn(ref.fsPath).find(
      (item) => item.tag === 'transition-include' && rangesEqual(item.nameRange, ref.range),
    );
    if (include && !consider(include)) {
      return 'ambiguous';
    }
  }
  return [...linked.values()];
}

export function fieldsOfForm(form: ScreenMember, index: WorkspaceIndex, seen = new Set<string>()): ScreenMember[] {
  const id = memberId(form);
  if (seen.has(id)) {
    return [];
  }
  seen.add(id);
  const own = index.membersIn(form.fsPath).filter((member) => member.kind === 'field' && member.formKey === form.formKey);
  const names = new Set(own.map((member) => member.name));
  const parent = findExtendedForm(form, index);
  if (!parent) {
    return own;
  }
  const inherited = fieldsOfForm(parent, index, seen).filter((member) => !names.has(member.name));
  return [...own, ...inherited];
}

function resolveTransition(ref: MemberQuery, fromFsPath: string, index: WorkspaceIndex): MemberResolveResult {
  const locals = index.screenScope(fromFsPath).filter((member) => member.kind === 'transition' && member.name === ref.lookup);
  if (locals.length > 0) {
    return memberResult(ref, locals);
  }
  if (ref.lookup.includes('/') || ref.lookup.includes('\\')) {
    return missing(ref, 'unresolvedTransition');
  }
  const child = path.normalize(path.join(path.dirname(fromFsPath), `${ref.lookup}.xml`));
  const screens = index.findScreensByPath(child);
  if (screens.length > 0) {
    return { status: 'ok', targets: screens.map((record) => ({ type: 'screen', record })), exclusive: screens.length === 1 };
  }
  const item = index.screenScope(fromFsPath).find(
    (member) => member.kind === 'subscreens-item' && member.name === ref.lookup,
  );
  if (item) {
    if (item.location && !item.location.includes('${')) {
      const resolved = resolveScreenLocation(item.location, item.fsPath, index);
      if (resolved.status === 'ok' && resolved.records.length > 0) {
        return {
          status: 'ok',
          targets: resolved.records.map((record) => ({ type: 'screen', record })),
          exclusive: resolved.records.length === 1,
        };
      }
    }
    return { status: 'ok', targets: [{ type: 'member', member: item }], exclusive: true };
  }
  if (isDirectory(path.join(path.dirname(fromFsPath), ref.lookup))) {
    return { status: 'skip' };
  }
  const nested = screensInMatchingDirectory(ref.lookup, fromFsPath, index);
  if (nested.length > 0) {
    return { status: 'ok', targets: nested.map((record) => ({ type: 'screen', record })), exclusive: nested.length === 1 };
  }
  if (matchingDirectoryHas(ref.lookup, fromFsPath, index)) {
    return { status: 'skip' };
  }
  return missing(ref, 'unresolvedTransition');
}

const BUILTIN_TRANSITIONS = new Set(['actions', 'formSelectColumns', 'formSaveFind', 'screenDoc']);

function resolveUrlName(ref: MemberQuery, fromFsPath: string, index: WorkspaceIndex): MemberResolveResult {
  const first = ref.lookup[0] ?? '';
  if (first >= 'a' && first <= 'z') {
    const locals = index
      .screenScope(fromFsPath)
      .filter((member) => member.kind === 'transition' && member.name === ref.lookup);
    if (locals.length > 0) {
      return memberResult(ref, locals);
    }
    if (BUILTIN_TRANSITIONS.has(ref.lookup)) {
      return { status: 'skip' };
    }
    return missing(ref, 'unresolvedTransition');
  }
  if (first >= 'A' && first <= 'Z') {
    const item = index.screenScope(fromFsPath).find(
      (member) => member.kind === 'subscreens-item' && member.name === ref.lookup,
    );
    if (item) {
      if (item.location && !item.location.includes('${')) {
        const resolved = resolveScreenLocation(item.location, item.fsPath, index);
        if (resolved.status === 'ok' && resolved.records.length > 0) {
          return screenResult(resolved.records);
        }
      }
      return { status: 'ok', targets: [{ type: 'member', member: item }], exclusive: true };
    }
    const nested = screensInMatchingDirectory(ref.lookup, fromFsPath, index);
    if (nested.length > 0) {
      return screenResult(nested);
    }
    return missing(ref, 'unresolvedScreen');
  }
  return { status: 'skip' };
}

function resolveScreenPath(ref: MemberQuery, fromFsPath: string, index: WorkspaceIndex): MemberResolveResult {
  if (isRemotePath(ref.lookup)) {
    return { status: 'skip' };
  }
  if (isDotScreenPath(ref.lookup)) {
    const resolved = resolveRuntimeScreenPath(ref.lookup, fromFsPath, index);
    if (resolved.status === 'skip') {
      return { status: 'skip' };
    }
    if (resolved.status === 'ok') {
      return screenResult(resolved.records);
    }
    return missing(ref, 'unresolvedScreen');
  }
  if (isLocationForm(ref.lookup)) {
    const resolved = resolveScreenLocation(ref.lookup, fromFsPath, index);
    if (resolved.status === 'skip') {
      return { status: 'skip' };
    }
    if (resolved.status === 'ok') {
      return screenResult(resolved.records);
    }
    return missing(ref, 'unresolvedScreen');
  }
  if (ref.lookup.includes('/') || ref.lookup.includes('\\')) {
    const absolute = path.normalize(path.resolve(path.dirname(fromFsPath), ref.lookup));
    const screens = screensAt(absolute, index);
    if (screens.length > 0) {
      return screenResult(screens);
    }
    return missing(ref, 'unresolvedScreen');
  }
  const child = path.normalize(path.join(path.dirname(fromFsPath), `${ref.lookup}.xml`));
  const screens = index.findScreensByPath(child);
  if (screens.length > 0) {
    return screenResult(screens);
  }
  const item = index.screenScope(fromFsPath).find(
    (member) => member.kind === 'subscreens-item' && member.name === ref.lookup,
  );
  if (item) {
    if (item.location && !item.location.includes('${')) {
      const resolved = resolveScreenLocation(item.location, item.fsPath, index);
      if (resolved.status === 'ok' && resolved.records.length > 0) {
        return screenResult(resolved.records);
      }
    }
    return { status: 'ok', targets: [{ type: 'member', member: item }], exclusive: true };
  }
  if (isDirectory(path.join(path.dirname(fromFsPath), ref.lookup))) {
    return { status: 'skip' };
  }
  const nested = screensInMatchingDirectory(ref.lookup, fromFsPath, index);
  if (nested.length > 0) {
    return screenResult(nested);
  }
  if (matchingDirectoryHas(ref.lookup, fromFsPath, index)) {
    return { status: 'skip' };
  }
  return missing(ref, 'unresolvedScreen');
}

function screenResult(records: SymbolRecord[]): MemberResolveResult {
  return {
    status: 'ok',
    targets: records.map((record) => ({ type: 'screen', record })),
    exclusive: records.length === 1,
  };
}

function screensAt(absolute: string, index: WorkspaceIndex): SymbolRecord[] {
  const direct = index.findScreensByPath(absolute);
  if (direct.length > 0) {
    return direct;
  }
  if (!absolute.toLowerCase().endsWith('.xml')) {
    return index.findScreensByPath(`${absolute}.xml`);
  }
  return [];
}

function isRemotePath(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('content:');
}

function isDotScreenPath(value: string): boolean {
  const query = value.indexOf('?');
  const target = (query < 0 ? value : value.slice(0, query)).trim();
  return target.startsWith('.');
}

function isLocationForm(value: string): boolean {
  return value.startsWith('component://') || value.startsWith('.') || value.startsWith('//');
}

function resolveIncludedTransition(ref: MemberQuery, fromFsPath: string, index: WorkspaceIndex): MemberResolveResult {
  if (!ref.location) {
    return { status: 'skip' };
  }
  const resolved = resolveScreenLocation(ref.location, fromFsPath, index);
  if (resolved.status !== 'ok') {
    return { status: 'skip' };
  }
  const matches: ScreenMember[] = [];
  for (const record of resolved.records) {
    const file = index.symbolPath(record);
    if (!file) {
      continue;
    }
    for (const member of index.screenScope(file)) {
      if (member.tag === 'transition' && member.name === ref.lookup && !matches.some((item) => sameMember(item, member))) {
        matches.push(member);
      }
    }
  }
  if (matches.length === 0) {
    return missing(ref, 'unresolvedTransition');
  }
  return memberResult(ref, matches);
}

function resolveSection(ref: MemberQuery, fromFsPath: string, index: WorkspaceIndex): MemberResolveResult {
  return sectionsInLocation(ref, fromFsPath, index);
}

function resolveFragment(ref: MemberQuery, fromFsPath: string, index: WorkspaceIndex): MemberResolveResult {
  if (ref.fragmentKind === 'form') {
    return formsInLocation(ref, fromFsPath, index);
  }
  return sectionsInLocation(ref, fromFsPath, index);
}

function resolveLocalForm(ref: MemberQuery, fromFsPath: string, index: WorkspaceIndex): MemberResolveResult {
  const matches = index.screenScope(fromFsPath).filter(
    (member) => member.kind === 'form' && member.tag === ref.formTag && member.name === ref.lookup,
  );
  if (matches.length === 0) {
    return missing(ref, 'unresolvedForm');
  }
  return memberResult(ref, matches);
}

function resolveDefaultItem(ref: MemberQuery, fromFsPath: string, index: WorkspaceIndex): MemberResolveResult {
  const items = index.screenScope(fromFsPath).filter(
    (member) => member.kind === 'subscreens-item' && member.name === ref.lookup,
  );
  if (items.length > 0) {
    return memberResult(ref, items);
  }
  if (!looksLikePath(ref.lookup)) {
    const nested = screensInMatchingDirectory(ref.lookup, fromFsPath, index);
    if (nested.length > 0) {
      return screenResult(nested);
    }
    return missing(ref, 'unresolvedSubscreensItem');
  }
  const resolved = resolveScreenLocation(ref.lookup, fromFsPath, index);
  if (resolved.status === 'skip') {
    return { status: 'skip' };
  }
  if (resolved.status === 'ok') {
    return {
      status: 'ok',
      targets: resolved.records.map((record) => ({ type: 'screen', record })),
      exclusive: resolved.records.length === 1,
    };
  }
  return missing(ref, 'unresolvedScreen');
}

function resolveField(ref: MemberQuery, fromFsPath: string, index: WorkspaceIndex): MemberResolveResult {
  const form = index.membersIn(fromFsPath).find((member) => member.kind === 'form' && member.formKey === ref.formKey);
  if (!form) {
    return { status: 'skip' };
  }
  const matches = fieldsOfForm(form, index).filter((member) => member.name === ref.lookup);
  if (matches.length === 0) {
    return missing(ref, 'unresolvedField');
  }
  return memberResult(ref, matches);
}

function sectionsInLocation(ref: MemberQuery, fromFsPath: string, index: WorkspaceIndex): MemberResolveResult {
  const files = filesOf(ref, fromFsPath, index);
  if (!files) {
    return { status: 'skip' };
  }
  const matches = membersIn(files, index).filter((member) => member.kind === 'section' && member.name === ref.lookup);
  if (matches.length === 0) {
    return missing(ref, 'unresolvedSection');
  }
  return memberResult(ref, matches);
}

function formsInLocation(ref: MemberQuery, fromFsPath: string, index: WorkspaceIndex): MemberResolveResult {
  const files = filesOf(ref, fromFsPath, index);
  if (!files) {
    return { status: 'skip' };
  }
  const matches = membersIn(files, index).filter(
    (member) => member.kind === 'form' && member.tag === ref.formTag && member.name === ref.lookup,
  );
  if (matches.length === 0) {
    return missing(ref, 'unresolvedForm');
  }
  return memberResult(ref, matches);
}

function filesOf(ref: MemberQuery, fromFsPath: string, index: WorkspaceIndex): string[] | undefined {
  if (!ref.location) {
    return undefined;
  }
  const resolved = resolveScreenLocation(ref.location, fromFsPath, index);
  if (resolved.status !== 'ok') {
    return undefined;
  }
  const files: string[] = [];
  for (const record of resolved.records) {
    const file = index.symbolPath(record);
    if (file && !files.includes(file)) {
      files.push(file);
    }
  }
  return files;
}

function membersIn(files: readonly string[], index: WorkspaceIndex): ScreenMember[] {
  const members: ScreenMember[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const member of index.screenScope(file)) {
      const id = memberId(member);
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      members.push(member);
    }
  }
  return members;
}

function includedTransition(member: ScreenMember, index: WorkspaceIndex): ScreenMember | 'ambiguous' | undefined {
  if (!member.location || member.location.includes('${')) {
    return undefined;
  }
  const resolved = resolveIncludedTransition(
    {
      role: 'transition-include',
      lookup: member.name,
      range: member.nameRange,
      dynamic: false,
      location: member.location,
    },
    member.fsPath,
    index,
  );
  if (resolved.status !== 'ok') {
    return undefined;
  }
  if (!resolved.exclusive) {
    return 'ambiguous';
  }
  const target = resolved.targets.find((item) => item.type === 'member');
  return target && target.type === 'member' ? target.member : undefined;
}

function findExtendedForm(form: ScreenMember, index: WorkspaceIndex): ScreenMember | undefined {
  if (!form.extendsForm) {
    return undefined;
  }
  const matches = (member: ScreenMember) =>
    member.kind === 'form' &&
    member.tag === form.tag &&
    member.name === form.extendsForm &&
    !sameMember(member, form);
  if (form.extendsLocation) {
    const resolved = resolveScreenLocation(form.extendsLocation, form.fsPath, index);
    if (resolved.status !== 'ok') {
      return undefined;
    }
    for (const record of resolved.records) {
      const file = index.symbolPath(record);
      if (!file) {
        continue;
      }
      const found = index.screenScope(file).find(matches);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  return index.screenScope(form.fsPath).find(matches);
}

function memberResult(ref: MemberQuery, matches: ScreenMember[]): MemberResolveResult {
  const first = matches[0];
  if (!first) {
    return { status: 'skip' };
  }
  return { status: 'ok', targets: [{ type: 'member', member: first }], exclusive: matches.length === 1 };
}

function missing(ref: MemberQuery, messageKey: string): MemberResolveResult {
  return { status: 'missing', range: ref.range, messageKey, messageArgs: [ref.lookup] };
}

function looksLikePath(value: string): boolean {
  return (
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('component://') ||
    value.startsWith('//') ||
    value.includes('/')
  );
}

function screensInMatchingDirectory(name: string, fromFsPath: string, index: WorkspaceIndex): SymbolRecord[] {
  const found: SymbolRecord[] = [];
  const seen = new Set<string>();
  for (const screenPath of index.screenPaths(fromFsPath)) {
    const child = path.normalize(path.join(path.dirname(screenPath), path.basename(screenPath, '.xml'), `${name}.xml`));
    for (const record of index.findScreensByPath(child)) {
      const key = `${record.uri}\0${record.range.start.line}\0${record.range.start.character}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      found.push(record);
    }
  }
  return found;
}

function matchingDirectoryHas(name: string, fromFsPath: string, index: WorkspaceIndex): boolean {
  return index.screenPaths(fromFsPath).some((screenPath) =>
    isDirectory(path.join(path.dirname(screenPath), path.basename(screenPath, '.xml'), name)),
  );
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function rangesEqual(left: Range, right: Range): boolean {
  return (
    left.start.line === right.start.line &&
    left.start.character === right.start.character &&
    left.end.line === right.end.line &&
    left.end.character === right.end.character
  );
}

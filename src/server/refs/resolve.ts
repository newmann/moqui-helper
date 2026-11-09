import * as fs from 'fs';
import * as path from 'path';
import type { WorkspaceIndex } from '../index/workspace';
import { isCrudVerb } from '../index/services';
import { toPosix } from '../paths';
import { Range, SymbolRecord } from '../types';
import { ClassifiedRef } from './classify';

export type ResolveResult =
  | { status: 'skip' }
  | {
      status: 'ok';
      records: SymbolRecord[];
      range: Range;
      crudCall?: string;
    }
  | {
      status: 'missing';
      range: Range;
      messageKey: string;
      messageArgs: string[];
    };

const COMPONENT_PREFIX = 'component://';
const CLASSPATH_PREFIX = 'classpath://';

export type ResourceLocationResult =
  | { status: 'skip' }
  | { status: 'unmapped' }
  | { status: 'not-path' }
  | { status: 'missing' }
  | { status: 'ok'; fsPath: string };

export function resourceFilePart(location: string): string {
  const hash = location.indexOf('#');
  return (hash < 0 ? location : location.slice(0, hash)).trim();
}

export function resolveResourceLocation(
  location: string,
  fromFsPath: string,
  index: WorkspaceIndex,
): ResourceLocationResult {
  const filePart = resourceFilePart(location);
  if (!filePart || filePart.includes('${')) {
    return { status: 'skip' };
  }
  if (filePart.startsWith('http://') || filePart.startsWith('https://') || filePart.startsWith('content:')) {
    return { status: 'skip' };
  }
  if (filePart.startsWith('//')) {
    const relative = mapBaseLocation(filePart.slice(2));
    if (!relative) {
      return { status: 'unmapped' };
    }
    const found = firstExisting(joins(index.getWorkspaceRoots(), relative), index);
    return found ? { status: 'ok', fsPath: found } : { status: 'missing' };
  }
  if (filePart.startsWith(COMPONENT_PREFIX)) {
    const found = firstExisting(componentCandidates(filePart, index), index);
    return found ? { status: 'ok', fsPath: found } : { status: 'missing' };
  }
  if (filePart.startsWith(CLASSPATH_PREFIX)) {
    const found = firstExisting(classpathCandidates(filePart.slice(CLASSPATH_PREFIX.length), index), index);
    return found ? { status: 'ok', fsPath: found } : { status: 'missing' };
  }
  if (filePart.startsWith('.')) {
    if (!fromFsPath) {
      return { status: 'missing' };
    }
    const absolute = path.normalize(path.resolve(path.dirname(fromFsPath), filePart));
    const found = firstExisting(withExtension(absolute), index);
    return found ? { status: 'ok', fsPath: found } : { status: 'missing' };
  }
  if (filePart.includes('/')) {
    const found = firstExisting(genericCandidates(filePart, index), index);
    return found ? { status: 'ok', fsPath: found } : { status: 'missing' };
  }
  return { status: 'not-path' };
}

export function resolveRef(ref: ClassifiedRef, fromFsPath: string, index: WorkspaceIndex): ResolveResult {
  if (ref.dynamic || !ref.lookup) {
    return { status: 'skip' };
  }
  if (ref.kind === 'entity') {
    return resolveEntity(ref, index);
  }
  if (ref.kind === 'service') {
    return resolveService(ref, index);
  }
  return resolveScreen(ref, fromFsPath, index);
}

export function screenFileBase(fromFsPath: string): string {
  return fromFsPath.toLowerCase().endsWith('.xml') ? fromFsPath.slice(0, -4) : fromFsPath;
}

export function resolveRuntimeScreenPath(
  url: string,
  fromFsPath: string,
  index: WorkspaceIndex,
): { status: 'skip' } | { status: 'ok'; records: SymbolRecord[] } | { status: 'missing' } {
  const query = url.indexOf('?');
  const target = (query < 0 ? url : url.slice(0, query)).trim();
  if (!target || target.includes('${') || isHereOrParent(target)) {
    return { status: 'skip' };
  }
  if (!fromFsPath) {
    return { status: 'missing' };
  }
  const absolute = path.normalize(path.resolve(screenFileBase(fromFsPath), target));
  const records = lookupScreenFile(absolute, index);
  return records.length > 0 ? { status: 'ok', records } : { status: 'missing' };
}

function isHereOrParent(target: string): boolean {
  const trimmed = target.replace(/\/+$/, '');
  return trimmed === '.' || trimmed === '..';
}

export function resolveScreenLocation(
  location: string,
  fromFsPath: string,
  index: WorkspaceIndex,
): { status: 'skip' } | { status: 'ok'; records: SymbolRecord[] } | { status: 'missing' } {
  if (!location || location.includes('${')) {
    return { status: 'skip' };
  }
  if (
    location.startsWith('http://') ||
    location.startsWith('https://') ||
    location.startsWith('content:')
  ) {
    return { status: 'skip' };
  }
  if (location.startsWith(COMPONENT_PREFIX)) {
    const records = resolveComponentLocation(location, index);
    return records.length > 0 ? { status: 'ok', records } : { status: 'missing' };
  }
  if (location.startsWith('.')) {
    const absolute = path.normalize(path.resolve(path.dirname(fromFsPath), location));
    const records = lookupScreenFile(absolute, index);
    return records.length > 0 ? { status: 'ok', records } : { status: 'missing' };
  }
  if (location.startsWith('//')) {
    const relative = mapBaseLocation(location.slice(2));
    if (!relative) {
      return { status: 'skip' };
    }
    const records: SymbolRecord[] = [];
    for (const root of index.getWorkspaceRoots()) {
      const absolute = path.normalize(path.join(root, ...relative.split('/')));
      records.push(...lookupScreenFile(absolute, index));
    }
    return records.length > 0 ? { status: 'ok', records } : { status: 'missing' };
  }
  return { status: 'skip' };
}

function resolveEntity(ref: ClassifiedRef, index: WorkspaceIndex): ResolveResult {
  const records = index.findEntities(ref.lookup);
  if (records.length > 0) {
    return { status: 'ok', records, range: ref.range };
  }
  return {
    status: 'missing',
    range: ref.range,
    messageKey: 'unresolvedEntity',
    messageArgs: [ref.lookup],
  };
}

function resolveService(ref: ClassifiedRef, index: WorkspaceIndex): ResolveResult {
  const call = ref.serviceCall;
  if (call?.kind === 'crud') {
    if (!isCrudVerb(call.verb)) {
      return missingService(ref);
    }
    if (!call.entityName) {
      return { status: 'skip' };
    }
    const records = index.findEntities(call.entityName);
    if (records.length > 0) {
      return { status: 'ok', records, range: ref.range, crudCall: ref.lookup };
    }
    return {
      status: 'missing',
      range: call.entityRange,
      messageKey: 'unresolvedEntity',
      messageArgs: [call.entityName],
    };
  }
  const records = index.findServices(ref.lookup);
  if (ref.interfacesOnly) {
    const interfaces = records.filter((record) => index.isServiceInterface(record));
    if (interfaces.length > 0) {
      return { status: 'ok', records: interfaces, range: ref.range };
    }
    return {
      status: 'missing',
      range: ref.range,
      messageKey: 'unresolvedServiceInterface',
      messageArgs: [ref.lookup],
    };
  }
  if (records.length > 0) {
    return { status: 'ok', records, range: ref.range };
  }
  return missingService(ref);
}

function missingService(ref: ClassifiedRef): ResolveResult {
  if (ref.skipDiagnostic) {
    return { status: 'skip' };
  }
  return {
    status: 'missing',
    range: ref.range,
    messageKey: 'unresolvedService',
    messageArgs: [ref.lookup],
  };
}

function resolveScreen(ref: ClassifiedRef, fromFsPath: string, index: WorkspaceIndex): ResolveResult {
  const resolved = resolveScreenLocation(ref.lookup, fromFsPath, index);
  if (resolved.status === 'skip') {
    return { status: 'skip' };
  }
  if (resolved.status === 'ok') {
    return { status: 'ok', records: resolved.records, range: ref.range };
  }
  return {
    status: 'missing',
    range: ref.range,
    messageKey: 'unresolvedScreen',
    messageArgs: [ref.lookup],
  };
}

function resolveComponentLocation(location: string, index: WorkspaceIndex): SymbolRecord[] {
  const rest = location.slice(COMPONENT_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) {
    return [];
  }
  const name = rest.slice(0, slash);
  const relative = rest.slice(slash + 1);
  if (!relative) {
    return [];
  }
  const records: SymbolRecord[] = [];
  for (const component of index.componentsNamed(name)) {
    const absolute = path.normalize(path.join(component.rootPath, ...relative.split('/')));
    records.push(...lookupScreenFile(absolute, index));
  }
  return records;
}

function lookupScreenFile(absolute: string, index: WorkspaceIndex): SymbolRecord[] {
  const direct = index.findScreensByPath(absolute);
  if (direct.length > 0) {
    return direct;
  }
  if (!absolute.toLowerCase().endsWith('.xml')) {
    return index.findScreensByPath(`${absolute}.xml`);
  }
  return [];
}

function componentCandidates(location: string, index: WorkspaceIndex): string[] {
  const rest = location.slice(COMPONENT_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) {
    return [];
  }
  const name = rest.slice(0, slash);
  const relative = rest.slice(slash + 1);
  if (!relative) {
    return [];
  }
  const candidates: string[] = [];
  for (const component of index.componentsNamed(name)) {
    candidates.push(...withExtension(path.normalize(path.join(component.rootPath, ...relative.split('/')))));
  }
  return candidates;
}

function classpathCandidates(remainder: string, index: WorkspaceIndex): string[] {
  const normalized = remainder.replace(/^\/+/, '');
  if (!normalized) {
    return [];
  }
  const candidates: string[] = [];
  for (const indexed of index.indexedPaths()) {
    if (suffixMatches(indexed, normalized)) {
      candidates.push(indexed);
    }
  }
  const bases = [...index.getWorkspaceRoots(), ...index.components().map((component) => component.rootPath)];
  candidates.push(...joins(bases, normalized));
  return candidates;
}

function genericCandidates(location: string, index: WorkspaceIndex): string[] {
  const normalized = location.replace(/^\/+/, '');
  const candidates: string[] = [];
  for (const indexed of index.indexedPaths()) {
    if (suffixMatches(indexed, normalized)) {
      candidates.push(indexed);
    }
  }
  candidates.push(...joins(index.getWorkspaceRoots(), normalized));
  return candidates;
}

function joins(bases: readonly string[], relative: string): string[] {
  const candidates: string[] = [];
  for (const base of bases) {
    candidates.push(...withExtension(path.normalize(path.join(base, ...relative.split('/')))));
  }
  return candidates;
}

function withExtension(absolute: string): string[] {
  if (path.basename(absolute).includes('.')) {
    return [absolute];
  }
  return [absolute, `${absolute}.xml`];
}

function firstExisting(candidates: readonly string[], index: WorkspaceIndex): string | undefined {
  for (const candidate of candidates) {
    const indexed = index.indexedFile(candidate);
    if (indexed) {
      return indexed;
    }
    if (fs.existsSync(candidate)) {
      return path.normalize(candidate);
    }
  }
  return undefined;
}

function suffixMatches(filePath: string, remainder: string): boolean {
  const needle = remainder.replace(/^\/+/, '');
  if (!needle) {
    return false;
  }
  const haystack = foldPath(toPosix(path.normalize(filePath)));
  const suffixes = [`/${needle}`];
  if (!path.posix.basename(needle).includes('.')) {
    suffixes.push(`/${needle}.xml`);
  }
  return suffixes.some((suffix) => haystack.endsWith(foldPath(suffix)));
}

function foldPath(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

export function mapBaseLocation(remainder: string): string | undefined {
  const slash = remainder.indexOf('/');
  if (slash <= 0) {
    return undefined;
  }
  const head = remainder.slice(0, slash);
  const rest = remainder.slice(slash + 1);
  if (head === 'apps' || head === 'qapps') {
    return mapBaseLocation(rest);
  }
  if (head === 'system') {
    return `runtime/base-component/tools/screen/System/${rest}`;
  }
  if (head === 'tools') {
    return `runtime/base-component/tools/screen/Tools/${rest}`;
  }
  return undefined;
}

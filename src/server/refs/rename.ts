import * as path from 'path';
import { Location, RenameFile, TextDocumentEdit, TextEdit, WorkspaceEdit } from 'vscode-languageserver';
import { shortEntityName } from '../index/entities';
import { FieldDef, RelationshipDef, ViewMember } from '../index/model';
import { serviceFullName, splitServiceName } from '../index/services';
import { WorkspaceIndex } from '../index/workspace';
import { formatMessage, Messages } from '../messages';
import { screenFileName } from '../index/screens';
import { directoryUri, fsPathToUri, uriToFsPath } from '../paths';
import { Range, SymbolRecord } from '../types';
import { IndexedRef } from './indexed';
import { describeTag, sameRange } from './facade';
import { ScreenMember } from '../index/screenMembers';
import { linkedTransitions, resolveMemberRef, sameNameMembers } from './memberResolve';
import { renamedFieldLookup, resolveEntityMemberRef, sameField, uncapitalize } from './entityMembers';
import {
  CursorHit,
  cursorHit,
  locationsForAlias,
  locationsForField,
  locationsForMember,
  locationsForRelationship,
  locationsForSymbol,
  sameSymbol,
  symbolsForRef,
} from './query';
import { resolveServiceInclude } from './serviceInclude';

export interface RenameOptions {
  messages: Messages;
  fileRename: boolean;
  documentChanges: boolean;
}

export function prepareRenameAt(
  text: string,
  offset: number,
  fsPath: string,
  index: WorkspaceIndex,
  options: RenameOptions,
): { range: Range; placeholder: string } | { message: string } | null {
  const hit = renameHit(text, offset, fsPath, index, options);
  if (!hit) {
    return null;
  }
  if ('message' in hit) {
    return hit;
  }
  if (hit.type === 'field') {
    return { range: hit.field.nameRange, placeholder: hit.field.name };
  }
  if (hit.type === 'relationship') {
    if (!hit.relationship.shortAlias || !hit.relationship.shortAliasRange) {
      return null;
    }
    return { range: hit.relationship.shortAliasRange, placeholder: hit.relationship.shortAlias };
  }
  return { range: hit.range, placeholder: hit.placeholder };
}

export function renameAt(
  text: string,
  offset: number,
  fsPath: string,
  index: WorkspaceIndex,
  newName: string,
  options: RenameOptions,
): WorkspaceEdit | { message: string } | null {
  const hit = renameHit(text, offset, fsPath, index, options);
  if (!hit) {
    return null;
  }
  if ('message' in hit) {
    return hit;
  }
  if (hit.type === 'entity-member') {
    return renameEntityMember(hit, newName, index, options);
  }
  if (hit.type === 'field') {
    if (newName === hit.field.name) {
      return emptyEdit(options.documentChanges);
    }
    if (!validToken(newName)) {
      return { message: formatMessage(options.messages, 'renameInvalidName') };
    }
    return renameField(hit.field, newName, index, options);
  }
  if (hit.type === 'relationship') {
    if (newName === hit.relationship.shortAlias) {
      return emptyEdit(options.documentChanges);
    }
    if (!validToken(newName)) {
      return { message: formatMessage(options.messages, 'renameInvalidName') };
    }
    return renameShortAlias(hit.relationship, newName, index, options);
  }
  if (newName === hit.placeholder) {
    return emptyEdit(options.documentChanges);
  }
  if (hit.type === 'member') {
    if (!validToken(newName)) {
      return { message: formatMessage(options.messages, 'renameInvalidName') };
    }
    return renameMember(hit.members[0], newName, index, options);
  }
  if (hit.part === 'screen') {
    return renameScreen(hit.symbols[0], newName, index, options);
  }
  if (hit.part === 'verb' || hit.part === 'noun') {
    if (!validToken(newName)) {
      return { message: formatMessage(options.messages, 'renameInvalidName') };
    }
    return renameService(hit.symbols[0], hit.part, newName, index, options);
  }
  if (!validToken(newName)) {
    return { message: formatMessage(options.messages, 'renameInvalidName') };
  }
  return renameEntity(hit.symbols[0], hit.part, newName, index, options);
}

function renameHit(
  text: string,
  offset: number,
  fsPath: string,
  index: WorkspaceIndex,
  options: RenameOptions,
):
  | (CursorHit & { type: 'symbol' })
  | (CursorHit & { type: 'member' })
  | (CursorHit & { type: 'entity-member' })
  | (CursorHit & { type: 'field' })
  | (CursorHit & { type: 'relationship' })
  | { message: string }
  | null {
  const hit = cursorHit(text, offset, fsPath, index);
  if (!hit) {
    return null;
  }
  if (hit.type === 'member') {
    if (!hit.renameable) {
      return { message: formatMessage(options.messages, 'renameInvalidName') };
    }
    if (!hit.exclusive) {
      return { message: formatMessage(options.messages, 'renameAmbiguous', hit.placeholder) };
    }
    return hit;
  }
  if (hit.type === 'reject') {
    return { message: formatMessage(options.messages, hit.messageKey, ...hit.args) };
  }
  if (hit.type === 'entity-member') {
    if (!hit.renameable) {
      return null;
    }
    if (!hit.exclusive) {
      return { message: formatMessage(options.messages, 'renameAmbiguous', hit.placeholder) };
    }
    return hit;
  }
  if (hit.type === 'field') {
    return hit;
  }
  if (hit.type === 'relationship') {
    if (hit.via !== 'alias' || !hit.relationship.shortAliasRange) {
      return null;
    }
    return hit;
  }
  if (!hit.renameable) {
    return { message: formatMessage(options.messages, hit.messageKey ?? 'renameInvalidName', ...(hit.args ?? [])) };
  }
  if (!hit.exclusive) {
    return { message: formatMessage(options.messages, 'renameAmbiguous', hit.placeholder) };
  }
  if (hit.part === 'screen' && !options.fileRename) {
    return { message: formatMessage(options.messages, 'renameScreenUnsupported') };
  }
  return hit;
}

function renameEntityMember(
  hit: CursorHit & { type: 'entity-member' },
  newName: string,
  index: WorkspaceIndex,
  options: RenameOptions,
): WorkspaceEdit | { message: string } {
  if (newName === hit.placeholder) {
    return emptyEdit(options.documentChanges);
  }
  if (!validToken(newName)) {
    return { message: formatMessage(options.messages, 'renameInvalidName') };
  }
  const target = hit.targets[0];
  if (!target || hit.targets.length !== 1) {
    return { message: formatMessage(options.messages, 'renameAmbiguous', hit.placeholder) };
  }
  if (target.type === 'field') {
    return renameField(target.field, hit.fromSlice ? uncapitalize(newName) : newName, index, options);
  }
  if (target.type === 'alias') {
    return renameAlias(target.member.aliasRange, target.uri, target.member, target.viewName, newName, index, options);
  }
  return renameShortAlias(target.relationship, newName, index, options);
}

function renameField(field: FieldDef, newOrigin: string, index: WorkspaceIndex, options: RenameOptions): WorkspaceEdit {
  const edits: TextChange[] = [];
  const seen = new Set<string>();
  const push = (uri: string, range: Range, text: string) => {
    const key = `${uri}\n${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    edits.push({ uri, range, text });
  };
  push(field.uri, field.nameRange, newOrigin);
  for (const ref of index.allEntityMemberRefs()) {
    if (ref.role !== 'field') {
      continue;
    }
    const resolved = resolveEntityMemberRef(ref, index);
    if (resolved.status !== 'ok' || resolved.targets.length !== 1) {
      continue;
    }
    const target = resolved.targets[0];
    if (target.type !== 'field' || !sameField(target.field, field)) {
      continue;
    }
    push(ref.uri, ref.range, renamedFieldLookup(ref.lookup, target.field, newOrigin));
  }
  index.forEachFacadeTag((tag) => {
    const described = describeTag(tag, index);
    if (described.kind !== 'field' || !described.field || !sameField(described.field, field)) {
      return;
    }
    const leaf = tag.names[tag.names.length - 1] ?? '';
    push(tag.uri, tag.range, renamedFieldLookup(leaf, described.field, newOrigin));
  });
  return toWorkspaceEdit(edits, undefined, options.documentChanges);
}

function renameAlias(
  aliasRange: Range,
  uri: string,
  member: ViewMember,
  viewName: string,
  newName: string,
  index: WorkspaceIndex,
  options: RenameOptions,
): WorkspaceEdit {
  const edits: TextChange[] = [{ uri, range: aliasRange, text: newName }];
  for (const location of locationsForAlias(member, viewName, uri, index)) {
    if (location.uri === uri && sameRange(location.range, aliasRange)) {
      continue;
    }
    edits.push({ uri: location.uri, range: location.range, text: newName });
  }
  return toWorkspaceEdit(edits, undefined, options.documentChanges);
}

function renameShortAlias(
  relationship: RelationshipDef,
  newName: string,
  index: WorkspaceIndex,
  options: RenameOptions,
): WorkspaceEdit {
  const edits: TextChange[] = [];
  if (relationship.shortAliasRange) {
    edits.push({ uri: relationship.uri, range: relationship.shortAliasRange, text: newName });
  }
  for (const ref of index.allEntityMemberRefs()) {
    if (ref.role !== 'relationship' || ref.lookup !== relationship.shortAlias) {
      continue;
    }
    const resolved = resolveEntityMemberRef(ref, index);
    if (resolved.status !== 'ok' || resolved.targets.length !== 1) {
      continue;
    }
    const target = resolved.targets[0];
    if (target.type !== 'relationship' || target.via !== 'alias' || !sameRelationship(target.relationship, relationship)) {
      continue;
    }
    edits.push({ uri: ref.uri, range: ref.range, text: newName });
  }
  if (relationship.shortAlias) {
    for (const tag of index.facadeTagsNamed(relationship.shortAlias)) {
      const described = describeTag(tag, index);
      if (
        described.kind === 'relationship' &&
        described.relationship &&
        described.written === relationship.shortAlias &&
        sameRelationship(described.relationship, relationship)
      ) {
        edits.push({ uri: tag.uri, range: tag.range, text: newName });
      }
    }
  }
  return toWorkspaceEdit(edits, undefined, options.documentChanges);
}

function sameRelationship(left: RelationshipDef, right: RelationshipDef): boolean {
  return left.uri === right.uri && sameRange(left.relatedRange, right.relatedRange);
}

function renameEntity(
  symbol: SymbolRecord,
  part: 'entity-name' | 'alias',
  newName: string,
  index: WorkspaceIndex,
  options: RenameOptions,
): WorkspaceEdit {
  const edits: TextChange[] = [];
  const definition = index.entityDefinition(symbol);
  const oldShort = shortEntityName(symbol.name);
  if (part === 'entity-name' && definition) {
    edits.push({ uri: definition.uri, range: definition.entityNameRange, text: newName });
    if (definition.alias && definition.alias === oldShort && definition.aliasRange) {
      edits.push({ uri: definition.uri, range: definition.aliasRange, text: newName });
    }
  }
  if (part === 'alias' && definition?.aliasRange) {
    edits.push({ uri: definition.uri, range: definition.aliasRange, text: newName });
  }
  const keys = new Set<string>([symbol.name, oldShort, ...symbol.aliases]);
  for (const key of keys) {
    if (!key) {
      continue;
    }
    for (const ref of index.refsLookingUp('entity', key)) {
      if (!exclusive(ref, symbol, index)) {
        continue;
      }
      const form = writtenForm(ref.written, symbol);
      if (part === 'entity-name' && form !== 'name') {
        continue;
      }
      if (part === 'alias' && form !== 'alias') {
        continue;
      }
      edits.push({ uri: ref.uri, range: ref.range, text: part === 'alias' ? newName : renamedEntity(ref.written, newName) });
    }
  }
  const leaves = part === 'alias' ? symbol.aliases : [symbol.name, oldShort, `delete-${oldShort}`, `delete-${symbol.name}`];
  for (const leaf of leaves) {
    for (const tag of index.facadeTagsNamed(leaf)) {
      const described = describeTag(tag, index);
      if (described.kind !== 'entity' || described.symbols.length !== 1 || !sameSymbol(described.symbols[0], symbol)) {
        continue;
      }
      if (part === 'entity-name' && described.via !== 'name') {
        continue;
      }
      if (part === 'alias' && described.via !== 'alias') {
        continue;
      }
      const nextWritten = described.via === 'alias' ? newName : renamedEntity(described.written, newName);
      const prefix = described.deletePrefix ? 'delete-' : '';
      edits.push({ uri: tag.uri, range: tag.range, text: `${prefix}${nextWritten}` });
    }
  }
  return toWorkspaceEdit(edits, undefined, options.documentChanges);
}

function renameService(
  symbol: SymbolRecord,
  part: 'verb' | 'noun',
  newName: string,
  index: WorkspaceIndex,
  options: RenameOptions,
): WorkspaceEdit | { message: string } {
  const definition = index.serviceDefinition(symbol);
  if (!definition) {
    return { message: formatMessage(options.messages, 'renameInvalidName') };
  }
  const current = splitServiceName(symbol.name);
  if (part === 'noun' && !definition.nounRange) {
    return { message: formatMessage(options.messages, 'renameInvalidName') };
  }
  const edits: TextChange[] = [];
  if (part === 'verb') {
    edits.push({ uri: definition.uri, range: definition.verbRange, text: newName });
  } else if (definition.nounRange) {
    edits.push({ uri: definition.uri, range: definition.nounRange, text: newName });
  }
  for (const ref of index.refsLookingUp('service', symbol.name)) {
    if (!exclusive(ref, symbol, index)) {
      continue;
    }
    edits.push({ uri: ref.uri, range: ref.range, text: replaceServicePart(ref.lookup, part, newName) });
  }
  for (const ref of index.allIncludeRefs()) {
    if (ref.part !== part) {
      continue;
    }
    const resolved = resolveServiceInclude(ref, ref.fsPath, index);
    if (resolved.status !== 'ok' || resolved.matches.length !== 1 || !sameSymbol(resolved.matches[0].symbol, symbol)) {
      continue;
    }
    edits.push({ uri: ref.uri, range: ref.range, text: newName });
  }
  const concat = current.className ? `${current.className}.${current.verb}${current.noun}` : `${current.verb}${current.noun}`;
  for (const tag of index.facadeTagsNamed(concat)) {
    const described = describeTag(tag, index);
    if (described.kind !== 'service' || described.symbols.length !== 1 || !sameSymbol(described.symbols[0], symbol)) {
      continue;
    }
    const text = described.concatService
      ? concatServiceName(current.className, part === 'verb' ? newName : current.verb, part === 'noun' ? newName : current.noun)
      : replaceServicePart(described.raw, part, newName);
    edits.push({ uri: tag.uri, range: tag.range, text });
  }
  return toWorkspaceEdit(edits, undefined, options.documentChanges);
}

function renameScreen(
  symbol: SymbolRecord,
  newName: string,
  index: WorkspaceIndex,
  options: RenameOptions,
): WorkspaceEdit | { message: string } {
  if (!validScreenName(newName)) {
    return { message: formatMessage(options.messages, 'renameInvalidScreenName') };
  }
  const oldName = screenFileName(symbol.name);
  if (oldName === newName) {
    return emptyEdit(options.documentChanges);
  }
  const edits: TextChange[] = [];
  for (const ref of index.screenRefsFor(symbol)) {
    if (!exclusive(ref, symbol, index)) {
      continue;
    }
    const slash = ref.lookup.lastIndexOf('/');
    if (ref.lookup.slice(slash + 1) !== oldName) {
      continue;
    }
    edits.push({ uri: ref.uri, range: ref.range, text: `${ref.lookup.slice(0, slash + 1)}${newName}` });
  }
  const oldStem = oldName.slice(0, -'.xml'.length);
  const newStem = newName.slice(0, -'.xml'.length);
  for (const ref of index.allMemberRefs()) {
    const resolved = resolveMemberRef(ref, ref.fsPath, index);
    if (resolved.status !== 'ok' || resolved.targets.length !== 1) {
      continue;
    }
    const target = resolved.targets[0];
    if (target.type !== 'screen' || !sameSymbol(target.record, symbol)) {
      continue;
    }
    if (ref.lookup === oldStem) {
      edits.push({ uri: ref.uri, range: ref.range, text: newStem });
      continue;
    }
    const slash = ref.lookup.lastIndexOf('/');
    if (slash >= 0 && ref.lookup.slice(slash + 1) === oldName) {
      edits.push({ uri: ref.uri, range: ref.range, text: `${ref.lookup.slice(0, slash + 1)}${newName}` });
    }
  }
  const newUri = renamedFileUri(symbol.uri, newName);
  return toWorkspaceEdit(edits, { oldUri: symbol.uri, newUri }, options.documentChanges);
}

function renameMember(
  member: ScreenMember,
  newName: string,
  index: WorkspaceIndex,
  options: RenameOptions,
): WorkspaceEdit | { message: string } {
  const linked = member.kind === 'transition' ? linkedTransitions(member, index) : [member];
  if (linked === 'ambiguous' || (member.kind !== 'transition' && sameNameMembers(member, index).length !== 1)) {
    return { message: formatMessage(options.messages, 'renameAmbiguous', member.name) };
  }
  const edits: TextChange[] = [];
  for (const target of linked) {
    edits.push({ uri: target.uri, range: target.nameRange, text: newName });
    for (const location of locationsForMember(target, index)) {
      edits.push({ uri: location.uri, range: location.range, text: newName });
    }
  }
  return toWorkspaceEdit(edits, undefined, options.documentChanges);
}

function exclusive(ref: IndexedRef, symbol: SymbolRecord, index: WorkspaceIndex): boolean {
  const records = symbolsForRef(ref, index);
  return records.length === 1 && sameSymbol(records[0], symbol);
}

function writtenForm(lookup: string, symbol: SymbolRecord): 'name' | 'alias' | 'other' {
  if (lookup.includes('.')) {
    return lookup === symbol.name ? 'name' : 'other';
  }
  if (lookup === shortEntityName(symbol.name)) {
    return 'name';
  }
  if (symbol.aliases.includes(lookup)) {
    return 'alias';
  }
  return 'other';
}

function renamedEntity(lookup: string, newName: string): string {
  const dot = lookup.lastIndexOf('.');
  return dot < 0 ? newName : `${lookup.slice(0, dot + 1)}${newName}`;
}

function replaceServicePart(lookup: string, part: 'verb' | 'noun', newName: string): string {
  const parts = splitServiceName(lookup);
  return serviceFullName(parts.className, part === 'verb' ? newName : parts.verb, part === 'noun' ? newName : parts.noun);
}

function concatServiceName(className: string, verb: string, noun: string): string {
  const verbNoun = `${verb}${noun}`;
  return className ? `${className}.${verbNoun}` : verbNoun;
}

function renamedFileUri(uri: string, newName: string): string {
  try {
    return fsPathToUri(path.join(path.dirname(uriToFsPath(uri)), newName));
  } catch {
    return `${directoryUri(uri)}${newName}`;
  }
}

function validToken(name: string): boolean {
  return name.length > 0 && !/[\s.#/\\]/.test(name);
}

function validScreenName(name: string): boolean {
  return name.endsWith('.xml') && !name.includes('/') && !name.includes('\\') && !name.includes('..') && name !== '.xml';
}

interface TextChange {
  uri: string;
  range: Range;
  text: string;
}

function emptyEdit(documentChanges: boolean): WorkspaceEdit {
  return documentChanges ? { documentChanges: [] } : { changes: {} };
}

function toWorkspaceEdit(
  edits: TextChange[],
  renameFile: { oldUri: string; newUri: string } | undefined,
  documentChanges: boolean,
): WorkspaceEdit {
  const unique = dedupeEdits(edits);
  if (!documentChanges) {
    const changes: { [uri: string]: TextEdit[] } = {};
    for (const edit of unique) {
      const list = changes[edit.uri] ?? [];
      list.push(TextEdit.replace(edit.range, edit.text));
      changes[edit.uri] = list;
    }
    return { changes };
  }
  const byUri = new Map<string, TextEdit[]>();
  for (const edit of unique) {
    const list = byUri.get(edit.uri) ?? [];
    list.push(TextEdit.replace(edit.range, edit.text));
    byUri.set(edit.uri, list);
  }
  const changes: Array<TextDocumentEdit | RenameFile> = [];
  for (const [uri, textEdits] of byUri) {
    changes.push(TextDocumentEdit.create({ uri, version: null }, textEdits));
  }
  if (renameFile) {
    changes.push(RenameFile.create(renameFile.oldUri, renameFile.newUri, { overwrite: false }));
  }
  return { documentChanges: changes };
}

function dedupeEdits(edits: TextChange[]): TextChange[] {
  const seen = new Set<string>();
  const result: TextChange[] = [];
  for (const edit of edits) {
    const key = `${edit.uri}\n${edit.range.start.line}:${edit.range.start.character}:${edit.range.end.line}:${edit.range.end.character}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(edit);
  }
  return result;
}

export function referenceLocations(text: string, offset: number, fsPath: string, index: WorkspaceIndex): Location[] | null {
  const hit = cursorHit(text, offset, fsPath, index);
  if (!hit || hit.type === 'reject') {
    return null;
  }
  if (hit.type === 'member') {
    const locations = [];
    for (const member of hit.members) {
      locations.push(...locationsForMember(member, index));
    }
    return locations;
  }
  if (hit.type === 'entity-member') {
    const locations: Location[] = [];
    for (const target of hit.targets) {
      if (target.type === 'field') {
        locations.push(...locationsForField(target.field, index));
      } else if (target.type === 'alias') {
        locations.push(...locationsForAlias(target.member, target.viewName, target.uri, index));
      } else {
        locations.push(...locationsForRelationship(target.relationship, target.via === 'alias' ? 'alias' : 'related', index));
      }
    }
    return locations;
  }
  if (hit.type === 'field') {
    return locationsForField(hit.field, index);
  }
  if (hit.type === 'relationship') {
    return locationsForRelationship(hit.relationship, hit.via, index);
  }
  const locations = [];
  for (const symbol of hit.symbols) {
    locations.push(...locationsForSymbol(symbol, index));
  }
  return locations;
}

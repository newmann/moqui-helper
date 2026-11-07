import { Location } from 'vscode-languageserver';
import { shortEntityName } from '../index/entities';
import { FacadeTag, FieldDef, RelationshipDef, ViewMember } from '../index/model';
import { splitServiceName } from '../index/services';
import { WorkspaceIndex } from '../index/workspace';
import { ScreenMember, sameMember } from '../index/screenMembers';
import { screenFileName } from '../index/screens';
import { Range, SymbolRecord } from '../types';
import { attribute, scanXml } from '../xml/scan';
import { describeTag, facadeTagAt, sameRange } from './facade';
import { IndexedRef } from './indexed';
import { collectMemberRefs, collectRefs, memberRefAt, refAt } from './classify';
import {
  collectEntityMemberRefs,
  entityMemberRefAt,
  EntityMemberTarget,
  originSlice,
  relationshipPart,
  resolveEntityMemberRef,
  sameField,
  sourceRange,
} from './entityMembers';
import { linkedTransitions, resolveMemberRef, sameNameMembers } from './memberResolve';
import { resolveScreenLocation } from './resolve';
import { collectServiceIncludeRefs, includeRefAt, resolveServiceInclude } from './serviceInclude';

export interface SymbolHit {
  type: 'symbol';
  symbols: SymbolRecord[];
  part: 'entity-name' | 'alias' | 'verb' | 'noun' | 'screen';
  range: Range;
  placeholder: string;
  exclusive: boolean;
  renameable: boolean;
  messageKey?: string;
  args?: string[];
}

export interface FieldHit {
  type: 'field';
  field: FieldDef;
}

export interface RelationshipHit {
  type: 'relationship';
  relationship: RelationshipDef;
  via: 'alias' | 'related';
}

export interface RejectHit {
  type: 'reject';
  messageKey: string;
  args: string[];
}

export interface MemberHit {
  type: 'member';
  members: ScreenMember[];
  range: Range;
  placeholder: string;
  exclusive: boolean;
  renameable: boolean;
}

export interface EntityMemberHit {
  type: 'entity-member';
  role: 'field' | 'relationship' | 'entity-alias';
  targets: EntityMemberTarget[];
  range: Range;
  placeholder: string;
  exclusive: boolean;
  renameable: boolean;
  fromSlice: boolean;
}

export type CursorHit = SymbolHit | FieldHit | RelationshipHit | RejectHit | MemberHit | EntityMemberHit;

export function cursorHit(text: string, offset: number, fsPath: string, index: WorkspaceIndex): CursorHit | undefined {
  const include = hitInclude(text, offset, fsPath, index);
  if (include) {
    return include;
  }
  const member = hitMember(text, offset, fsPath, index);
  if (member) {
    return member;
  }
  const entityMember = hitEntityMember(text, offset, fsPath, index);
  if (entityMember) {
    return entityMember;
  }
  const refHit = hitRef(text, offset, fsPath, index);
  if (refHit) {
    return refHit;
  }
  const defined = hitDefinition(text, offset, fsPath, index);
  if (defined) {
    return defined;
  }
  return hitFacade(text, offset, index);
}

export function locationsForSymbol(symbol: SymbolRecord, index: WorkspaceIndex): Location[] {
  const locations: Location[] = [];
  if (symbol.kind === 'entity' || symbol.kind === 'view-entity') {
    const keys = new Set<string>([symbol.name, shortEntityName(symbol.name), ...symbol.aliases]);
    for (const key of keys) {
      if (!key) {
        continue;
      }
      for (const ref of index.refsLookingUp('entity', key)) {
        if (symbolsForRef(ref, index).some((item) => sameSymbol(item, symbol))) {
          locations.push({ uri: ref.uri, range: ref.range });
        }
      }
    }
    const leaves = [
      symbol.name,
      shortEntityName(symbol.name),
      ...symbol.aliases,
      `delete-${shortEntityName(symbol.name)}`,
      `delete-${symbol.name}`,
    ];
    for (const leaf of leaves) {
      for (const tag of index.facadeTagsNamed(leaf)) {
        const described = describeTag(tag, index);
        if (described.kind === 'entity' && described.symbols.some((item) => sameSymbol(item, symbol))) {
          locations.push({ uri: tag.uri, range: tag.range });
        }
      }
    }
  } else if (symbol.kind === 'service') {
    for (const ref of index.refsLookingUp('service', symbol.name)) {
      if (symbolsForRef(ref, index).some((item) => sameSymbol(item, symbol))) {
        locations.push({ uri: ref.uri, range: ref.range });
      }
    }
    const parts = splitServiceName(symbol.name);
    const concat = parts.className ? `${parts.className}.${parts.verb}${parts.noun}` : `${parts.verb}${parts.noun}`;
    for (const tag of index.facadeTagsNamed(concat)) {
      const described = describeTag(tag, index);
      if (described.kind === 'service' && described.symbols.some((item) => sameSymbol(item, symbol))) {
        locations.push({ uri: tag.uri, range: tag.range });
      }
    }
    for (const ref of index.allIncludeRefs()) {
      const resolved = resolveServiceInclude(ref, ref.fsPath, index);
      if (resolved.status === 'ok' && resolved.matches.some((match) => sameSymbol(match.symbol, symbol))) {
        locations.push({ uri: ref.uri, range: ref.range });
      }
    }
  } else {
    for (const ref of index.screenRefsFor(symbol)) {
      if (symbolsForRef(ref, index).some((item) => sameSymbol(item, symbol))) {
        locations.push({ uri: ref.uri, range: ref.range });
      }
    }
    for (const ref of index.allMemberRefs()) {
      const resolved = resolveMemberRef(ref, ref.fsPath, index);
      if (resolved.status !== 'ok' || resolved.targets.length !== 1) {
        continue;
      }
      const target = resolved.targets[0];
      if (target.type === 'screen' && sameSymbol(target.record, symbol)) {
        locations.push({ uri: ref.uri, range: ref.range });
      }
    }
  }
  return dedupe(locations.filter((location) => !isDefinition(symbol, location)));
}

export function locationsForMember(member: ScreenMember, index: WorkspaceIndex): Location[] {
  const locations: Location[] = [];
  for (const ref of index.allMemberRefs()) {
    const resolved = resolveMemberRef(ref, ref.fsPath, index);
    if (resolved.status !== 'ok') {
      continue;
    }
    if (resolved.targets.some((target) => target.type === 'member' && sameMember(target.member, member))) {
      locations.push({ uri: ref.uri, range: ref.range });
    }
  }
  return dedupe(locations.filter((location) => location.uri !== member.uri || !sameRange(location.range, member.nameRange)));
}

export function locationsForField(field: FieldDef, index: WorkspaceIndex): Location[] {
  const locations: Location[] = [];
  index.forEachFacadeTag((tag) => {
    const leaf = tag.names[tag.names.length - 1] ?? '';
    if (!leaf.endsWith(field.name) && !leaf.endsWith(field.originName ?? field.name)) {
      return;
    }
    const described = describeTag(tag, index);
    if (described.kind === 'field' && described.field && sameField(described.field, field)) {
      locations.push({ uri: tag.uri, range: tag.range });
    }
  });
  for (const ref of index.allEntityMemberRefs()) {
    if (ref.role !== 'field') {
      continue;
    }
    const resolved = resolveEntityMemberRef(ref, index);
    if (resolved.status !== 'ok') {
      continue;
    }
    if (resolved.targets.some((target) => target.type === 'field' && sameField(target.field, field))) {
      locations.push({ uri: ref.uri, range: ref.range });
    }
  }
  return dedupe(locations);
}

export function locationsForAlias(member: ViewMember, viewName: string, uri: string, index: WorkspaceIndex): Location[] {
  const locations: Location[] = [];
  for (const ref of index.allEntityMemberRefs()) {
    if (ref.role !== 'entity-alias' || ref.viewName !== viewName || ref.lookup !== member.alias) {
      continue;
    }
    const resolved = resolveEntityMemberRef(ref, index);
    if (resolved.status !== 'ok') {
      continue;
    }
    if (
      resolved.targets.some(
        (target) => target.type === 'alias' && target.uri === uri && sameRange(target.member.aliasRange, member.aliasRange),
      )
    ) {
      locations.push({ uri: ref.uri, range: ref.range });
    }
  }
  return dedupe(locations);
}

export function locationsForRelationship(
  relationship: RelationshipDef,
  via: 'alias' | 'related',
  index: WorkspaceIndex,
): Location[] {
  const locations: Location[] = [];
  index.forEachFacadeTag((tag) => {
    const described = describeTag(tag, index);
    if (described.kind !== 'relationship' || !described.relationship) {
      return;
    }
    if (described.relationship.uri !== relationship.uri) {
      return;
    }
    if (via === 'alias') {
      if (
        relationship.shortAlias &&
        described.relationship.shortAlias === relationship.shortAlias &&
        described.written === relationship.shortAlias
      ) {
        locations.push({ uri: tag.uri, range: tag.range });
      }
      return;
    }
    if (sameRange(described.relationship.relatedRange, relationship.relatedRange) && described.written === relationship.related) {
      locations.push({ uri: tag.uri, range: tag.range });
    }
  });
  for (const ref of index.allEntityMemberRefs()) {
    if (ref.role !== 'relationship') {
      continue;
    }
    const resolved = resolveEntityMemberRef(ref, index);
    if (resolved.status !== 'ok') {
      continue;
    }
    if (
      resolved.targets.some(
        (target) => target.type === 'relationship' && sameRelationship(target.relationship, relationship),
      )
    ) {
      locations.push({ uri: ref.uri, range: ref.range });
    }
  }
  return dedupe(locations);
}

export function sameSymbol(left: SymbolRecord, right: SymbolRecord): boolean {
  return left.kind === right.kind && left.uri === right.uri && left.name === right.name && sameRange(left.range, right.range);
}

export function symbolsForRef(ref: IndexedRef, index: WorkspaceIndex): SymbolRecord[] {
  if (ref.kind === 'entity') {
    return index.findEntities(ref.lookup);
  }
  if (ref.kind === 'service') {
    return index.findServices(ref.lookup);
  }
  const resolved = resolveScreenLocation(ref.lookup, ref.fsPath, index);
  return resolved.status === 'ok' ? resolved.records : [];
}

function hitInclude(text: string, offset: number, fsPath: string, index: WorkspaceIndex): CursorHit | undefined {
  const ref = includeRefAt(collectServiceIncludeRefs(text), offset);
  if (!ref) {
    return undefined;
  }
  const resolved = resolveServiceInclude(ref, fsPath, index);
  if (resolved.status !== 'ok') {
    return undefined;
  }
  return {
    type: 'symbol',
    symbols: resolved.matches.map((match) => match.symbol),
    part: ref.part,
    range: ref.range,
    placeholder: ref.part === 'noun' ? ref.noun : ref.verb,
    exclusive: resolved.matches.length === 1,
    renameable: true,
  };
}

function hitMember(text: string, offset: number, fsPath: string, index: WorkspaceIndex): CursorHit | undefined {
  const ref = memberRefAt(collectMemberRefs(text), offset);
  if (!ref) {
    return undefined;
  }
  if (ref.dynamic || ref.locationDynamic) {
    return { type: 'reject', messageKey: 'renameDynamic', args: [] };
  }
  if (!ref.lookup) {
    return undefined;
  }
  const resolved = resolveMemberRef(ref, fsPath, index);
  if (resolved.status !== 'ok') {
    return undefined;
  }
  const screens = resolved.targets.flatMap((target) => (target.type === 'screen' ? [target.record] : []));
  const members = resolved.targets.flatMap((target) => (target.type === 'member' ? [target.member] : []));
  if (members.length === 0 && screens.length > 0) {
    return {
      type: 'symbol',
      symbols: screens,
      part: 'screen',
      range: ref.range,
      placeholder: screenFileName(screens[0].name),
      exclusive: screens.length === 1 && resolved.exclusive,
      renameable: true,
    };
  }
  if (members.length === 0) {
    return undefined;
  }
  const primary = members[0];
  const linked = primary.kind === 'transition' ? linkedTransitions(primary, index) : [primary];
  return {
    type: 'member',
    members: linked === 'ambiguous' ? [primary] : linked,
    range: ref.range,
    placeholder: primary.name,
    exclusive: linked !== 'ambiguous' && resolved.exclusive,
    renameable: true,
  };
}

function hitRef(text: string, offset: number, fsPath: string, index: WorkspaceIndex): CursorHit | undefined {
  const ref = refAt(collectRefs(text), offset);
  if (!ref) {
    return undefined;
  }
  if (ref.dynamic) {
    return { type: 'reject', messageKey: 'renameDynamic', args: [] };
  }
  if (ref.skipDiagnostic) {
    return { type: 'reject', messageKey: 'renamePattern', args: [ref.lookup] };
  }
  if (ref.kind === 'service' && ref.serviceCall?.kind === 'crud') {
    if (offset < ref.serviceCall.entityStart || offset > ref.serviceCall.entityEnd) {
      return undefined;
    }
    const written = ref.serviceCall.entityName;
    const symbols = index.findEntities(written);
    if (symbols.length === 0) {
      return undefined;
    }
    const part = entityPart(written, symbols);
    return {
      type: 'symbol',
      symbols,
      part,
      range: ref.serviceCall.entityRange,
      placeholder: part === 'alias' ? written : shortToken(written),
      exclusive: symbols.length === 1,
      renameable: true,
    };
  }
  if (ref.kind === 'service') {
    const symbols = index.findServices(ref.lookup);
    if (symbols.length === 0) {
      return undefined;
    }
    const segment = serviceSegment(ref.lookup, offset - ref.startOffset);
    const parts = splitServiceName(ref.lookup);
    return {
      type: 'symbol',
      symbols,
      part: segment === 'noun' ? 'noun' : 'verb',
      range: ref.range,
      placeholder: segment === 'noun' ? parts.noun : parts.verb,
      exclusive: symbols.length === 1,
      renameable: segment !== 'class',
      messageKey: segment === 'class' ? 'renameServiceClass' : undefined,
    };
  }
  if (ref.kind === 'screen') {
    const resolved = resolveScreenLocation(ref.lookup, fsPath, index);
    if (resolved.status !== 'ok' || resolved.records.length === 0) {
      return undefined;
    }
    return {
      type: 'symbol',
      symbols: resolved.records,
      part: 'screen',
      range: ref.range,
      placeholder: screenFileName(resolved.records[0].name),
      exclusive: resolved.records.length === 1,
      renameable: true,
    };
  }
  const symbols = index.findEntities(ref.lookup);
  if (symbols.length === 0) {
    return undefined;
  }
  const part = entityPart(ref.lookup, symbols);
  return {
    type: 'symbol',
    symbols,
    part,
    range: ref.range,
    placeholder: part === 'alias' ? ref.lookup : shortToken(ref.lookup),
    exclusive: symbols.length === 1,
    renameable: true,
  };
}

function hitEntityMember(text: string, offset: number, fsPath: string, index: WorkspaceIndex): CursorHit | undefined {
  const ref = entityMemberRefAt(collectEntityMemberRefs(text), offset);
  if (!ref?.lookup) {
    return undefined;
  }
  const resolved = resolveEntityMemberRef(ref, index);
  if (resolved.status !== 'ok') {
    return undefined;
  }
  const part = relationshipPart(ref, offset);
  const targets = resolved.targets.map((target) => {
    if (target.type !== 'relationship' || !part) {
      return target;
    }
    const via: 'title' | 'related' = part;
    return { ...target, via };
  });
  const only = targets.length === 1 ? targets[0] : undefined;
  const slice = only?.type === 'field' ? originSlice(ref.lookup, only.field) : undefined;
  const range = slice ? sliceRange(ref.range, slice) : sourceRange(ref, offset);
  return {
    type: 'entity-member',
    role: ref.role,
    targets,
    range,
    placeholder: slice ?? ref.lookup,
    exclusive: distinctTargets(targets) === 1,
    renameable: targets.every((target) => target.type === 'field' || target.type === 'alias' || target.via === 'alias'),
    fromSlice: Boolean(slice),
  };
}

function hitDefinition(text: string, offset: number, fsPath: string, index: WorkspaceIndex): CursorHit | undefined {
  const scan = scanXml(text);
  for (const element of scan.elements) {
    if (offset < element.startOffset || offset > element.endOffset) {
      continue;
    }
    const symbol = index.symbolsIn(fsPath).find((item) => sameRange(item.range, element.startTagRange));
    if (symbol && (symbol.kind === 'entity' || symbol.kind === 'view-entity')) {
      const entityName = attribute(element, 'entity-name');
      const alias = attribute(element, 'short-alias');
      const packageName = attribute(element, 'package');
      if (entityName && offset >= entityName.startOffset && offset <= entityName.endOffset) {
        return symbolHit(symbol, 'entity-name', entityName.range, entityName.value.trim());
      }
      if (alias && offset >= alias.startOffset && offset <= alias.endOffset) {
        return symbolHit(symbol, 'alias', alias.range, alias.value.trim());
      }
      if (packageName && offset >= packageName.startOffset && offset <= packageName.endOffset) {
        return { type: 'reject', messageKey: 'renamePackage', args: [] };
      }
      if (offset >= element.nameStart && offset <= element.nameEnd) {
        return symbolHit(symbol, 'entity-name', element.nameRange, shortEntityName(symbol.name));
      }
    }
    if (symbol && symbol.kind === 'service') {
      const verb = attribute(element, 'verb');
      const noun = attribute(element, 'noun');
      if (verb && offset >= verb.startOffset && offset <= verb.endOffset) {
        return symbolHit(symbol, 'verb', verb.range, verb.value.trim());
      }
      if (noun && offset >= noun.startOffset && offset <= noun.endOffset) {
        return symbolHit(symbol, 'noun', noun.range, noun.value.trim());
      }
      if (offset >= element.nameStart && offset <= element.nameEnd) {
        const parts = splitServiceName(symbol.name);
        return {
          ...symbolHit(symbol, 'verb', element.nameRange, parts.verb),
          renameable: false,
          messageKey: 'renameServicePart',
        };
      }
    }
    if (symbol && symbol.kind === 'screen' && offset >= element.startOffset && offset <= element.endOffset) {
      if (element.attributes.some((item) => offset >= item.startOffset && offset <= item.endOffset)) {
        continue;
      }
      return symbolHit(symbol, 'screen', element.startTagRange, screenFileName(symbol.name));
    }
  }
  const alias = index.viewMemberAt(fsPath, scan.positionAt(offset));
  if (alias) {
    const view = index.viewByName(alias.viewName);
    const matches = view?.view?.members.filter((member) => member.alias === alias.member.alias) ?? [alias.member];
    return {
      type: 'entity-member',
      role: 'entity-alias',
      targets: [{ type: 'alias', member: alias.member, uri: alias.uri, viewName: alias.viewName }],
      range: alias.member.aliasRange,
      placeholder: alias.member.alias,
      exclusive: matches.length === 1,
      renameable: true,
      fromSlice: false,
    };
  }
  const defined = index.memberAt(fsPath, scan.positionAt(offset));
  if (defined) {
    const linked = defined.kind === 'transition' ? linkedTransitions(defined, index) : [defined];
    const duplicates = sameNameMembers(defined, index).length > 1;
    return {
      type: 'member',
      members: linked === 'ambiguous' ? [defined] : linked,
      range: defined.nameRange,
      placeholder: defined.name,
      exclusive: linked !== 'ambiguous' && !duplicates,
      renameable: true,
    };
  }
  const field = index.fieldAt(fsPath, offset, (value) => scan.positionAt(value));
  if (field) {
    return { type: 'field', field };
  }
  const relationship = index.relationshipAt(fsPath, offset, (value) => scan.positionAt(value));
  if (relationship) {
    return { type: 'relationship', relationship: relationship.relationship, via: relationship.via };
  }
  return undefined;
}

function hitFacade(text: string, offset: number, index: WorkspaceIndex): CursorHit | undefined {
  const found = facadeTagAt(text, offset);
  if (!found) {
    return undefined;
  }
  const described = describeTag(found, index);
  if (described.kind === 'entity') {
    const part = described.via === 'alias' ? 'alias' : 'entity-name';
    return {
      type: 'symbol',
      symbols: described.symbols,
      part,
      range: found.range,
      placeholder: part === 'alias' ? described.written : shortToken(described.written),
      exclusive: described.symbols.length === 1,
      renameable: true,
    };
  }
  if (described.kind === 'service' && described.symbols[0]) {
    const symbol = described.symbols[0];
    const parts = splitServiceName(symbol.name);
    const local = localOffset(text, found, offset);
    const classEnd = parts.className.length;
    let part: 'verb' | 'noun' | 'class' = 'verb';
    if (described.concatService) {
      const verbEnd = classEnd + 1 + parts.verb.length;
      if (local <= classEnd) {
        part = 'class';
      } else if (local > verbEnd) {
        part = 'noun';
      }
    } else {
      const segment = serviceSegment(described.raw, local);
      part = segment === 'noun' ? 'noun' : segment === 'class' ? 'class' : 'verb';
    }
    if (!parts.noun && part === 'noun') {
      return undefined;
    }
    return {
      type: 'symbol',
      symbols: described.symbols,
      part: part === 'class' ? 'verb' : part,
      range: found.range,
      placeholder: part === 'noun' ? parts.noun : parts.verb,
      exclusive: described.symbols.length === 1,
      renameable: part !== 'class',
      messageKey: part === 'class' ? 'renameServiceClass' : undefined,
    };
  }
  if (described.kind === 'field' && described.field) {
    return { type: 'field', field: described.field };
  }
  if (described.kind === 'relationship' && described.relationship) {
    const via = described.relationship.shortAlias === described.written ? 'alias' : 'related';
    return { type: 'relationship', relationship: described.relationship, via };
  }
  return undefined;
}

function sameRelationship(left: RelationshipDef, right: RelationshipDef): boolean {
  return left.uri === right.uri && sameRange(left.relatedRange, right.relatedRange);
}

function distinctTargets(targets: readonly EntityMemberTarget[]): number {
  const keys = new Set<string>();
  for (const target of targets) {
    if (target.type === 'field') {
      keys.add(`${target.field.uri}\n${rangeKey(target.field.nameRange)}`);
    } else if (target.type === 'alias') {
      keys.add(`${target.uri}\n${target.viewName}\n${rangeKey(target.member.aliasRange)}`);
    } else {
      keys.add(`${target.relationship.uri}\n${rangeKey(target.relationship.relatedRange)}\n${target.relationship.shortAlias}`);
    }
  }
  return keys.size;
}

function sliceRange(range: Range, slice: string): Range {
  return {
    start: { line: range.end.line, character: Math.max(0, range.end.character - slice.length) },
    end: range.end,
  };
}

function rangeKey(range: Range): string {
  return `${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
}

function symbolHit(symbol: SymbolRecord, part: SymbolHit['part'], range: Range, placeholder: string): SymbolHit {
  return { type: 'symbol', symbols: [symbol], part, range, placeholder, exclusive: true, renameable: true };
}

function entityPart(written: string, symbols: readonly SymbolRecord[]): 'entity-name' | 'alias' {
  if (written.includes('.')) {
    return 'entity-name';
  }
  if (symbols.some((symbol) => shortEntityName(symbol.name) === written)) {
    return 'entity-name';
  }
  return 'alias';
}

function shortToken(written: string): string {
  const dot = written.lastIndexOf('.');
  return dot < 0 ? written : written.slice(dot + 1);
}

function serviceSegment(lookup: string, local: number): 'class' | 'verb' | 'noun' {
  const hash = lookup.indexOf('#');
  const pathPart = hash < 0 ? lookup : lookup.slice(0, hash);
  const dot = pathPart.lastIndexOf('.');
  if (hash >= 0 && local > hash) {
    return 'noun';
  }
  if (dot >= 0 && local <= dot) {
    return 'class';
  }
  return 'verb';
}

function localOffset(text: string, tag: FacadeTag, offset: number): number {
  const scan = scanXml(text);
  const element = scan.elements.find((item) => sameRange(item.nameRange, tag.range));
  if (!element) {
    return 0;
  }
  return offset - element.nameStart;
}

function isDefinition(symbol: SymbolRecord, location: Location): boolean {
  return location.uri === symbol.uri && sameRange(location.range, symbol.range);
}

function dedupe(locations: Location[]): Location[] {
  const seen = new Set<string>();
  const result: Location[] = [];
  for (const location of locations) {
    const key = `${location.uri}\n${location.range.start.line}:${location.range.start.character}:${location.range.end.line}:${location.range.end.character}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(location);
  }
  return result;
}

import type { WorkspaceIndex } from '../index/workspace';
import {
  FieldDef,
  RelationshipDef,
  ViewMember,
  relationshipMatches,
  relationshipName,
} from '../index/model';
import { Position, Range } from '../types';
import { attribute, decodeEntities, ScanAttribute, ScanElement, ScanResult, scanXml } from '../xml/scan';

export type FieldContext =
  | { kind: 'entity'; entityName: string }
  | { kind: 'member'; viewName: string; alias: string }
  | { kind: 'view'; viewName: string };

export type RelationshipContext =
  | { kind: 'entity'; entityName: string; chain: string[] }
  | { kind: 'member'; viewName: string; joinFromAlias: string };

export interface NamePart {
  kind: 'title' | 'related';
  range: Range;
  startOffset: number;
  endOffset: number;
}

export interface EntityMemberQuery {
  role: 'field' | 'relationship' | 'entity-alias';
  lookup: string;
  range: Range;
  field?: FieldContext;
  relationship?: RelationshipContext;
  viewName?: string;
  parts?: NamePart[];
}

export interface EntityMemberRef extends EntityMemberQuery {
  startOffset: number;
  endOffset: number;
  editRange: Range;
  editStart: number;
  editEnd: number;
  field?: FieldContext;
  relationship?: RelationshipContext;
  viewName?: string;
  parts?: NamePart[];
}

export type EntityMemberTarget =
  | { type: 'field'; field: FieldDef }
  | { type: 'relationship'; relationship: RelationshipDef; via: 'alias' | 'title' | 'related' }
  | { type: 'alias'; member: ViewMember; uri: string; viewName: string };

export type EntityMemberResolveResult =
  | { status: 'ok'; targets: EntityMemberTarget[] }
  | { status: 'missing'; range: Range; messageKey: string; messageArgs: string[] }
  | { status: 'skip' };

export interface AliasNameCandidate {
  fieldName: string;
  entityAlias: string;
  aliasRange?: Range;
  insertAt?: Position;
}

export interface AliasNameCompletion {
  nameRange: Range;
  prefix: string;
  candidates: AliasNameCandidate[];
}

const ENTITY_OPS = new Set(['entity-find', 'entity-find-one', 'entity-find-count', 'entity-delete-by-condition']);
const LAST_UPDATED_STAMP = 'lastUpdatedStamp';

export function collectEntityMemberRefs(text: string): EntityMemberRef[] {
  const scan = scanXml(text);
  const refs: EntityMemberRef[] = [];
  for (let index = 0; index < scan.elements.length; index++) {
    collectElement(scan, index, refs);
  }
  return refs;
}

export function entityMemberRefAt(refs: readonly EntityMemberRef[], offset: number): EntityMemberRef | undefined {
  for (let index = refs.length - 1; index >= 0; index--) {
    const ref = refs[index];
    if (offset >= ref.startOffset && offset <= ref.endOffset) {
      return ref;
    }
  }
  return undefined;
}

export function sourceRange(ref: EntityMemberRef, offset: number): Range {
  const part = ref.parts?.find((item) => offset >= item.startOffset && offset <= item.endOffset);
  return part?.range ?? ref.range;
}

export function relationshipPart(ref: EntityMemberRef, offset: number): 'title' | 'related' | undefined {
  return ref.parts?.find((item) => offset >= item.startOffset && offset <= item.endOffset)?.kind;
}

export function resolveEntityMemberRef(ref: EntityMemberQuery, index: WorkspaceIndex): EntityMemberResolveResult {
  if (!ref.lookup) {
    return { status: 'skip' };
  }
  if (ref.role === 'field' && ref.field) {
    return resolveField(ref, index);
  }
  if (ref.role === 'relationship' && ref.relationship) {
    return resolveRelationship(ref, index);
  }
  if (ref.role === 'entity-alias' && ref.viewName) {
    return resolveAlias(ref, index);
  }
  return { status: 'skip' };
}

export function completionLabels(ref: EntityMemberRef, prefix: string, index: WorkspaceIndex): string[] {
  if (ref.role === 'field' && ref.field) {
    const fields = fieldsFor(ref.field, index);
    if (fields === 'skip') {
      return [];
    }
    return unique(fields.map((field) => field.name).filter((name) => name.startsWith(prefix)));
  }
  if (ref.role === 'relationship' && ref.relationship) {
    const relationships = relationshipsFor(ref.relationship, index);
    if (relationships === 'skip') {
      return [];
    }
    return unique(relationships.map(relationshipName).filter((name) => name.startsWith(prefix)));
  }
  if (ref.role === 'entity-alias' && ref.viewName) {
    const view = index.viewByName(ref.viewName);
    if (!view?.view) {
      return [];
    }
    return unique(view.view.members.map((member) => member.alias).filter((name) => name.startsWith(prefix)));
  }
  return [];
}

export function aliasDetail(ref: EntityMemberRef, label: string, index: WorkspaceIndex): string | undefined {
  if (ref.role !== 'entity-alias' || !ref.viewName) {
    return undefined;
  }
  const view = index.viewByName(ref.viewName);
  const member = view?.view?.members.find((item) => item.alias === label);
  if (!member) {
    return undefined;
  }
  if (member.kind === 'relationship') {
    return member.relationship;
  }
  return member.entityName || undefined;
}

export function aliasNameCompletion(text: string, offset: number, index: WorkspaceIndex): AliasNameCompletion | undefined {
  const scan = scanXml(text);
  for (let elementIndex = 0; elementIndex < scan.elements.length; elementIndex++) {
    const element = scan.elements[elementIndex];
    if (element.name !== 'alias') {
      continue;
    }
    const nameAttribute = attribute(element, 'name');
    if (!nameAttribute || offset < nameAttribute.startOffset || offset > nameAttribute.endOffset) {
      continue;
    }
    const viewIndex = ancestorIndex(scan, elementIndex, (item) => item.name === 'view-entity');
    if (viewIndex === undefined) {
      return undefined;
    }
    const packaged = packagedName(scan.elements[viewIndex]);
    if (!packaged || packaged.dynamic) {
      return undefined;
    }
    const view = index.viewByName(packaged.name);
    if (!view?.view) {
      return { nameRange: nameAttribute.range, prefix: prefixOf(text, nameAttribute, offset), candidates: [] };
    }
    const used = aliasNamesIn(scan, viewIndex);
    const seen = new Set<string>();
    const candidates: AliasNameCandidate[] = [];
    const aliasAttribute = attribute(element, 'entity-alias');
    const insertAt = aliasAttribute ? undefined : insertPosition(text, element, scan.positionAt);
    for (const member of view.view.members) {
      const entityName = index.memberEntityName(view, member);
      if (!entityName || entityName.includes('${')) {
        continue;
      }
      for (const symbol of index.findEntities(entityName)) {
        for (const field of index.entityShape(symbol).fields) {
          if (!field.name || used.has(field.name)) {
            continue;
          }
          const key = `${member.alias}\n${field.name}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          candidates.push({
            fieldName: field.name,
            entityAlias: member.alias,
            aliasRange: aliasAttribute?.range,
            insertAt,
          });
        }
      }
    }
    return { nameRange: nameAttribute.range, prefix: prefixOf(text, nameAttribute, offset), candidates };
  }
  return undefined;
}

export function sameField(left: FieldDef, right: FieldDef): boolean {
  return left.uri === right.uri && sameRange(left.nameRange, right.nameRange);
}

export function renamedFieldLookup(lookup: string, field: FieldDef, newOrigin: string): string {
  const origin = field.originName;
  if (origin && origin !== field.name) {
    const suffix = capitalize(origin);
    if (lookup.length > suffix.length && lookup.endsWith(suffix)) {
      return lookup.slice(0, lookup.length - suffix.length) + capitalize(newOrigin);
    }
  }
  return newOrigin;
}

export function originSlice(lookup: string, field: FieldDef): string | undefined {
  const origin = field.originName;
  if (!origin || origin === field.name) {
    return undefined;
  }
  const suffix = capitalize(origin);
  if (lookup.length > suffix.length && lookup.endsWith(suffix)) {
    return suffix;
  }
  return undefined;
}

export function uncapitalize(name: string): string {
  if (!name) {
    return name;
  }
  return name.charAt(0).toLowerCase() + name.slice(1);
}

export function targetLocations(target: EntityMemberTarget, part?: 'title' | 'related'): { uri: string; range: Range }[] {
  if (target.type === 'field') {
    return [{ uri: target.field.uri, range: target.field.nameRange }];
  }
  if (target.type === 'alias') {
    return [{ uri: target.uri, range: target.member.aliasRange }];
  }
  const relationship = target.relationship;
  if (part === 'title' && relationship.titleRange) {
    return [{ uri: relationship.uri, range: relationship.titleRange }];
  }
  if (part === 'related') {
    return [{ uri: relationship.uri, range: relationship.relatedRange }];
  }
  if (target.via === 'alias' && relationship.shortAliasRange) {
    return [{ uri: relationship.uri, range: relationship.shortAliasRange }];
  }
  if (target.via === 'title' && relationship.titleRange) {
    return [{ uri: relationship.uri, range: relationship.titleRange }];
  }
  return [{ uri: relationship.uri, range: relationship.relatedRange }];
}

function resolveField(ref: EntityMemberQuery, index: WorkspaceIndex): EntityMemberResolveResult {
  const fields = fieldsFor(ref.field!, index);
  if (fields === 'skip') {
    return { status: 'skip' };
  }
  const matched = fields.filter((field) => field.name === ref.lookup);
  if (matched.length === 0) {
    if (ref.lookup === LAST_UPDATED_STAMP) {
      return { status: 'skip' };
    }
    return missing(ref, 'unresolvedField');
  }
  return { status: 'ok', targets: matched.map((field) => ({ type: 'field', field })) };
}

function resolveRelationship(ref: EntityMemberQuery, index: WorkspaceIndex): EntityMemberResolveResult {
  const relationships = relationshipsFor(ref.relationship!, index);
  if (relationships === 'skip') {
    return { status: 'skip' };
  }
  const matched = relationships.filter((relationship) => relationshipMatches(relationship, ref.lookup));
  if (matched.length === 0) {
    return missing(ref, 'unresolvedRelationship');
  }
  const part = ref.parts?.length === 1 ? ref.parts[0].kind : undefined;
  return {
    status: 'ok',
    targets: matched.map((relationship) => ({ type: 'relationship', relationship, via: viaFor(relationship, ref.lookup, part) })),
  };
}

function resolveAlias(ref: EntityMemberQuery, index: WorkspaceIndex): EntityMemberResolveResult {
  const view = index.viewByName(ref.viewName!);
  if (!view?.view) {
    return { status: 'skip' };
  }
  const members = view.view.members.filter((member) => member.alias === ref.lookup);
  if (members.length === 0) {
    return missing(ref, 'unresolvedEntityAlias');
  }
  return {
    status: 'ok',
    targets: members.map((member) => ({ type: 'alias', member, uri: view.uri, viewName: view.canonical })),
  };
}

function viaFor(relationship: RelationshipDef, lookup: string, part?: 'title' | 'related'): 'alias' | 'title' | 'related' {
  if (part === 'title') {
    return 'title';
  }
  if (part === 'related') {
    return 'related';
  }
  if (relationship.shortAlias && relationship.shortAlias === lookup) {
    return 'alias';
  }
  if (relationship.title && lookup === `${relationship.title}#${relationship.related}`) {
    return 'title';
  }
  return 'related';
}

function missing(ref: EntityMemberQuery, messageKey: string): EntityMemberResolveResult {
  return { status: 'missing', range: ref.range, messageKey, messageArgs: [ref.lookup] };
}

function fieldsFor(context: FieldContext, index: WorkspaceIndex): FieldDef[] | 'skip' {
  if (context.kind === 'entity') {
    return fieldsOfEntity(context.entityName, index);
  }
  if (context.kind === 'view') {
    const view = index.viewByName(context.viewName);
    if (!view) {
      return 'skip';
    }
    return fieldsOfEntity(view.canonical, index);
  }
  const view = index.viewByName(context.viewName);
  if (!view?.view) {
    return 'skip';
  }
  const member = view.view.members.find((item) => item.alias === context.alias);
  if (!member) {
    return 'skip';
  }
  const entityName = index.memberEntityName(view, member);
  if (!entityName || entityName.includes('${')) {
    return 'skip';
  }
  return fieldsOfEntity(entityName, index);
}

function fieldsOfEntity(entityName: string, index: WorkspaceIndex): FieldDef[] | 'skip' {
  const symbols = index.findEntities(entityName);
  if (symbols.length === 0) {
    return 'skip';
  }
  const fields: FieldDef[] = [];
  const seen = new Set<string>();
  for (const symbol of symbols) {
    for (const field of index.entityShape(symbol).fields) {
      const key = `${field.uri}\n${field.name}\n${field.nameRange.start.line}:${field.nameRange.start.character}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      fields.push(field);
    }
  }
  return fields;
}

function relationshipsFor(context: RelationshipContext, index: WorkspaceIndex): RelationshipDef[] | 'skip' {
  if (context.kind === 'member') {
    const view = index.viewByName(context.viewName);
    if (!view?.view) {
      return 'skip';
    }
    const member = view.view.members.find((item) => item.alias === context.joinFromAlias);
    if (!member) {
      return 'skip';
    }
    const entityName = index.memberEntityName(view, member);
    if (!entityName || entityName.includes('${')) {
      return 'skip';
    }
    return relationshipsOf(entityName, index);
  }
  let relationships = relationshipsOf(context.entityName, index);
  if (relationships === 'skip') {
    return 'skip';
  }
  for (const step of context.chain) {
    const matched = relationships.filter((relationship) => relationshipMatches(relationship, step));
    if (matched.length === 0) {
      return 'skip';
    }
    const next: RelationshipDef[] = [];
    let found = false;
    for (const relationship of matched) {
      const related = relationshipsOf(relationship.related, index);
      if (related === 'skip') {
        continue;
      }
      found = true;
      next.push(...related);
    }
    if (!found) {
      return 'skip';
    }
    relationships = next;
  }
  return relationships;
}

function relationshipsOf(entityName: string, index: WorkspaceIndex): RelationshipDef[] | 'skip' {
  const symbols = index.findEntities(entityName);
  if (symbols.length === 0) {
    return 'skip';
  }
  const relationships: RelationshipDef[] = [];
  for (const symbol of symbols) {
    relationships.push(...index.entityShape(symbol).relationships);
  }
  return relationships;
}

function collectElement(scan: ScanResult, index: number, refs: EntityMemberRef[]) {
  const element = scan.elements[index];
  switch (element.name) {
    case 'index-field':
      pushSingleField(scan, index, 'name', entityContext(scan, index), refs);
      return;
    case 'key-map':
      pushKeyMap(scan, index, refs);
      return;
    case 'key-value':
      pushSingleField(scan, index, 'related', relationshipRelatedContext(scan, index), refs);
      return;
    case 'alias':
      pushMemberField(scan, index, 'field', attribute(element, 'entity-alias')?.value.trim() ?? '', refs);
      pushAliasRef(scan, index, 'entity-alias', refs);
      return;
    case 'complex-alias-field':
      pushMemberField(scan, index, 'field', attribute(element, 'entity-alias')?.value.trim() ?? '', refs);
      pushAliasRef(scan, index, 'entity-alias', refs);
      return;
    case 'alias-all':
      pushAliasRef(scan, index, 'entity-alias', refs);
      return;
    case 'exclude':
      pushExclude(scan, index, refs);
      return;
    case 'econdition':
      pushEcondition(scan, index, refs);
      return;
    case 'field-map':
      pushFieldMap(scan, index, refs);
      return;
    case 'order-by':
      pushOrderBy(scan, index, refs);
      return;
    case 'select-field':
      pushListField(scan, index, 'field-name', false, refs);
      return;
    case 'search-form-inputs':
      pushListField(scan, index, 'default-order-by', true, refs);
      pushListField(scan, index, 'skip-fields', false, refs);
      return;
    case 'detail':
      pushDetail(scan, index, refs);
      return;
    case 'member-entity':
    case 'member-relationship':
      pushAliasRef(scan, index, 'join-from-alias', refs);
      if (element.name === 'member-relationship') {
        pushMemberRelationship(scan, index, refs);
      }
      return;
    default:
      return;
  }
}

function pushKeyMap(scan: ScanResult, index: number, refs: EntityMemberRef[]) {
  const parents = ancestorIndexes(scan, index);
  const relationship = parents.map((item) => scan.elements[item]).find((item) => item.name === 'relationship');
  const member = parents
    .map((item) => scan.elements[item])
    .find((item) => item.name === 'member-entity' || item.name === 'member-relationship');
  if (relationship) {
    pushSingleField(scan, index, 'field-name', entityContext(scan, index), refs);
    pushSingleField(scan, index, 'related', literalEntityContext(attribute(relationship, 'related')?.value.trim() ?? ''), refs);
    return;
  }
  if (member) {
    const view = viewContext(scan, index);
    const joinFrom = attribute(member, 'join-from-alias')?.value.trim() ?? '';
    if (view && joinFrom && !joinFrom.includes('${')) {
      pushSingleField(scan, index, 'field-name', { kind: 'member', viewName: view, alias: joinFrom }, refs);
    }
    if (member.name === 'member-entity') {
      pushSingleField(scan, index, 'related', literalEntityContext(attribute(member, 'entity-name')?.value.trim() ?? ''), refs);
      return;
    }
    const alias = attribute(member, 'entity-alias')?.value.trim() ?? '';
    if (view && alias && !alias.includes('${')) {
      pushSingleField(scan, index, 'related', { kind: 'member', viewName: view, alias }, refs);
    }
  }
}

function pushExclude(scan: ScanResult, index: number, refs: EntityMemberRef[]) {
  const parents = ancestorIndexes(scan, index).map((item) => scan.elements[item]);
  const aliasAll = parents.find((item) => item.name === 'alias-all');
  if (aliasAll) {
    pushMemberField(scan, index, 'field', attribute(aliasAll, 'entity-alias')?.value.trim() ?? '', refs);
    return;
  }
  const autoParameters = parents.find((item) => item.name === 'auto-parameters');
  if (autoParameters) {
    const named = attribute(autoParameters, 'entity-name')?.value.trim() ?? '';
    const context = named ? literalEntityContext(named) : literalEntityContext(serviceNoun(scan, index));
    pushSingleField(scan, index, 'field-name', context, refs);
    return;
  }
  const autoEntity = parents.find((item) => item.name === 'auto-fields-entity');
  if (autoEntity) {
    pushSingleField(scan, index, 'field-name', literalEntityContext(attribute(autoEntity, 'entity-name')?.value.trim() ?? ''), refs);
  }
}

function pushEcondition(scan: ScanResult, index: number, refs: EntityMemberRef[]) {
  const view = viewContext(scan, index);
  if (view) {
    pushAliasRef(scan, index, 'entity-alias', refs);
    pushAliasRef(scan, index, 'to-entity-alias', refs);
    pushSingleField(scan, index, 'field-name', viewFieldContext(scan, index, 'entity-alias'), refs);
    pushSingleField(scan, index, 'to-field-name', viewFieldContext(scan, index, 'to-entity-alias'), refs);
    return;
  }
  const entity = operationContext(scan, index);
  if (!entity) {
    return;
  }
  pushSingleField(scan, index, 'field-name', entity, refs);
  pushSingleField(scan, index, 'to-field-name', entity, refs);
}

function pushFieldMap(scan: ScanResult, index: number, refs: EntityMemberRef[]) {
  for (const parent of ancestorIndexes(scan, index)) {
    const name = scan.elements[parent].name;
    if (name === 'service-call' || name === 'filter-map-list') {
      return;
    }
    if (ENTITY_OPS.has(name)) {
      pushSingleField(scan, index, 'field-name', literalEntityContext(attribute(scan.elements[parent], 'entity-name')?.value.trim() ?? ''), refs);
      return;
    }
  }
}

function pushOrderBy(scan: ScanResult, index: number, refs: EntityMemberRef[]) {
  for (const parent of ancestorIndexes(scan, index)) {
    const name = scan.elements[parent].name;
    if (name === 'order-map-list') {
      return;
    }
    if (name === 'view-entity') {
      const view = packagedName(scan.elements[parent]);
      if (view && !view.dynamic) {
        pushListed(scan, index, 'field-name', true, { kind: 'view', viewName: view.name }, refs);
      }
      return;
    }
    if (ENTITY_OPS.has(name)) {
      pushListed(scan, index, 'field-name', true, literalEntityContext(attribute(scan.elements[parent], 'entity-name')?.value.trim() ?? ''), refs);
      return;
    }
  }
}

function pushListField(scan: ScanResult, index: number, attributeName: string, order: boolean, refs: EntityMemberRef[]) {
  const entity = operationContext(scan, index);
  if (!entity) {
    return;
  }
  pushListed(scan, index, attributeName, order, entity, refs);
}

function pushDetail(scan: ScanResult, index: number, refs: EntityMemberRef[]) {
  const owner = ancestorIndex(scan, index, (item) => item.name === 'entity' || item.name === 'extend-entity');
  if (owner === undefined) {
    return;
  }
  const packaged = packagedName(scan.elements[owner]);
  if (!packaged || packaged.dynamic) {
    return;
  }
  const chain: string[] = [];
  for (const parent of ancestorIndexes(scan, index)) {
    const element = scan.elements[parent];
    if (element.name !== 'detail') {
      break;
    }
    const written = attribute(element, 'relationship')?.value.trim() ?? '';
    if (!written || written.includes('${')) {
      return;
    }
    chain.unshift(written);
  }
  pushRelationship(scan, index, { kind: 'entity', entityName: packaged.name, chain }, refs);
}

function pushMemberRelationship(scan: ScanResult, index: number, refs: EntityMemberRef[]) {
  const view = viewContext(scan, index);
  const joinFrom = attribute(scan.elements[index], 'join-from-alias')?.value.trim() ?? '';
  if (!view || !joinFrom || joinFrom.includes('${')) {
    return;
  }
  pushRelationship(scan, index, { kind: 'member', viewName: view, joinFromAlias: joinFrom }, refs);
}

function pushMemberField(scan: ScanResult, index: number, attributeName: string, alias: string, refs: EntityMemberRef[]) {
  const view = viewContext(scan, index);
  if (!view || !alias || alias.includes('${')) {
    return;
  }
  pushSingleField(scan, index, attributeName, { kind: 'member', viewName: view, alias }, refs);
}

function pushSingleField(
  scan: ScanResult,
  index: number,
  attributeName: string,
  context: FieldContext | undefined,
  refs: EntityMemberRef[],
) {
  if (!context) {
    return;
  }
  const attr = attribute(scan.elements[index], attributeName);
  if (!attr || attr.value.includes('${')) {
    return;
  }
  const token = fieldToken(attr, scan.positionAt, false);
  if (!token) {
    return;
  }
  refs.push(fieldRef(token, context));
}

function pushListed(
  scan: ScanResult,
  index: number,
  attributeName: string,
  order: boolean,
  context: FieldContext | undefined,
  refs: EntityMemberRef[],
) {
  if (!context) {
    return;
  }
  const attr = attribute(scan.elements[index], attributeName);
  if (!attr) {
    return;
  }
  for (const token of fieldTokens(attr, scan.positionAt, order)) {
    refs.push(fieldRef(token, context));
  }
}

function pushRelationship(scan: ScanResult, index: number, context: RelationshipContext, refs: EntityMemberRef[]) {
  const attr = attribute(scan.elements[index], 'relationship');
  if (!attr || attr.value.includes('${')) {
    return;
  }
  const span = wholeValue(attr, scan.positionAt);
  refs.push({
    role: 'relationship',
    lookup: attr.value.trim(),
    range: span.range,
    startOffset: span.start,
    endOffset: span.end,
    editRange: span.range,
    editStart: span.start,
    editEnd: span.end,
    relationship: context,
    parts: relationshipParts(attr, scan.positionAt),
  });
}

function pushAliasRef(scan: ScanResult, index: number, attributeName: string, refs: EntityMemberRef[]) {
  const view = viewContext(scan, index);
  if (!view) {
    return;
  }
  const attr = attribute(scan.elements[index], attributeName);
  if (!attr || attr.value.includes('${')) {
    return;
  }
  const span = wholeValue(attr, scan.positionAt);
  refs.push({
    role: 'entity-alias',
    lookup: attr.value.trim(),
    range: span.range,
    startOffset: span.start,
    endOffset: span.end,
    editRange: span.range,
    editStart: span.start,
    editEnd: span.end,
    viewName: view,
  });
}

function fieldRef(token: FieldToken, context: FieldContext): EntityMemberRef {
  return {
    role: 'field',
    lookup: token.name,
    range: token.range,
    startOffset: token.start,
    endOffset: token.end,
    editRange: token.range,
    editStart: token.start,
    editEnd: token.end,
    field: context,
  };
}

function viewFieldContext(scan: ScanResult, index: number, aliasAttribute: string): FieldContext | undefined {
  const view = viewContext(scan, index);
  if (!view) {
    return undefined;
  }
  let alias = attribute(scan.elements[index], aliasAttribute)?.value.trim() ?? '';
  if (alias.includes('${')) {
    return undefined;
  }
  if (!alias) {
    const viewIndex = ancestorIndex(scan, index, (item) => item.name === 'view-entity');
    const member = enclosingMember(scan, index, viewIndex);
    alias = member ? attribute(member, 'entity-alias')?.value.trim() ?? '' : '';
    if (alias.includes('${')) {
      return undefined;
    }
  }
  if (alias) {
    return { kind: 'member', viewName: view, alias };
  }
  return { kind: 'view', viewName: view };
}

function operationContext(scan: ScanResult, index: number): FieldContext | undefined {
  for (const parent of ancestorIndexes(scan, index)) {
    if (ENTITY_OPS.has(scan.elements[parent].name)) {
      return literalEntityContext(attribute(scan.elements[parent], 'entity-name')?.value.trim() ?? '');
    }
  }
  return undefined;
}

function entityContext(scan: ScanResult, index: number): FieldContext | undefined {
  const owner = ancestorIndex(scan, index, (item) => item.name === 'entity' || item.name === 'extend-entity');
  if (owner === undefined) {
    return undefined;
  }
  const packaged = packagedName(scan.elements[owner]);
  if (!packaged || packaged.dynamic) {
    return undefined;
  }
  return { kind: 'entity', entityName: packaged.name };
}

function relationshipRelatedContext(scan: ScanResult, index: number): FieldContext | undefined {
  const relationship = ancestorIndex(scan, index, (item) => item.name === 'relationship');
  if (relationship === undefined) {
    return undefined;
  }
  return literalEntityContext(attribute(scan.elements[relationship], 'related')?.value.trim() ?? '');
}

function literalEntityContext(entityName: string): FieldContext | undefined {
  if (!entityName || entityName.includes('${')) {
    return undefined;
  }
  return { kind: 'entity', entityName };
}

function viewContext(scan: ScanResult, index: number): string | undefined {
  const view = ancestorIndex(scan, index, (item) => item.name === 'view-entity');
  if (view === undefined) {
    return undefined;
  }
  const packaged = packagedName(scan.elements[view]);
  if (!packaged || packaged.dynamic) {
    return undefined;
  }
  return packaged.name;
}

function serviceNoun(scan: ScanResult, index: number): string {
  const service = ancestorIndex(scan, index, (item) => item.name === 'service');
  if (service === undefined) {
    return '';
  }
  return attribute(scan.elements[service], 'noun')?.value.trim() ?? '';
}

function enclosingMember(scan: ScanResult, index: number, viewIndex: number | undefined): ScanElement | undefined {
  for (const parent of ancestorIndexes(scan, index)) {
    if (parent === viewIndex) {
      return undefined;
    }
    const element = scan.elements[parent];
    if (element.name === 'member-entity' || element.name === 'member-relationship') {
      return element;
    }
  }
  return undefined;
}

function ancestorIndex(scan: ScanResult, index: number, predicate: (element: ScanElement) => boolean): number | undefined {
  for (const parent of ancestorIndexes(scan, index)) {
    if (predicate(scan.elements[parent])) {
      return parent;
    }
  }
  return undefined;
}

function ancestorIndexes(scan: ScanResult, index: number): number[] {
  const list: number[] = [];
  let current = scan.elements[index].parentIndex;
  while (current >= 0) {
    list.push(current);
    current = scan.elements[current].parentIndex;
  }
  return list;
}

function packagedName(element: ScanElement): { name: string; dynamic: boolean } | undefined {
  const entityName = attribute(element, 'entity-name')?.value.trim() ?? '';
  if (!entityName) {
    return undefined;
  }
  const packageName = attribute(element, 'package')?.value.trim() ?? '';
  if (entityName.includes('${') || packageName.includes('${')) {
    return { name: entityName, dynamic: true };
  }
  const name = entityName.includes('.') || !packageName ? entityName : `${packageName}.${entityName}`;
  return { name, dynamic: false };
}

interface FieldToken {
  name: string;
  range: Range;
  start: number;
  end: number;
}

function fieldToken(attr: ScanAttribute, positionAt: (offset: number) => Position, order: boolean): FieldToken | undefined {
  const tokens = fieldTokens(attr, positionAt, order);
  return tokens.length === 1 ? tokens[0] : tokens[0];
}

function fieldTokens(attr: ScanAttribute, positionAt: (offset: number) => Position, order: boolean): FieldToken[] {
  const tokens: FieldToken[] = [];
  let start = 0;
  let depth = 0;
  const push = (from: number, to: number) => {
    const decoded = decodeEntities(attr.raw.slice(from, to));
    if (decoded.includes('${')) {
      return;
    }
    let rawStart = from;
    let rawEnd = to;
    while (rawStart < rawEnd && isSpace(attr.raw[rawStart])) {
      rawStart++;
    }
    while (rawEnd > rawStart && isSpace(attr.raw[rawEnd - 1])) {
      rawEnd--;
    }
    let nameStart = rawStart;
    let name = decodeEntities(attr.raw.slice(rawStart, rawEnd));
    if (order) {
      let cut = 0;
      if (name.startsWith('+') || name.startsWith('-')) {
        cut++;
      }
      if (name[cut] === '^') {
        cut++;
      }
      if (cut > 0) {
        name = name.slice(cut);
        nameStart = advanceRaw(attr.raw, rawStart, cut);
      }
    }
    const fileStart = attr.startOffset + nameStart;
    const fileEnd = attr.startOffset + rawEnd;
    tokens.push({
      name,
      range: { start: positionAt(fileStart), end: positionAt(fileEnd) },
      start: fileStart,
      end: fileEnd,
    });
  };
  for (let index = 0; index < attr.raw.length; index++) {
    if (attr.raw.startsWith('${', index)) {
      depth++;
    } else if (attr.raw[index] === '}' && depth > 0) {
      depth--;
    } else if (attr.raw[index] === ',' && depth === 0) {
      push(start, index);
      start = index + 1;
    }
  }
  push(start, attr.raw.length);
  return tokens;
}

function wholeValue(attr: ScanAttribute, positionAt: (offset: number) => Position): { range: Range; start: number; end: number } {
  let rawStart = 0;
  let rawEnd = attr.raw.length;
  while (rawStart < rawEnd && isSpace(attr.raw[rawStart])) {
    rawStart++;
  }
  while (rawEnd > rawStart && isSpace(attr.raw[rawEnd - 1])) {
    rawEnd--;
  }
  const start = attr.startOffset + rawStart;
  const end = attr.startOffset + rawEnd;
  return { range: { start: positionAt(start), end: positionAt(end) }, start, end };
}

function relationshipParts(attr: ScanAttribute, positionAt: (offset: number) => Position): NamePart[] | undefined {
  const hash = attr.raw.indexOf('#');
  if (hash <= 0) {
    return undefined;
  }
  const title = slicePart(attr, 0, hash, 'title', positionAt);
  const related = slicePart(attr, hash + 1, attr.raw.length, 'related', positionAt);
  if (!title || !related) {
    return undefined;
  }
  return [title, related];
}

function slicePart(
  attr: ScanAttribute,
  from: number,
  to: number,
  kind: 'title' | 'related',
  positionAt: (offset: number) => Position,
): NamePart | undefined {
  let rawStart = from;
  let rawEnd = to;
  while (rawStart < rawEnd && isSpace(attr.raw[rawStart])) {
    rawStart++;
  }
  while (rawEnd > rawStart && isSpace(attr.raw[rawEnd - 1])) {
    rawEnd--;
  }
  if (rawStart >= rawEnd) {
    return undefined;
  }
  const start = attr.startOffset + rawStart;
  const end = attr.startOffset + rawEnd;
  return { kind, range: { start: positionAt(start), end: positionAt(end) }, startOffset: start, endOffset: end };
}

function advanceRaw(raw: string, start: number, decodedSteps: number): number {
  let cursor = start;
  let seen = 0;
  while (cursor < raw.length && seen < decodedSteps) {
    if (raw[cursor] === '&') {
      const semi = raw.indexOf(';', cursor);
      cursor = semi < 0 ? cursor + 1 : semi + 1;
    } else {
      cursor++;
    }
    seen++;
  }
  return cursor;
}

function aliasNamesIn(scan: ScanResult, viewIndex: number): Set<string> {
  const names = new Set<string>();
  for (let index = 0; index < scan.elements.length; index++) {
    const element = scan.elements[index];
    if (element.name !== 'alias') {
      continue;
    }
    if (ancestorIndex(scan, index, (item) => item === scan.elements[viewIndex]) !== viewIndex) {
      continue;
    }
    const name = attribute(element, 'name')?.value.trim();
    if (name) {
      names.add(name);
    }
  }
  return names;
}

function prefixOf(text: string, attr: ScanAttribute, offset: number): string {
  return decodeEntities(text.slice(attr.startOffset, Math.min(offset, attr.endOffset)));
}

function insertPosition(text: string, element: ScanElement, positionAt: (offset: number) => Position): Position {
  const selfClosing = text[element.endOffset - 2] === '/';
  return positionAt(selfClosing ? element.endOffset - 2 : element.endOffset - 1);
}

function capitalize(name: string): string {
  if (!name) {
    return name;
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sameRange(left: Range, right: Range): boolean {
  return (
    left.start.line === right.start.line &&
    left.start.character === right.start.character &&
    left.end.line === right.end.line &&
    left.end.character === right.end.character
  );
}

function isSpace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

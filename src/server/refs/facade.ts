import { CompletionItem, CompletionItemKind, TextEdit } from 'vscode-languageserver';
import { shortEntityName } from '../index/entities';
import { EntityShape, FacadeTag, FieldDef, RelationshipDef } from '../index/model';
import { splitServiceName } from '../index/services';
import { WorkspaceIndex } from '../index/workspace';
import { Range, SymbolRecord } from '../types';
import { facadeDataChain, isFacadeDataElement, isFacadeRoot } from './facadeScope';
import { attribute, ScanElement, ScanResult, scanXml } from '../xml/scan';

export interface DescribedTag {
  kind: 'entity' | 'service' | 'field' | 'relationship' | 'unknown';
  symbols: SymbolRecord[];
  via: 'name' | 'alias';
  written: string;
  raw: string;
  deletePrefix: boolean;
  field?: FieldDef;
  relationship?: RelationshipDef;
  serviceName?: string;
  concatService: boolean;
}

const DELETE_PREFIX = 'delete-';

export function describeTag(tag: FacadeTag, index: WorkspaceIndex): DescribedTag {
  let parent: DescribedTag | undefined;
  let described = unknownTag('');
  for (const raw of tag.names) {
    described = describeSegment(raw, parent, index);
    parent = described;
    if (described.kind === 'unknown' && raw !== tag.names[tag.names.length - 1]) {
      return described;
    }
  }
  return described;
}

export function facadeCompletion(text: string, offset: number, index: WorkspaceIndex): CompletionItem[] | null {
  const scan = scanXml(text);
  const element = elementAt(scan, offset);
  if (!element || !isFacadeDataElement(scan, scan.elements.indexOf(element))) {
    return null;
  }
  if (offset >= element.nameStart && offset <= element.nameEnd) {
    const prefix = text.slice(element.nameStart, Math.min(offset, element.nameEnd));
    const labels = tagLabels(scan, element, prefix, index);
    return items(labels, element.nameRange, CompletionItemKind.Class, scan);
  }
  const token = attributeToken(text, element, offset);
  if (!token) {
    return null;
  }
  const tag = tagFor(scan, element);
  if (!tag) {
    return null;
  }
  const described = describeTag(tag, index);
  const prefix = text.slice(token.start, Math.min(offset, token.end));
  const labels = attributeLabels(described, prefix, index);
  if (!labels) {
    return null;
  }
  const range = { start: scan.positionAt(token.start), end: scan.positionAt(token.end) };
  return items(labels, range, CompletionItemKind.Field, scan);
}

function tagLabels(scan: ScanResult, element: ScanElement, prefix: string, index: WorkspaceIndex): string[] {
  const parent = scan.elements[element.parentIndex];
  if (!parent || isFacadeRoot(scan, element.parentIndex)) {
    return filterPrefix(rootLabels(index), prefix);
  }
  const parentTag = tagFor(scan, parent);
  if (!parentTag) {
    return [];
  }
  const described = describeTag(parentTag, index);
  const entities = contextEntities(described);
  if (entities.length === 0) {
    return [];
  }
  const labels = new Set<string>();
  for (const entity of entities) {
    const shape = index.entityShape(entity);
    for (const relationship of shape.relationships) {
      if (relationship.shortAlias) {
        labels.add(relationship.shortAlias);
      } else {
        labels.add(shortEntityName(relationship.related));
      }
      if (relationship.related) {
        labels.add(relationship.related);
      }
    }
    for (const field of shape.fields) {
      if (field.type === 'text-long') {
        labels.add(field.name);
      }
    }
  }
  return filterPrefix([...labels], prefix);
}

function rootLabels(index: WorkspaceIndex): string[] {
  const labels = new Set<string>();
  for (const record of index.entities()) {
    labels.add(record.name);
    for (const alias of record.aliases) {
      if (alias) {
        labels.add(alias);
      }
    }
    labels.add(`${DELETE_PREFIX}${shortEntityName(record.name)}`);
  }
  return [...labels];
}

function attributeLabels(described: DescribedTag, prefix: string, index: WorkspaceIndex): string[] | null {
  if (described.kind === 'unknown') {
    return null;
  }
  if (described.kind === 'field') {
    return [];
  }
  const labels = new Set<string>();
  if (described.kind === 'service') {
    for (const symbol of described.symbols) {
      for (const parameter of index.serviceParameters(symbol)) {
        labels.add(parameter.name);
      }
    }
    return filterPrefix([...labels], prefix);
  }
  const entities = contextEntities(described);
  let stamp = false;
  for (const entity of entities) {
    const shape = index.entityShape(entity);
    for (const field of shape.fields) {
      labels.add(field.name);
    }
    if (!shape.noUpdateStamp) {
      stamp = true;
    }
  }
  if (stamp) {
    labels.add('lastUpdatedStamp');
  }
  return filterPrefix([...labels], prefix);
}

function contextEntities(described: DescribedTag): SymbolRecord[] {
  if (described.kind === 'entity' || described.kind === 'relationship') {
    return described.symbols;
  }
  return [];
}

function items(labels: string[], range: Range, kind: CompletionItemKind, _scan: ScanResult): CompletionItem[] {
  labels.sort();
  return labels.map((label) => ({
    label,
    kind,
    filterText: label,
    textEdit: TextEdit.replace(range, label),
  }));
}

function describeSegment(raw: string, parent: DescribedTag | undefined, index: WorkspaceIndex): DescribedTag {
  const deletePrefix = raw.startsWith(DELETE_PREFIX);
  const written = (deletePrefix ? raw.slice(DELETE_PREFIX.length) : raw).trim();
  if (!written || written.includes('${')) {
    return unknownTag(raw);
  }
  const parents = contextEntities(parent ?? unknownTag(''));
  if (parents.length > 0 && maybeShortAlias(written)) {
    for (const symbol of parents) {
      const shape: EntityShape = index.entityShape(symbol);
      const relationship = shape.relationships.find((item) => relationshipMatches(item, written));
      if (relationship) {
        return {
          kind: 'relationship',
          symbols: index.findEntities(relationship.related),
          via: 'name',
          written,
          raw,
          deletePrefix,
          relationship,
          concatService: false,
        };
      }
      const field = shape.fields.find((item) => item.name === written);
      if (field) {
        return {
          kind: 'field',
          symbols: [symbol],
          via: 'name',
          written,
          raw,
          deletePrefix,
          field,
          concatService: false,
        };
      }
    }
  }
  const entities = index.findEntities(written);
  if (entities.length > 0) {
    return {
      kind: 'entity',
      symbols: entities,
      via: entityVia(written, entities),
      written,
      raw,
      deletePrefix,
      concatService: false,
    };
  }
  if (!deletePrefix) {
    const services = matchServices(written, index);
    if (services.records.length > 0) {
      return {
        kind: 'service',
        symbols: services.records,
        via: 'name',
        written,
        raw,
        deletePrefix: false,
        serviceName: services.records[0]?.name,
        concatService: services.concat,
      };
    }
  }
  return { ...unknownTag(raw), written, deletePrefix };
}

function matchServices(written: string, index: WorkspaceIndex): { records: SymbolRecord[]; concat: boolean } {
  const exact = index.findServices(written);
  if (exact.length > 0) {
    return { records: exact, concat: false };
  }
  const dot = written.lastIndexOf('.');
  if (dot <= 0) {
    return { records: [], concat: false };
  }
  const className = written.slice(0, dot);
  const verbNoun = written.slice(dot + 1);
  const records = index.services().filter((service) => {
    const parts = splitServiceName(service.name);
    return parts.className === className && `${parts.verb}${parts.noun}` === verbNoun;
  });
  return { records, concat: records.length > 0 };
}

function relationshipMatches(relationship: RelationshipDef, written: string): boolean {
  if (relationship.shortAlias && relationship.shortAlias === written) {
    return true;
  }
  if (relationship.related === written) {
    return true;
  }
  return !relationship.shortAlias && shortEntityName(relationship.related) === written;
}

function entityVia(written: string, entities: readonly SymbolRecord[]): 'name' | 'alias' {
  if (written.includes('.')) {
    return 'name';
  }
  if (entities.some((entity) => shortEntityName(entity.name) === written)) {
    return 'name';
  }
  return 'alias';
}

function maybeShortAlias(name: string): boolean {
  const first = name[0];
  return !name.includes('.') && first === first.toLowerCase() && first !== first.toUpperCase();
}

function unknownTag(raw: string): DescribedTag {
  return {
    kind: 'unknown',
    symbols: [],
    via: 'name',
    written: raw,
    raw,
    deletePrefix: false,
    concatService: false,
  };
}

function elementAt(scan: ScanResult, offset: number): ScanElement | undefined {
  for (let index = scan.elements.length - 1; index >= 0; index--) {
    const element = scan.elements[index];
    if (offset >= element.startOffset && offset <= element.endOffset) {
      return element;
    }
  }
  return undefined;
}

export function facadeTagAt(text: string, offset: number): FacadeTag | undefined {
  const scan = scanXml(text);
  for (let index = scan.elements.length - 1; index >= 0; index--) {
    const element = scan.elements[index];
    if (offset < element.nameStart || offset > element.nameEnd) {
      continue;
    }
    const tag = tagFor(scan, element);
    if (tag) {
      return tag;
    }
  }
  return undefined;
}

function tagFor(scan: ScanResult, element: ScanElement): FacadeTag | undefined {
  const chain = facadeDataChain(scan, scan.elements.indexOf(element));
  if (!chain || chain.dynamic) {
    return undefined;
  }
  return { uri: '', fsPath: '', names: chain.names, range: chain.leaf.nameRange };
}

function attributeToken(text: string, element: ScanElement, offset: number): { start: number; end: number } | undefined {
  if (offset <= element.nameEnd || offset > element.endOffset) {
    return undefined;
  }
  for (const attr of element.attributes) {
    if (offset > attr.startOffset && offset <= attr.endOffset) {
      return undefined;
    }
  }
  let index = element.nameEnd;
  while (index < element.endOffset && index < text.length) {
    const spaceStart = index;
    while (index < text.length && isSpace(text[index])) {
      index++;
    }
    if (offset >= spaceStart && offset <= index && offset > element.nameEnd && offset < element.endOffset) {
      const onName = index < text.length && isNameChar(text[index]) && offset === index;
      if (!onName && (offset < index || text[index] === '>' || text[index] === '/')) {
        return { start: offset, end: offset };
      }
    }
    if (index >= element.endOffset || text[index] === '>' || text[index] === '/') {
      break;
    }
    const start = index;
    while (index < text.length && isNameChar(text[index])) {
      index++;
    }
    if (offset >= start && offset <= index) {
      return { start, end: index };
    }
    while (index < text.length && isSpace(text[index])) {
      index++;
    }
    if (text[index] !== '=') {
      continue;
    }
    index++;
    while (index < text.length && isSpace(text[index])) {
      index++;
    }
    const quote = text[index];
    if (quote !== '"' && quote !== "'") {
      continue;
    }
    const valueEnd = text.indexOf(quote, index + 1);
    index = valueEnd < 0 ? text.length : valueEnd + 1;
  }
  return undefined;
}

function filterPrefix(labels: string[], prefix: string): string[] {
  return labels.filter((label) => label.startsWith(prefix));
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isNameChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || ch === '_' || ch === ':' || ch === '-' || ch === '.';
}

export function elementByRange(text: string, range: Range): ScanElement | undefined {
  const scan = scanXml(text);
  return scan.elements.find((element) => sameRange(element.startTagRange, range));
}

export function sameRange(left: Range, right: Range): boolean {
  return (
    left.start.line === right.start.line &&
    left.start.character === right.start.character &&
    left.end.line === right.end.line &&
    left.end.character === right.end.character
  );
}

export function attributeValue(element: ScanElement, name: string): { value: string; range: Range } | undefined {
  const attr = attribute(element, name);
  if (!attr) {
    return undefined;
  }
  return { value: attr.value, range: attr.range };
}

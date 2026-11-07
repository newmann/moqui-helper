import { CompletionItem, CompletionItemKind, TextEdit } from 'vscode-languageserver';
import { WorkspaceIndex } from '../index/workspace';
import { decodeEntities, scanXml } from '../xml/scan';

export const PARAMETER_TYPES = [
  'String',
  'Timestamp',
  'Time',
  'Date',
  'Integer',
  'Long',
  'Float',
  'Double',
  'BigDecimal',
  'BigInteger',
  'Boolean',
  'Object',
  'Blob',
  'Clob',
  'Collection',
  'List',
  'Map',
  'Set',
  'Node',
];

export const FORMAT_VALUES = [
  'MM/yyyy',
  'yyyy-MM-dd',
  'yyyy-MM-dd HH:mm',
  'yyyy-MM-dd HH:mm:ss',
  'yyyy-MM-dd HH:mm:ss.SSS z',
  '0000',
  '0.00',
  '0.000',
  '0.00#',
  '#,##0.00',
  '#,##0.###',
];

const PACKAGE_TAGS = new Set(['entity', 'view-entity', 'extend-entity']);
const FORMAT_TAGS = new Set(['parameter', 'time-range', 'compare', 'date-find', 'date-time', 'display', 'text-line']);

type FixedKind = 'package' | 'type' | 'format';

export function fixedValueCompletion(text: string, offset: number, index: WorkspaceIndex): CompletionItem[] | null {
  const scan = scanXml(text);
  for (const element of scan.elements) {
    for (const attr of element.attributes) {
      if (offset < attr.startOffset || offset > attr.endOffset) {
        continue;
      }
      const kind = fixedKind(element.name, attr.name);
      if (!kind || attr.value.includes('${')) {
        return null;
      }
      const prefix = decodeEntities(text.slice(attr.startOffset, Math.min(offset, attr.endOffset)));
      const labels = labelsFor(kind, prefix, index);
      labels.sort();
      return labels.map((label) => ({
        label,
        kind: itemKind(kind),
        filterText: label,
        textEdit: TextEdit.replace(attr.range, label),
      }));
    }
  }
  return null;
}

function fixedKind(elementName: string, attributeName: string): FixedKind | undefined {
  if (attributeName === 'package' && PACKAGE_TAGS.has(elementName)) {
    return 'package';
  }
  if (attributeName === 'type' && elementName === 'parameter') {
    return 'type';
  }
  if (attributeName === 'format' && FORMAT_TAGS.has(elementName)) {
    return 'format';
  }
  return undefined;
}

function labelsFor(kind: FixedKind, prefix: string, index: WorkspaceIndex): string[] {
  const source = kind === 'package' ? index.packages() : kind === 'type' ? PARAMETER_TYPES : FORMAT_VALUES;
  return source.filter((label) => label.startsWith(prefix));
}

function itemKind(kind: FixedKind): CompletionItemKind {
  if (kind === 'package') {
    return CompletionItemKind.Module;
  }
  if (kind === 'type') {
    return CompletionItemKind.Class;
  }
  return CompletionItemKind.Value;
}

import { Location } from 'vscode-languageserver';
import { WorkspaceIndex } from '../index/workspace';
import { Range } from '../types';
import { attribute, scanXml } from '../xml/scan';

const TEXT_ROOTS = new Set(['screen', 'screen-extend', 'widget-templates']);
const TEXT_TAGS = new Set(['display', 'display-entity', 'label', 'link', 'entity-options', 'list-options']);

export interface TextTemplateUse {
  value: string;
  range: Range;
  startOffset: number;
  endOffset: number;
}

export function collectTextTemplateUses(text: string): TextTemplateUse[] {
  const scan = scanXml(text);
  if (!scan.rootName || !TEXT_ROOTS.has(scan.rootName)) {
    return [];
  }
  const uses: TextTemplateUse[] = [];
  for (const element of scan.elements) {
    if (!TEXT_TAGS.has(element.name)) {
      continue;
    }
    const textAttribute = attribute(element, 'text');
    if (!textAttribute) {
      continue;
    }
    uses.push({
      value: textAttribute.value,
      range: textAttribute.range,
      startOffset: textAttribute.startOffset,
      endOffset: textAttribute.endOffset,
    });
  }
  return uses;
}

export function textTemplateUseAt(text: string, offset: number): TextTemplateUse | undefined {
  const uses = collectTextTemplateUses(text);
  for (let index = uses.length - 1; index >= 0; index--) {
    const use = uses[index];
    if (offset >= use.startOffset && offset <= use.endOffset) {
      return use;
    }
  }
  return undefined;
}

export function textTemplateLabels(prefix: string, index: WorkspaceIndex): string[] {
  const labels = index.textTemplateOriginals().filter((original) => original.startsWith(prefix));
  labels.sort((left, right) => left.localeCompare(right));
  return labels;
}

export function textTemplateLocations(use: TextTemplateUse, index: WorkspaceIndex): Location[] {
  if (!use.value) {
    return [];
  }
  return index.findTextTemplates(use.value).map((template) => ({
    uri: template.uri,
    range: template.originalRange,
  }));
}

export function encodeXmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

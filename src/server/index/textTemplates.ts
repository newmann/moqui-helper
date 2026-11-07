import { Range } from '../types';
import { attribute, ScanResult } from '../xml/scan';

export interface TextTemplateDef {
  original: string;
  uri: string;
  fsPath: string;
  originalRange: Range;
}

const TEMPLATE_TAGS = new Set(['LocalizedMessage', 'moqui.basic.LocalizedMessage']);

export function extractTextTemplates(scan: ScanResult, uri: string, fsPath: string): TextTemplateDef[] {
  if (scan.rootName !== 'entity-facade-xml') {
    return [];
  }
  const templates: TextTemplateDef[] = [];
  for (const element of scan.elements) {
    if (element.parentIndex !== 0 || !TEMPLATE_TAGS.has(element.name)) {
      continue;
    }
    const locale = attribute(element, 'locale');
    const original = attribute(element, 'original');
    if (!locale || locale.value !== 'default' || !original || original.value === '') {
      continue;
    }
    templates.push({
      original: original.value,
      uri,
      fsPath,
      originalRange: original.range,
    });
  }
  return templates;
}

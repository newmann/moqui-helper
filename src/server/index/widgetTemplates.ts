import { Range } from '../types';
import { attribute, ScanResult } from '../xml/scan';

export interface WidgetTemplateDef {
  name: string;
  uri: string;
  fsPath: string;
  nameRange: Range;
}

export function extractWidgetTemplates(scan: ScanResult, uri: string, fsPath: string): WidgetTemplateDef[] {
  if (scan.rootName !== 'widget-templates') {
    return [];
  }
  const templates: WidgetTemplateDef[] = [];
  for (const element of scan.elements) {
    if (element.name !== 'widget-template') {
      continue;
    }
    const nameAttribute = attribute(element, 'name');
    const name = nameAttribute?.value.trim() ?? '';
    if (!nameAttribute || !name || name.includes('${')) {
      continue;
    }
    templates.push({
      name,
      uri,
      fsPath,
      nameRange: nameAttribute.range,
    });
  }
  return templates;
}

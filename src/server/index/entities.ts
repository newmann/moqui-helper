import { SymbolRecord } from '../types';
import { attribute, ScanResult } from '../xml/scan';

export function extractEntities(scan: ScanResult, uri: string): SymbolRecord[] {
  if (scan.rootName !== 'entities') {
    return [];
  }
  const records: SymbolRecord[] = [];
  for (const element of scan.elements) {
    if (element.name !== 'entity' && element.name !== 'view-entity') {
      continue;
    }
    const entityName = attribute(element, 'entity-name')?.value.trim();
    const packageName = attribute(element, 'package')?.value.trim();
    if (!entityName || !packageName) {
      continue;
    }
    const alias = attribute(element, 'short-alias')?.value.trim();
    records.push({
      kind: element.name === 'view-entity' ? 'view-entity' : 'entity',
      name: `${packageName}.${entityName}`,
      aliases: alias ? [alias] : [],
      uri,
      range: element.startTagRange,
    });
  }
  return records;
}

export function extractPackages(scan: ScanResult): string[] {
  if (scan.rootName !== 'entities') {
    return [];
  }
  const names: string[] = [];
  for (const element of scan.elements) {
    if (element.name !== 'entity' && element.name !== 'view-entity') {
      continue;
    }
    const entityName = attribute(element, 'entity-name')?.value.trim();
    const packageName = attribute(element, 'package')?.value.trim();
    if (!entityName || !packageName || packageName.includes('${')) {
      continue;
    }
    names.push(packageName);
  }
  return names;
}

export function shortEntityName(canonical: string): string {
  const dot = canonical.lastIndexOf('.');
  return dot < 0 ? canonical : canonical.slice(dot + 1);
}

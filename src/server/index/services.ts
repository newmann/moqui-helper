import { SymbolRecord } from '../types';
import { attribute, ScanResult } from '../xml/scan';
import { ComponentInfo, containingComponent, relativeToComponent } from './components';

export const CRUD_VERBS = ['create', 'update', 'delete', 'store'] as const;

const CRUD_VERB_SET = new Set<string>(CRUD_VERBS);

export function isCrudVerb(verb: string): boolean {
  return CRUD_VERB_SET.has(verb);
}

export function serviceClassName(filePath: string, components: readonly ComponentInfo[]): string | undefined {
  const component = containingComponent(filePath, components);
  if (!component) {
    return undefined;
  }
  const relative = relativeToComponent(filePath, component);
  if (!relative || !relative.startsWith('service/') || !relative.toLowerCase().endsWith('.xml')) {
    return undefined;
  }
  const dotted = relative.slice('service/'.length, relative.length - '.xml'.length).replace(/\//g, '.');
  if (!dotted || dotted.startsWith('.') || dotted.endsWith('.') || dotted.includes('..')) {
    return undefined;
  }
  return dotted;
}

export function serviceFullName(className: string, verb: string, noun: string): string {
  return noun ? `${className}.${verb}#${noun}` : `${className}.${verb}`;
}

export function splitServiceName(name: string): { className: string; verb: string; noun: string } {
  const hash = name.indexOf('#');
  const pathPart = hash < 0 ? name : name.slice(0, hash);
  const noun = hash < 0 ? '' : name.slice(hash + 1);
  const dot = pathPart.lastIndexOf('.');
  if (dot < 0) {
    return { className: '', verb: pathPart, noun };
  }
  return { className: pathPart.slice(0, dot), verb: pathPart.slice(dot + 1), noun };
}

export function extractServices(
  scan: ScanResult,
  filePath: string,
  uri: string,
  components: readonly ComponentInfo[],
): SymbolRecord[] {
  if (scan.rootName !== 'services') {
    return [];
  }
  const className = serviceClassName(filePath, components);
  if (!className) {
    return [];
  }
  const records: SymbolRecord[] = [];
  for (const element of scan.elements) {
    if (element.name !== 'service') {
      continue;
    }
    const verb = attribute(element, 'verb')?.value.trim();
    if (!verb) {
      continue;
    }
    const noun = attribute(element, 'noun')?.value.trim() ?? '';
    records.push({
      kind: 'service',
      name: serviceFullName(className, verb, noun),
      aliases: [],
      uri,
      range: element.startTagRange,
    });
  }
  return records;
}

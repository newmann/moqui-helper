import type { WorkspaceIndex } from '../index/workspace';
import { splitServiceName } from '../index/services';
import type { ServiceModel } from '../index/model';
import { Range, SymbolRecord } from '../types';
import { attribute, scanXml } from '../xml/scan';
import { sameRange } from './facade';
import { resolveResourceLocation } from './resolve';

export interface ServiceIncludeRef {
  part: 'verb' | 'noun';
  verb: string;
  noun: string;
  location: string;
  range: Range;
  startOffset: number;
  endOffset: number;
}

export interface IndexedIncludeRef {
  part: 'verb' | 'noun';
  verb: string;
  noun: string;
  location: string;
  uri: string;
  fsPath: string;
  range: Range;
}

export interface IncludeMatch {
  symbol: SymbolRecord;
  range: Range;
}

export type IncludeResolve =
  | { status: 'skip' }
  | { status: 'location-missing' }
  | { status: 'ok'; matches: IncludeMatch[] }
  | { status: 'missing'; range: Range; messageKey: 'unresolvedService'; messageArgs: string[] };

export function collectServiceIncludeRefs(text: string): ServiceIncludeRef[] {
  const scan = scanXml(text);
  const refs: ServiceIncludeRef[] = [];
  for (const element of scan.elements) {
    if (element.name !== 'service-include') {
      continue;
    }
    const locationAttribute = attribute(element, 'location');
    const location = locationAttribute?.value.trim() ?? '';
    if (!location || location.includes('${')) {
      continue;
    }
    const verbAttribute = attribute(element, 'verb');
    const nounAttribute = attribute(element, 'noun');
    if (verbAttribute?.value.includes('${') || nounAttribute?.value.includes('${')) {
      continue;
    }
    const verb = verbAttribute?.value.trim() ?? '';
    const noun = nounAttribute?.value.trim() ?? '';
    if (verbAttribute && verb) {
      refs.push({
        part: 'verb',
        verb,
        noun,
        location,
        range: verbAttribute.range,
        startOffset: verbAttribute.startOffset,
        endOffset: verbAttribute.endOffset,
      });
    }
    if (nounAttribute && noun) {
      refs.push({
        part: 'noun',
        verb,
        noun,
        location,
        range: nounAttribute.range,
        startOffset: nounAttribute.startOffset,
        endOffset: nounAttribute.endOffset,
      });
    }
  }
  return refs;
}

export function collectIndexedIncludeRefs(text: string, uri: string, fsPath: string): IndexedIncludeRef[] {
  return collectServiceIncludeRefs(text).map((ref) => ({
    part: ref.part,
    verb: ref.verb,
    noun: ref.noun,
    location: ref.location,
    uri,
    fsPath,
    range: ref.range,
  }));
}

export function includeRefAt(refs: readonly ServiceIncludeRef[], offset: number): ServiceIncludeRef | undefined {
  for (let index = refs.length - 1; index >= 0; index--) {
    const ref = refs[index];
    if (offset >= ref.startOffset && offset <= ref.endOffset) {
      return ref;
    }
  }
  return undefined;
}

export function resolveServiceInclude(
  ref: Pick<ServiceIncludeRef, 'part' | 'verb' | 'noun' | 'location' | 'range'>,
  fromFsPath: string,
  index: WorkspaceIndex,
): IncludeResolve {
  const located = resolveResourceLocation(ref.location, fromFsPath, index);
  if (located.status !== 'ok') {
    if (located.status === 'missing' || located.status === 'not-path') {
      return { status: 'location-missing' };
    }
    return { status: 'skip' };
  }
  const matches: IncludeMatch[] = [];
  for (const model of index.serviceModelsIn(located.fsPath)) {
    const parts = splitServiceName(model.name);
    if (parts.verb !== ref.verb || parts.noun !== ref.noun) {
      continue;
    }
    const symbol = symbolForModel(model, index);
    const range = ref.part === 'noun' ? model.nounRange : model.verbRange;
    if (!symbol || !range) {
      continue;
    }
    matches.push({ symbol, range });
  }
  if (matches.length > 0) {
    return { status: 'ok', matches };
  }
  const label = ref.noun ? `${ref.verb}#${ref.noun}` : ref.verb;
  return {
    status: 'missing',
    range: ref.range,
    messageKey: 'unresolvedService',
    messageArgs: [label],
  };
}

export function includeLabels(ref: ServiceIncludeRef, prefix: string, fromFsPath: string, index: WorkspaceIndex): string[] {
  const located = resolveResourceLocation(ref.location, fromFsPath, index);
  if (located.status !== 'ok') {
    return [];
  }
  const labels = new Set<string>();
  for (const model of index.serviceModelsIn(located.fsPath)) {
    const parts = splitServiceName(model.name);
    if (ref.part === 'verb') {
      if (parts.verb.startsWith(prefix)) {
        labels.add(parts.verb);
      }
      continue;
    }
    if (ref.verb && parts.verb !== ref.verb) {
      continue;
    }
    if (parts.noun.startsWith(prefix)) {
      labels.add(parts.noun);
    }
  }
  return [...labels];
}

function symbolForModel(model: ServiceModel, index: WorkspaceIndex): SymbolRecord | undefined {
  return index.findServices(model.name).find((symbol) => symbol.uri === model.uri && sameRange(symbol.range, model.range));
}

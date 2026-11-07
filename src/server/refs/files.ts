import type { WorkspaceIndex } from '../index/workspace';
import { Range } from '../types';
import { attribute, decodeEntities, scanXml } from '../xml/scan';
import { resolveResourceLocation } from './resolve';

const FILE_LOCATION_TAGS = new Set([
  'service-include',
  'service',
  'script',
  'text',
  'service-file',
  'service-location',
]);

const STRICT_FILE_TAGS = new Set(['service-include', 'service-file']);

export interface FileRef {
  lookup: string;
  range: Range;
  startOffset: number;
  endOffset: number;
  dynamic: boolean;
  strict: boolean;
}

export type FileResolve =
  | { status: 'skip' }
  | { status: 'ok'; fsPath: string }
  | { status: 'missing'; range: Range; messageKey: 'unresolvedFile'; messageArgs: string[] };

export function collectFileRefs(text: string): FileRef[] {
  const scan = scanXml(text);
  const refs: FileRef[] = [];
  for (const element of scan.elements) {
    if (!FILE_LOCATION_TAGS.has(element.name)) {
      continue;
    }
    const location = attribute(element, 'location');
    if (!location) {
      continue;
    }
    const hash = location.raw.indexOf('#');
    const rawFile = hash < 0 ? location.raw : location.raw.slice(0, hash);
    const endOffset = hash < 0 ? location.endOffset : location.startOffset + hash;
    refs.push({
      lookup: decodeEntities(rawFile).trim(),
      range: { start: scan.positionAt(location.startOffset), end: scan.positionAt(endOffset) },
      startOffset: location.startOffset,
      endOffset,
      dynamic: rawFile.includes('${'),
      strict: STRICT_FILE_TAGS.has(element.name),
    });
  }
  return refs;
}

export function fileRefAt(refs: readonly FileRef[], offset: number): FileRef | undefined {
  for (let index = refs.length - 1; index >= 0; index--) {
    const ref = refs[index];
    if (offset >= ref.startOffset && offset <= ref.endOffset) {
      return ref;
    }
  }
  return undefined;
}

export function resolveFileRef(ref: FileRef, fromFsPath: string, index: WorkspaceIndex): FileResolve {
  if (ref.dynamic || !ref.lookup) {
    return { status: 'skip' };
  }
  const located = resolveResourceLocation(ref.lookup, fromFsPath, index);
  if (located.status === 'ok') {
    return { status: 'ok', fsPath: located.fsPath };
  }
  if (located.status === 'missing' || (ref.strict && located.status === 'not-path')) {
    return {
      status: 'missing',
      range: ref.range,
      messageKey: 'unresolvedFile',
      messageArgs: [ref.lookup],
    };
  }
  return { status: 'skip' };
}

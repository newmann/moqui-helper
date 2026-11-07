import * as fs from 'fs';
import * as path from 'path';
import { Location } from 'vscode-languageserver';
import type { WidgetTemplateDef } from '../index/widgetTemplates';
import type { WorkspaceIndex } from '../index/workspace';
import { fsPathToUri, isInside, pathKey, toPosix } from '../paths';
import { Range } from '../types';
import { attribute, decodeEntities, ScanAttribute, ScanElement, scanXml } from '../xml/scan';
import { mapBaseLocation, resolveResourceLocation } from './resolve';

const LOCATION_TAGS = new Set(['load-data', 'load-entity', 'macro-template']);
const URL_TAGS = new Set(['link', 'image', 'default-response', 'conditional-response', 'error-response']);
const SHORTHAND_HEADS = ['system', 'tools', 'apps', 'qapps'];

export interface PathRef {
  lookup: string;
  range: Range;
  startOffset: number;
  endOffset: number;
  dynamic: boolean;
  templateInclude: boolean;
  fragment?: string;
  fragmentRange?: Range;
  fragmentStart?: number;
  fragmentEnd?: number;
  fragmentDynamic?: boolean;
}

export interface PathHit {
  ref: PathRef;
  part: 'file' | 'fragment';
}

export interface IndexedTemplateInclude {
  location: string;
  name: string;
  uri: string;
  fsPath: string;
  range: Range;
}

export interface PathDiagnostic {
  range: Range;
  messageKey: 'unresolvedFile' | 'unresolvedWidgetTemplate';
  messageArgs: string[];
}

export interface PathLabel {
  label: string;
  directory: boolean;
}

export function collectPathRefs(text: string): PathRef[] {
  const scan = scanXml(text);
  const refs: PathRef[] = [];
  for (const element of scan.elements) {
    const spec = pathAttribute(element);
    if (!spec) {
      continue;
    }
    refs.push(pathRef(spec.attribute, scan.positionAt, spec.templateInclude));
  }
  return refs;
}

export function pathRefAt(refs: readonly PathRef[], offset: number): PathHit | undefined {
  for (let index = refs.length - 1; index >= 0; index--) {
    const ref = refs[index];
    if (
      ref.fragmentStart !== undefined &&
      ref.fragmentEnd !== undefined &&
      offset >= ref.fragmentStart &&
      offset <= ref.fragmentEnd
    ) {
      return { ref, part: 'fragment' };
    }
    if (offset >= ref.startOffset && offset <= ref.endOffset) {
      return { ref, part: 'file' };
    }
  }
  return undefined;
}

export function collectIndexedTemplateIncludes(text: string, uri: string, fsPath: string): IndexedTemplateInclude[] {
  const includes: IndexedTemplateInclude[] = [];
  for (const ref of collectPathRefs(text)) {
    if (!ref.templateInclude || !ref.fragment || !ref.fragmentRange || ref.dynamic || ref.fragmentDynamic) {
      continue;
    }
    includes.push({
      location: ref.lookup,
      name: ref.fragment,
      uri,
      fsPath,
      range: ref.fragmentRange,
    });
  }
  return includes;
}

export function pathDiagnostics(ref: PathRef, fromFsPath: string, index: WorkspaceIndex): PathDiagnostic[] {
  const found = resolvePathFile(ref, fromFsPath, index);
  const diagnostics: PathDiagnostic[] = [];
  if (found.status === 'missing') {
    diagnostics.push({
      range: ref.range,
      messageKey: 'unresolvedFile',
      messageArgs: [ref.lookup],
    });
  }
  if (ref.templateInclude && ref.fragmentRange && !ref.fragmentDynamic && found.status === 'ok') {
    const name = ref.fragment ?? '';
    const matched = index.templatesIn(found.fsPath).some((template) => template.name === name);
    if (!matched) {
      diagnostics.push({
        range: ref.fragmentRange,
        messageKey: 'unresolvedWidgetTemplate',
        messageArgs: [name],
      });
    }
  }
  return diagnostics;
}

export function pathDefinition(hit: PathHit, fromFsPath: string, index: WorkspaceIndex): Location[] | null {
  const found = resolvePathFile(hit.ref, fromFsPath, index);
  if (found.status !== 'ok') {
    return null;
  }
  if (hit.part === 'fragment') {
    if (hit.ref.fragmentDynamic) {
      return null;
    }
    const matches = index.templatesIn(found.fsPath).filter((template) => template.name === hit.ref.fragment);
    return matches.length > 0 ? matches.map((template) => ({ uri: template.uri, range: template.nameRange })) : null;
  }
  const uri = index.fileUri(found.fsPath) ?? fsPathToUri(found.fsPath);
  const origin = { line: 0, character: 0 };
  return [{ uri, range: { start: origin, end: origin } }];
}

export function pathLabels(prefix: string, fromFsPath: string, index: WorkspaceIndex): PathLabel[] {
  if (prefix.includes('${') || prefix.startsWith('http://') || prefix.startsWith('https://') || prefix.startsWith('content:')) {
    return [];
  }
  if (prefix.startsWith('component://')) {
    return componentLabels(prefix, index);
  }
  if (prefix.startsWith('classpath://')) {
    return rootedLabels(prefix, 'classpath://', index);
  }
  if (prefix.startsWith('./') || prefix.startsWith('../')) {
    return relativeLabels(prefix, fromFsPath, index);
  }
  if (prefix.startsWith('//')) {
    return shorthandLabels(prefix, index);
  }
  if (prefix.includes('/')) {
    return rootedLabels(prefix, '', index);
  }
  return dedupeLabels(
    componentNames(index)
      .map((name) => ({ label: `component://${name}/`, directory: true }))
      .filter((item) => item.label.startsWith(prefix)),
  );
}

export function templateNameLabels(ref: PathRef, prefix: string, fromFsPath: string, index: WorkspaceIndex): string[] {
  if (ref.dynamic || ref.fragmentDynamic) {
    return [];
  }
  const found = resolvePathFile(ref, fromFsPath, index);
  if (found.status !== 'ok') {
    return [];
  }
  const names = new Set<string>();
  for (const template of index.templatesIn(found.fsPath)) {
    if (template.name.startsWith(prefix)) {
      names.add(template.name);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

export function templateReferenceLocations(template: WidgetTemplateDef, index: WorkspaceIndex): Location[] {
  const target = pathKey(template.fsPath);
  const locations: Location[] = [];
  const seen = new Set<string>();
  for (const ref of index.allTemplateIncludes()) {
    if (ref.name !== template.name) {
      continue;
    }
    const located = resolveResourceLocation(ref.location, ref.fsPath, index);
    if (located.status !== 'ok' || pathKey(located.fsPath) !== target) {
      continue;
    }
    const key = `${ref.uri}\n${ref.range.start.line}:${ref.range.start.character}:${ref.range.end.line}:${ref.range.end.character}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    locations.push({ uri: ref.uri, range: ref.range });
  }
  return locations;
}

function pathAttribute(element: ScanElement): { attribute: ScanAttribute; templateInclude: boolean } | undefined {
  if (element.name === 'widget-template-include') {
    const location = attribute(element, 'location');
    return location ? { attribute: location, templateInclude: true } : undefined;
  }
  if (LOCATION_TAGS.has(element.name)) {
    const location = attribute(element, 'location');
    return location ? { attribute: location, templateInclude: false } : undefined;
  }
  if (URL_TAGS.has(element.name)) {
    const url = attribute(element, 'url');
    return url ? { attribute: url, templateInclude: false } : undefined;
  }
  if (element.name === 'screen' || element.name === 'screen-extend') {
    if (attribute(element, 'menu-image-type')?.value.trim() === 'icon') {
      return undefined;
    }
    const image = attribute(element, 'menu-image');
    return image ? { attribute: image, templateInclude: false } : undefined;
  }
  if (element.name === 'screen-text-output') {
    const location = attribute(element, 'macro-template-location');
    return location ? { attribute: location, templateInclude: false } : undefined;
  }
  if (element.name === 'resource-facade') {
    const location = attribute(element, 'xml-actions-template-location');
    return location ? { attribute: location, templateInclude: false } : undefined;
  }
  return undefined;
}

function pathRef(
  attr: ScanAttribute,
  positionAt: (offset: number) => { line: number; character: number },
  templateInclude: boolean,
): PathRef {
  const hash = templateInclude ? attr.raw.indexOf('#') : -1;
  if (hash >= 0) {
    const rawFile = attr.raw.slice(0, hash);
    const rawFragment = attr.raw.slice(hash + 1);
    const fragmentStart = attr.startOffset + hash + 1;
    return {
      lookup: decodeEntities(rawFile).trim(),
      range: { start: positionAt(attr.startOffset), end: positionAt(attr.startOffset + hash) },
      startOffset: attr.startOffset,
      endOffset: attr.startOffset + hash,
      dynamic: rawFile.includes('${'),
      templateInclude: true,
      fragment: decodeEntities(rawFragment).trim(),
      fragmentRange: { start: positionAt(fragmentStart), end: positionAt(attr.endOffset) },
      fragmentStart,
      fragmentEnd: attr.endOffset,
      fragmentDynamic: rawFragment.includes('${'),
    };
  }
  return {
    lookup: decodeEntities(attr.raw).trim(),
    range: attr.range,
    startOffset: attr.startOffset,
    endOffset: attr.endOffset,
    dynamic: attr.raw.includes('${'),
    templateInclude,
  };
}

function resolvePathFile(
  ref: PathRef,
  fromFsPath: string,
  index: WorkspaceIndex,
): { status: 'skip' } | { status: 'ok'; fsPath: string } | { status: 'missing' } {
  if (ref.dynamic || !ref.lookup || ref.lookup === '.' || ref.lookup === '..') {
    return { status: 'skip' };
  }
  const located = resolveResourceLocation(ref.lookup, fromFsPath, index);
  if (located.status === 'ok') {
    return { status: 'ok', fsPath: located.fsPath };
  }
  if (located.status === 'missing') {
    return { status: 'missing' };
  }
  return { status: 'skip' };
}

function componentLabels(prefix: string, index: WorkspaceIndex): PathLabel[] {
  const rest = prefix.slice('component://'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) {
    return dedupeLabels(
      componentNames(index)
        .filter((name) => name.startsWith(rest))
        .map((name) => ({ label: `component://${name}/`, directory: true })),
    );
  }
  const name = rest.slice(0, slash);
  const tail = rest.slice(slash + 1);
  const last = tail.lastIndexOf('/');
  const parentRelative = last < 0 ? '' : tail.slice(0, last);
  const partial = last < 0 ? tail : tail.slice(last + 1);
  const labels: PathLabel[] = [];
  for (const component of index.componentsNamed(name)) {
    const dir = parentRelative
      ? path.join(component.rootPath, ...parentRelative.split('/'))
      : component.rootPath;
    if (!isInside(dir, component.rootPath)) {
      continue;
    }
    for (const child of listChildren(dir, partial)) {
      const relative = parentRelative ? `${parentRelative}/${child.name}` : child.name;
      const suffix = child.directory ? '/' : '';
      labels.push({ label: `component://${name}/${relative}${suffix}`, directory: child.directory });
    }
  }
  return dedupeLabels(labels.filter((item) => item.label.startsWith(prefix)));
}

function relativeLabels(prefix: string, fromFsPath: string, index: WorkspaceIndex): PathLabel[] {
  if (!fromFsPath) {
    return [];
  }
  const last = prefix.lastIndexOf('/');
  const parentPart = toPosix(prefix.slice(0, last));
  const partial = prefix.slice(last + 1);
  const dir = path.normalize(path.resolve(path.dirname(fromFsPath), parentPart));
  if (!insideBases(dir, index.getWorkspaceRoots())) {
    return [];
  }
  const labels: PathLabel[] = [];
  for (const child of listChildren(dir, partial)) {
    const suffix = child.directory ? '/' : '';
    labels.push({ label: `${parentPart}/${child.name}${suffix}`, directory: child.directory });
  }
  return dedupeLabels(labels.filter((item) => item.label.startsWith(prefix)));
}

function shorthandLabels(prefix: string, index: WorkspaceIndex): PathLabel[] {
  const remainder = prefix.slice(2);
  const slash = remainder.lastIndexOf('/');
  if (slash < 0) {
    return dedupeLabels(
      SHORTHAND_HEADS.filter((head) => head.startsWith(remainder)).map((head) => ({
        label: `//${head}/`,
        directory: true,
      })),
    );
  }
  const parent = remainder.slice(0, slash);
  const partial = remainder.slice(slash + 1);
  const mapped = mapBaseLocation(`${parent}/`);
  if (!mapped) {
    const parts = parent.split('/').filter((part) => part.length > 0);
    if (parts.length === 0 || !parts.every((part) => part === 'apps' || part === 'qapps')) {
      return [];
    }
    return dedupeLabels(
      SHORTHAND_HEADS.filter((head) => head.startsWith(partial)).map((head) => ({
        label: `//${parent}/${head}/`,
        directory: true,
      })),
    );
  }
  const relative = mapped.replace(/\/+$/, '');
  const labels: PathLabel[] = [];
  for (const root of index.getWorkspaceRoots()) {
    const dir = path.join(root, ...relative.split('/'));
    if (!isInside(dir, root)) {
      continue;
    }
    for (const child of listChildren(dir, partial)) {
      const suffix = child.directory ? '/' : '';
      labels.push({ label: `//${parent}/${child.name}${suffix}`, directory: child.directory });
    }
  }
  return dedupeLabels(labels.filter((item) => item.label.startsWith(prefix)));
}

function rootedLabels(prefix: string, scheme: string, index: WorkspaceIndex): PathLabel[] {
  const rest = scheme ? prefix.slice(scheme.length) : prefix;
  const slash = rest.lastIndexOf('/');
  const parentRelative = slash < 0 ? '' : rest.slice(0, slash);
  const partial = slash < 0 ? rest : rest.slice(slash + 1);
  const bases = searchBases(index);
  const labels: PathLabel[] = [];
  for (const base of bases) {
    const dir = parentRelative ? path.normalize(path.join(base, ...parentRelative.split('/'))) : path.normalize(base);
    if (!isInside(dir, base)) {
      continue;
    }
    for (const child of listChildren(dir, partial)) {
      const relative = parentRelative ? `${parentRelative}/${child.name}` : child.name;
      const suffix = child.directory ? '/' : '';
      labels.push({ label: `${scheme}${relative}${suffix}`, directory: child.directory });
    }
  }
  return dedupeLabels(labels.filter((item) => item.label.startsWith(prefix)));
}

function componentNames(index: WorkspaceIndex): string[] {
  return [...new Set(index.components().map((component) => component.name))].sort((left, right) => left.localeCompare(right));
}

function searchBases(index: WorkspaceIndex): string[] {
  const seen = new Set<string>();
  const bases: string[] = [];
  for (const base of [...index.getWorkspaceRoots(), ...index.components().map((component) => component.rootPath)]) {
    const key = pathKey(base);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    bases.push(base);
  }
  return bases;
}

function insideBases(dir: string, bases: readonly string[]): boolean {
  return bases.some((base) => isInside(dir, base));
}

function listChildren(dir: string, partial: string): { name: string; directory: boolean }[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const children: { name: string; directory: boolean }[] = [];
  for (const entry of entries) {
    if (!entry.name.startsWith(partial)) {
      continue;
    }
    children.push({ name: entry.name, directory: entry.isDirectory() });
  }
  return children;
}

function dedupeLabels(labels: PathLabel[]): PathLabel[] {
  const seen = new Map<string, PathLabel>();
  for (const label of labels) {
    if (!seen.has(label.label)) {
      seen.set(label.label, label);
    }
  }
  return [...seen.values()].sort((left, right) => left.label.localeCompare(right.label));
}

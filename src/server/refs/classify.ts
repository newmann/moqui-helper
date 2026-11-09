import { formKey } from '../index/screenMembers';
import { Position, Range } from '../types';
import { attribute, decodeEntities, ScanAttribute, ScanElement, scanXml } from '../xml/scan';

export interface ServiceCallNamed {
  kind: 'named';
}

export interface ServiceCallCrud {
  kind: 'crud';
  verb: string;
  entityName: string;
  entityRange: Range;
  entityStart: number;
  entityEnd: number;
}

export type ServiceCall = ServiceCallNamed | ServiceCallCrud;

export interface ClassifiedRef {
  kind: 'entity' | 'service' | 'screen';
  lookup: string;
  range: Range;
  startOffset: number;
  endOffset: number;
  dynamic: boolean;
  skipDiagnostic: boolean;
  entityCompletion: 'canonical' | 'short';
  serviceCall?: ServiceCall;
  interfacesOnly?: boolean;
}

const ENTITY_NAME_TAGS = new Set([
  'entity-find',
  'entity-find-one',
  'entity-find-count',
  'entity-make-value',
  'entity-delete-by-condition',
  'member-entity',
  'auto-parameters',
  'parameter',
  'auto-fields-entity',
  'auto-widget-entity',
  'display-entity',
  'link',
]);

const SCREEN_LOCATION_TAGS = new Set([
  'subscreens-item',
  'include-screen',
  'section-include',
  'transition-include',
  'root-screen',
  'screen',
]);

const SERVICE_NAME_TAGS = new Set([
  'inbox-source',
  'recipient-source',
  'record-lookup',
  'record-link',
  'create-from',
  'invitation',
  'contact-card',
  'meetings-source',
  'call-context',
  'home-source',
  'external-conversation',
  'sms-consent',
  'call-target',
  'today-source',
  'palette-source',
  'delegate',
  'queue-kind',
  'user-facts',
  'constitution-provider',
  'ai-task',
]);

const RECORD_ENTITY_TAGS = new Set(['context', 'chatter', 'record-files']);

export function collectRefs(text: string): ClassifiedRef[] {
  const scan = scanXml(text);
  const refs: ClassifiedRef[] = [];
  for (const element of scan.elements) {
    const parent = element.parentIndex >= 0 ? scan.elements[element.parentIndex] : undefined;
    refs.push(...classifyElement(element, scan.positionAt, scan.rootName, parent?.name));
  }
  return refs;
}

export function refAt(refs: readonly ClassifiedRef[], offset: number): ClassifiedRef | undefined {
  for (let index = refs.length - 1; index >= 0; index--) {
    const ref = refs[index];
    if (offset >= ref.startOffset && offset <= ref.endOffset) {
      return ref;
    }
  }
  return undefined;
}

export type MemberRole =
  | 'transition'
  | 'transition-include'
  | 'screen-path'
  | 'url-name'
  | 'section'
  | 'fragment'
  | 'form'
  | 'subscreens-default'
  | 'field';

export interface MemberRef {
  role: MemberRole;
  lookup: string;
  range: Range;
  startOffset: number;
  endOffset: number;
  dynamic: boolean;
  location?: string;
  locationDynamic?: boolean;
  fragmentKind?: 'section' | 'form';
  formTag?: 'form-single' | 'form-list';
  formKey?: string;
}

const MEMBER_ROOTS = new Set(['screen', 'screen-extend', 'widget-templates']);
const CONF_ROOTS = new Set(['moqui-conf', 'component']);
const TRANSITION_TAGS = new Set([
  'form-single',
  'form-list',
  'dynamic-container',
  'dynamic-dialog',
  'dynamic-options',
]);

const LOCAL_TRANSITION_ATTRS: Readonly<Record<string, readonly string[]>> = {
  'view-board': ['transition'],
  'view-calendar': ['transition', 'create-transition'],
  'view-tree': ['transition', 'children-transition', 'ancestor-transition'],
  'ext-action': ['transition'],
  'status-bar': ['transition'],
};

const URL_TRANSITION_ATTRS: Readonly<Record<string, readonly string[]>> = {
  'text-area': ['mention-transition', 'record-transition'],
};

const SCREEN_PATH_TAGS = new Set([
  'ext-action',
  'ext-panel',
  'quick-create',
  'palette-action',
  'account-menu-item',
  'assist-prompt',
  'response-action',
  'page-action',
]);

const SCREEN_URL_NAME_TAGS = new Set(['link', 'default-response', 'conditional-response', 'error-response']);

export function collectMemberRefs(text: string): MemberRef[] {
  const scan = scanXml(text);
  if (!scan.rootName) {
    return [];
  }
  const refs: MemberRef[] = [];
  if (MEMBER_ROOTS.has(scan.rootName)) {
    const screenNames = scan.rootName === 'screen' || scan.rootName === 'screen-extend';
    for (let index = 0; index < scan.elements.length; index++) {
      refs.push(...classifyMember(scan.elements, index, scan.positionAt, screenNames));
    }
  } else if (CONF_ROOTS.has(scan.rootName)) {
    for (const element of scan.elements) {
      refs.push(...classifyTokenRoute(element));
    }
  }
  return refs;
}

export function memberRefAt(refs: readonly MemberRef[], offset: number): MemberRef | undefined {
  for (let index = refs.length - 1; index >= 0; index--) {
    const ref = refs[index];
    if (offset >= ref.startOffset && offset <= ref.endOffset) {
      return ref;
    }
  }
  return undefined;
}

function classifyMember(
  elements: ScanElement[],
  index: number,
  positionAt: (offset: number) => Position,
  screenNames: boolean,
): MemberRef[] {
  const element = elements[index];
  const refs: MemberRef[] = [];
  if (element.name === 'transition-include') {
    const name = attribute(element, 'name');
    if (name) {
      const location = splitLocation(attribute(element, 'location'), positionAt);
      refs.push(namedRef(name, 'transition-include', location));
    }
  }
  if (TRANSITION_TAGS.has(element.name)) {
    const transition = attribute(element, 'transition');
    if (transition) {
      refs.push(namedRef(transition, 'transition'));
    }
  }
  if (element.name === 'section-include') {
    const location = splitLocation(attribute(element, 'location'), positionAt);
    const name = attribute(element, 'name');
    if (name) {
      refs.push(namedRef(name, 'section', location));
    }
    if (location?.fragment) {
      refs.push(fragmentRef(location, 'section'));
    }
  }
  if (element.name === 'form-single' || element.name === 'form-list') {
    const extendsAttribute = attribute(element, 'extends');
    if (extendsAttribute) {
      const formTag = element.name;
      const split = splitLocation(extendsAttribute, positionAt);
      if (split?.fragment && looksLikeScreenLocation(split.file)) {
        refs.push(fragmentRef(split, 'form', formTag));
      } else if (split && !split.fragment && !looksLikeScreenLocation(split.file)) {
        refs.push(namedRef(extendsAttribute, 'form', undefined, formTag));
      }
    }
    if (element.name === 'form-single') {
      const focus = attribute(element, 'focus-field');
      const key = formKey(element);
      if (focus && key) {
        refs.push(namedRef(focus, 'field', undefined, undefined, key));
      }
    }
  }
  if (element.name === 'subscreens') {
    const item = attribute(element, 'default-item');
    if (item) {
      refs.push(namedRef(item, 'subscreens-default'));
    }
  }
  if (element.name === 'field-ref') {
    const name = attribute(element, 'name');
    const form = enclosingForm(elements, index);
    const key = form ? formKey(form) : undefined;
    if (name && key) {
      refs.push(namedRef(name, 'field', undefined, undefined, key));
    }
  }
  for (const name of LOCAL_TRANSITION_ATTRS[element.name] ?? []) {
    const transition = attribute(element, name);
    if (transition) {
      refs.push(namedRef(transition, 'transition'));
    }
  }
  for (const name of URL_TRANSITION_ATTRS[element.name] ?? []) {
    const transition = attribute(element, name);
    if (transition && !isHttpUrl(transition.value)) {
      refs.push(namedRef(transition, 'transition'));
    }
  }
  const parent = element.parentIndex >= 0 ? elements[element.parentIndex] : undefined;
  if (SCREEN_PATH_TAGS.has(element.name) || (element.name === 'key' && parent?.name === 'keymap')) {
    const screen = attribute(element, 'screen');
    if (screen && !isRemotePath(screen.value)) {
      refs.push(namedRef(screen, 'screen-path'));
    }
  }
  if (element.name === 'form-list') {
    pushTransitionOrPath(refs, attribute(element, 'peek-url'));
  }
  if (element.name === 'view-calendar') {
    pushTransitionOrPath(refs, attribute(element, 'create-screen'));
  }
  if (screenNames) {
    pushScreenUrlName(refs, element, positionAt);
  }
  return refs;
}

function classifyTokenRoute(element: ScanElement): MemberRef[] {
  if (element.name !== 'token-route') {
    return [];
  }
  const post = attribute(element, 'post-transition');
  if (!post) {
    return [];
  }
  const location = attribute(element, 'screen-location');
  return [
    namedRef(
      post,
      'transition-include',
      location ? { file: location.value.trim(), fileDynamic: location.value.includes('${') } : undefined,
    ),
  ];
}

function pushTransitionOrPath(refs: MemberRef[], attr: ScanAttribute | undefined): void {
  if (!attr || isRemotePath(attr.value)) {
    return;
  }
  const value = attr.value.trim();
  if (value.includes('/') || value.startsWith('.')) {
    refs.push(namedRef(attr, 'screen-path'));
    return;
  }
  refs.push(namedRef(attr, 'transition'));
}

function isHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

function isRemotePath(value: string): boolean {
  const trimmed = value.trim();
  return isHttpUrl(trimmed) || trimmed.startsWith('content:');
}

export function omitScreenUrlPath(element: ScanElement): boolean {
  const url = screenUrlAttribute(element);
  if (!url) {
    return false;
  }
  if (url.raw.includes('${') || url.value.includes('${')) {
    return true;
  }
  return bareScreenUrl(url.value);
}

export function collectDynamicScreenUrls(text: string): { range: Range; lookup: string }[] {
  const scan = scanXml(text);
  if (scan.rootName !== 'screen' && scan.rootName !== 'screen-extend') {
    return [];
  }
  const found: { range: Range; lookup: string }[] = [];
  for (const element of scan.elements) {
    const url = screenUrlAttribute(element);
    if (!url || (!url.raw.includes('${') && !url.value.includes('${'))) {
      continue;
    }
    found.push({ range: url.range, lookup: url.value.trim() });
  }
  return found;
}

function pushScreenUrlName(
  refs: MemberRef[],
  element: ScanElement,
  positionAt: (offset: number) => Position,
): void {
  const url = screenUrlAttribute(element);
  if (!url || url.raw.includes('${') || url.value.includes('${') || !bareScreenUrl(url.value)) {
    return;
  }
  const named = screenUrlNameRef(url, positionAt);
  if (named) {
    refs.push(named);
  }
}

function screenUrlAttribute(element: ScanElement): ScanAttribute | undefined {
  if (!SCREEN_URL_NAME_TAGS.has(element.name)) {
    return undefined;
  }
  const url = attribute(element, 'url');
  if (!url) {
    return undefined;
  }
  const explicit = attribute(element, 'url-type')?.value.trim();
  const kind = explicit || (element.name === 'link' ? 'transition' : 'screen-path');
  if (kind !== 'transition' && kind !== 'screen' && kind !== 'screen-path') {
    return undefined;
  }
  const trimmed = url.value.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('content:')) {
    return undefined;
  }
  return url;
}

function bareScreenUrl(value: string): boolean {
  const trimmed = value.trim();
  const query = trimmed.indexOf('?');
  const target = (query < 0 ? trimmed : trimmed.slice(0, query)).trim();
  if (target.includes('/') || target.includes('\\') || target.startsWith('.')) {
    return false;
  }
  return target.length > 0 || trimmed.length === 0;
}

function screenUrlNameRef(attr: ScanAttribute, positionAt: (offset: number) => Position): MemberRef | undefined {
  const raw = attr.raw;
  const leading = raw.length - raw.trimStart().length;
  const trimmed = raw.trim();
  const query = trimmed.indexOf('?');
  const head = query < 0 ? trimmed : trimmed.slice(0, query);
  const headLeading = head.length - head.trimStart().length;
  const headCore = head.trim();
  const startOffset = attr.startOffset + leading + headLeading;
  const endOffset = startOffset + headCore.length;
  return {
    role: 'url-name',
    lookup: decodeEntities(headCore).trim(),
    range: { start: positionAt(startOffset), end: positionAt(endOffset) },
    startOffset,
    endOffset,
    dynamic: false,
  };
}

interface SplitLocation {
  file: string;
  fileDynamic: boolean;
  fragment?: MemberRef;
}

function splitLocation(
  attr: ScanAttribute | undefined,
  positionAt: (offset: number) => Position,
): SplitLocation | undefined {
  if (!attr) {
    return undefined;
  }
  const hash = attr.raw.indexOf('#');
  const rawFile = hash < 0 ? attr.raw : attr.raw.slice(0, hash);
  const split: SplitLocation = {
    file: decodeEntities(rawFile).trim(),
    fileDynamic: rawFile.includes('${'),
  };
  if (hash < 0) {
    return split;
  }
  const rawFragment = attr.raw.slice(hash + 1);
  const leading = rawFragment.length - rawFragment.trimStart().length;
  const trailing = rawFragment.length - rawFragment.trimEnd().length;
  const startOffset = attr.startOffset + hash + 1 + leading;
  const endOffset = attr.endOffset - trailing;
  split.fragment = {
    role: 'fragment',
    lookup: decodeEntities(rawFragment.trim()).trim(),
    range: { start: positionAt(startOffset), end: positionAt(endOffset) },
    startOffset,
    endOffset,
    dynamic: rawFragment.includes('${'),
  };
  return split;
}

function fragmentRef(
  location: SplitLocation,
  fragmentKind: 'section' | 'form',
  formTag?: 'form-single' | 'form-list',
): MemberRef {
  const fragment = location.fragment;
  if (!fragment) {
    throw new Error('fragment');
  }
  return {
    ...fragment,
    fragmentKind,
    formTag,
    location: location.file,
    locationDynamic: location.fileDynamic,
  };
}

function namedRef(
  attr: ScanAttribute,
  role: MemberRole,
  location?: SplitLocation,
  formTag?: 'form-single' | 'form-list',
  formKeyValue?: string,
): MemberRef {
  return {
    role,
    lookup: attr.value.trim(),
    range: attr.range,
    startOffset: attr.startOffset,
    endOffset: attr.endOffset,
    dynamic: attr.value.includes('${'),
    location: location?.file,
    locationDynamic: location?.fileDynamic,
    formTag,
    formKey: formKeyValue,
  };
}

function enclosingForm(elements: readonly ScanElement[], index: number): ScanElement | undefined {
  let current = elements[index].parentIndex;
  while (current >= 0) {
    const element = elements[current];
    if (element.name === 'form-single' || element.name === 'form-list') {
      return element;
    }
    current = element.parentIndex;
  }
  return undefined;
}

export function classifyElement(
  element: ScanElement,
  positionAt: (offset: number) => Position,
  rootName?: string,
  parentName?: string,
): ClassifiedRef[] {
  const refs: ClassifiedRef[] = [];

  if (element.name === 'extend-entity') {
    const extend = extendEntityRef(element);
    if (extend) {
      refs.push(extend);
    }
    return refs;
  }

  if (element.name === 'relationship') {
    const related = attribute(element, 'related');
    if (related) {
      const ref = valueRef(related, 'entity', 'canonical');
      if (ref) {
        refs.push(ref);
      }
    }
  } else if (element.name === 'eeca') {
    const entity = attribute(element, 'entity');
    if (entity) {
      const ref = valueRef(entity, 'entity', 'canonical');
      if (ref) {
        refs.push(ref);
      }
    }
  } else if (ENTITY_NAME_TAGS.has(element.name)) {
    const entityName = attribute(element, 'entity-name');
    if (entityName) {
      const ref = valueRef(entityName, 'entity', 'canonical');
      if (ref) {
        refs.push(ref);
      }
    }
  }

  if (rootName === 'resource') {
    if (element.name === 'service') {
      const name = attribute(element, 'name');
      if (name) {
        const ref = serviceRef(name, positionAt, false);
        if (ref) {
          refs.push(ref);
        }
      }
    } else if (element.name === 'entity') {
      const name = attribute(element, 'name');
      if (name) {
        const ref = valueRef(name, 'entity', 'canonical');
        if (ref) {
          refs.push(ref);
        }
      }
    }
  }

  if (element.name === 'service-call' || element.name === 'service-invoke') {
    const name = attribute(element, 'name');
    if (name) {
      const ref = serviceRef(name, positionAt, false);
      if (ref) {
        refs.push(ref);
      }
    }
  } else if (element.name === 'implements') {
    const service = attribute(element, 'service');
    if (service) {
      const ref = serviceRef(service, positionAt, false);
      if (ref) {
        refs.push({ ...ref, interfacesOnly: true });
      }
    }
  } else if (element.name === 'seca') {
    const service = attribute(element, 'service');
    if (service) {
      const pattern = attribute(element, 'name-is-pattern')?.value.trim() === 'true';
      const ref = serviceRef(service, positionAt, pattern);
      if (ref) {
        refs.push(ref);
      }
    }
  } else if (element.name === 'auto-fields-service' || element.name === 'auto-widget-service') {
    const serviceName = attribute(element, 'service-name');
    if (serviceName) {
      const ref = serviceRef(serviceName, positionAt, false);
      if (ref) {
        refs.push(ref);
      }
    }
  }

  if (SERVICE_NAME_TAGS.has(element.name)) {
    pushService(refs, element, 'service', positionAt);
  }
  if (element.name === 'queue-kind') {
    pushService(refs, element, 'failed-service', positionAt);
  }
  if (element.name === 'public-site') {
    pushService(refs, element, 'resolver-service', positionAt);
    pushService(refs, element, 'host-check-service', positionAt);
  }
  if (element.name === 'token-route') {
    pushService(refs, element, 'token-service', positionAt);
  }

  if (RECORD_ENTITY_TAGS.has(element.name)) {
    pushEntity(refs, attribute(element, 'record-entity'));
  }
  if (element.name === 'assist-prompt') {
    pushEntity(refs, attribute(element, 'entity'));
  }
  if (element.name === 'entity' && parentName === 'replicate' && rootName !== 'resource') {
    pushEntity(refs, attribute(element, 'name'));
  }

  if (element.name === 'public-site' || element.name === 'token-route') {
    const location = attribute(element, 'screen-location');
    if (location) {
      const ref = screenRef(location, positionAt, 'location');
      if (ref) {
        refs.push(ref);
      }
    }
  }
  if (element.name === 'mount') {
    const screen = attribute(element, 'screen');
    if (screen && isExplicitScreenLocation(screen.value)) {
      const ref = screenRef(screen, positionAt, 'location');
      if (ref) {
        refs.push(ref);
      }
    }
  }

  if (SCREEN_LOCATION_TAGS.has(element.name)) {
    const location = attribute(element, 'location');
    if (location) {
      const ref = screenRef(location, positionAt, 'location');
      if (ref) {
        refs.push(ref);
      }
    }
  } else if (element.name === 'form-single' || element.name === 'form-list') {
    const extendsAttribute = attribute(element, 'extends');
    if (extendsAttribute) {
      const ref = screenRef(extendsAttribute, positionAt, 'extends');
      if (ref) {
        refs.push(ref);
      }
    }
  }

  return refs;
}

function pushService(
  refs: ClassifiedRef[],
  element: ScanElement,
  attrName: string,
  positionAt: (offset: number) => Position,
): void {
  const attr = attribute(element, attrName);
  if (!attr) {
    return;
  }
  const ref = serviceRef(attr, positionAt, false);
  if (ref) {
    refs.push(ref);
  }
}

function pushEntity(refs: ClassifiedRef[], attr: ScanAttribute | undefined): void {
  if (!attr) {
    return;
  }
  refs.push(valueRef(attr, 'entity', 'canonical'));
}

function isExplicitScreenLocation(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('component://') || trimmed.startsWith('.') || trimmed.startsWith('//');
}

function extendEntityRef(element: ScanElement): ClassifiedRef | undefined {
  const entityName = attribute(element, 'entity-name');
  if (!entityName) {
    return undefined;
  }
  const shortName = entityName.value.trim();
  const packageName = attribute(element, 'package')?.value.trim() ?? '';
  const lookup = !shortName || shortName.includes('.') || !packageName ? shortName : `${packageName}.${shortName}`;
  return {
    kind: 'entity',
    lookup,
    range: entityName.range,
    startOffset: entityName.startOffset,
    endOffset: entityName.endOffset,
    dynamic: entityName.value.includes('${') || (attribute(element, 'package')?.value.includes('${') ?? false),
    skipDiagnostic: false,
    entityCompletion: 'short',
  };
}

function valueRef(
  attr: ScanAttribute,
  kind: 'entity' | 'service' | 'screen',
  entityCompletion: 'canonical' | 'short',
): ClassifiedRef {
  const lookup = attr.value.trim();
  return {
    kind,
    lookup,
    range: attr.range,
    startOffset: attr.startOffset,
    endOffset: attr.endOffset,
    dynamic: attr.value.includes('${'),
    skipDiagnostic: false,
    entityCompletion,
  };
}

function serviceRef(
  attr: ScanAttribute,
  positionAt: (offset: number) => Position,
  skipDiagnostic: boolean,
): ClassifiedRef {
  const base = valueRef(attr, 'service', 'canonical');
  const hash = attr.raw.lastIndexOf('#');
  let serviceCall: ServiceCall = { kind: 'named' };
  if (hash >= 0) {
    const pathVerb = decodeEntities(attr.raw.slice(0, hash)).trim();
    const entityName = decodeEntities(attr.raw.slice(hash + 1)).trim();
    if (!pathVerb.includes('.')) {
      const entityStart = attr.startOffset + hash + 1;
      serviceCall = {
        kind: 'crud',
        verb: pathVerb,
        entityName,
        entityRange: { start: positionAt(entityStart), end: positionAt(attr.endOffset) },
        entityStart,
        entityEnd: attr.endOffset,
      };
    }
  }
  return { ...base, skipDiagnostic, serviceCall };
}

function screenRef(
  attr: ScanAttribute,
  positionAt: (offset: number) => Position,
  mode: 'location' | 'extends',
): ClassifiedRef | undefined {
  const hash = attr.raw.indexOf('#');
  const rawLocation = hash < 0 ? attr.raw : attr.raw.slice(0, hash);
  const lookup = decodeEntities(rawLocation).trim();
  if (mode === 'extends' && !looksLikeScreenLocation(lookup)) {
    return undefined;
  }
  const endOffset = hash < 0 ? attr.endOffset : attr.startOffset + hash;
  return {
    kind: 'screen',
    lookup,
    range: { start: positionAt(attr.startOffset), end: positionAt(endOffset) },
    startOffset: attr.startOffset,
    endOffset,
    dynamic: rawLocation.includes('${'),
    skipDiagnostic: false,
    entityCompletion: 'canonical',
  };
}

function looksLikeScreenLocation(value: string): boolean {
  return (
    value.startsWith('component://') ||
    value.startsWith('.') ||
    value.startsWith('//') ||
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('content:') ||
    value.includes('/')
  );
}

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

export function collectRefs(text: string): ClassifiedRef[] {
  const scan = scanXml(text);
  const refs: ClassifiedRef[] = [];
  for (const element of scan.elements) {
    refs.push(...classifyElement(element, scan.positionAt, scan.rootName));
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
const TRANSITION_TAGS = new Set([
  'form-single',
  'form-list',
  'dynamic-container',
  'dynamic-dialog',
  'dynamic-options',
]);

export function collectMemberRefs(text: string): MemberRef[] {
  const scan = scanXml(text);
  if (!scan.rootName || !MEMBER_ROOTS.has(scan.rootName)) {
    return [];
  }
  const refs: MemberRef[] = [];
  for (let index = 0; index < scan.elements.length; index++) {
    refs.push(...classifyMember(scan.elements, index, scan.positionAt));
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
  return refs;
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

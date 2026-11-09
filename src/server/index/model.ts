import { facadeDataChain } from '../refs/facadeScope';
import { Range } from '../types';
import { attribute, decodeEntities, ScanElement, ScanResult } from '../xml/scan';
import { ComponentInfo } from './components';
import { serviceClassName, serviceFullName } from './services';

export interface FieldDef {
  name: string;
  type: string;
  isPk: boolean;
  description?: string;
  uri: string;
  nameRange: Range;
  /** Unprefixed member field when `name` was expanded by alias-all. */
  originName?: string;
}

export interface RelationshipDef {
  related: string;
  shortAlias: string;
  title: string;
  type: string;
  keyMaps: { fieldName: string; related: string }[];
  uri: string;
  relatedRange: Range;
  shortAliasRange?: Range;
  titleRange?: Range;
}

export interface ViewMember {
  alias: string;
  aliasRange: Range;
  kind: 'entity' | 'relationship';
  entityName: string;
  joinFromAlias?: string;
  relationship?: string;
}

export function relationshipName(relationship: RelationshipDef): string {
  if (relationship.shortAlias) {
    return relationship.shortAlias;
  }
  if (relationship.title && relationship.related) {
    return `${relationship.title}#${relationship.related}`;
  }
  return relationship.related;
}

export function relationshipMatches(relationship: RelationshipDef, written: string): boolean {
  if (!written) {
    return false;
  }
  if (relationship.shortAlias && relationship.shortAlias === written) {
    return true;
  }
  if (relationship.related === written) {
    return true;
  }
  return Boolean(relationship.title) && written === `${relationship.title}#${relationship.related}`;
}

export interface ViewAliasAll {
  entityAlias: string;
  prefix: string;
  excludes: string[];
}

export interface ViewAlias {
  name: string;
  uri: string;
  nameRange: Range;
}

export interface ViewDef {
  members: ViewMember[];
  aliasAll: ViewAliasAll[];
  aliases: ViewAlias[];
}

export interface EntityContribution {
  canonical: string;
  uri: string;
  range: Range;
  entityNameRange: Range;
  aliasRange?: Range;
  alias: string;
  noUpdateStamp: boolean;
  description?: string;
  fields: FieldDef[];
  relationships: RelationshipDef[];
  view?: ViewDef;
}

export interface AutoParameters {
  entityName: string;
  include: 'pk' | 'nonpk' | 'all';
  excludes: string[];
}

export interface ServiceParameterMember {
  kind: 'parameter';
  name: string;
  type: string;
  required: boolean;
  description?: string;
  uri: string;
  nameRange: Range;
  children: ServiceMember[];
}

export interface ServiceAutoMember {
  kind: 'auto';
  auto: AutoParameters;
}

export type ServiceMember = ServiceParameterMember | ServiceAutoMember;

export interface ServiceImplementsRef {
  service: string;
  required?: boolean;
}

export interface ServiceModel {
  name: string;
  uri: string;
  range: Range;
  verbRange: Range;
  nounRange?: Range;
  type: string;
  description?: string;
  inputs: ServiceMember[];
  outputs: ServiceMember[];
  implementsServices: ServiceImplementsRef[];
}

export interface FacadeTag {
  uri: string;
  fsPath: string;
  names: string[];
  range: Range;
}

export interface EntityShape {
  fields: FieldDef[];
  relationships: RelationshipDef[];
  noUpdateStamp: boolean;
  description?: string;
}

export function extractEntityModels(scan: ScanResult, uri: string, text: string): {
  bases: EntityContribution[];
  extensions: EntityContribution[];
} {
  const bases: EntityContribution[] = [];
  const extensions: EntityContribution[] = [];
  if (scan.rootName !== 'entities') {
    return { bases, extensions };
  }
  for (let index = 0; index < scan.elements.length; index++) {
    const element = scan.elements[index];
    if (element.name !== 'entity' && element.name !== 'view-entity' && element.name !== 'extend-entity') {
      continue;
    }
    const entityNameAttribute = attribute(element, 'entity-name');
    const packageName = attribute(element, 'package')?.value.trim();
    const entityName = entityNameAttribute?.value.trim();
    if (!entityName || !packageName || !entityNameAttribute) {
      continue;
    }
    const contribution = readContribution(
      scan,
      index,
      uri,
      entityName.includes('.') ? entityName : `${packageName}.${entityName}`,
      element.name === 'view-entity',
      entityNameAttribute.range,
      text,
    );
    if (element.name === 'extend-entity') {
      extensions.push(contribution);
    } else {
      bases.push(contribution);
    }
  }
  return { bases, extensions };
}

export function extractServiceModels(
  scan: ScanResult,
  filePath: string,
  uri: string,
  components: readonly ComponentInfo[],
  text: string,
): ServiceModel[] {
  if (scan.rootName !== 'services') {
    return [];
  }
  const className = serviceClassName(filePath, components);
  if (!className) {
    return [];
  }
  const models: ServiceModel[] = [];
  for (let index = 0; index < scan.elements.length; index++) {
    const element = scan.elements[index];
    if (element.name !== 'service') {
      continue;
    }
    const verbAttribute = attribute(element, 'verb');
    const verb = verbAttribute?.value.trim();
    if (!verb || !verbAttribute) {
      continue;
    }
    const nounAttribute = attribute(element, 'noun');
    const noun = nounAttribute?.value.trim() ?? '';
    const description = readDescription(scan, index, text);
    models.push({
      name: serviceFullName(className, verb, noun),
      uri,
      range: element.startTagRange,
      verbRange: verbAttribute.range,
      nounRange: nounAttribute?.range,
      type: attribute(element, 'type')?.value.trim() || 'inline',
      ...(description ? { description } : {}),
      inputs: readParameterGroup(scan, index, 'in-parameters', uri, text),
      outputs: readParameterGroup(scan, index, 'out-parameters', uri, text),
      implementsServices: readImplements(scan, index),
    });
  }
  return models;
}

export function collectFacadeTags(scan: ScanResult, uri: string, fsPath: string): FacadeTag[] {
  const tags: FacadeTag[] = [];
  for (let index = 0; index < scan.elements.length; index++) {
    const chain = facadeDataChain(scan, index);
    if (!chain || chain.dynamic) {
      continue;
    }
    tags.push({
      uri,
      fsPath,
      names: chain.names,
      range: chain.leaf.nameRange,
    });
  }
  return tags;
}

function readContribution(
  scan: ScanResult,
  index: number,
  uri: string,
  canonical: string,
  view: boolean,
  entityNameRange: Range,
  text: string,
): EntityContribution {
  const element = scan.elements[index];
  const aliasAttribute = attribute(element, 'short-alias');
  const description = readDescription(scan, index, text);
  const fields: FieldDef[] = [];
  const relationships: RelationshipDef[] = [];
  const viewDef: ViewDef | undefined = view ? { members: [], aliasAll: [], aliases: [] } : undefined;
  for (let childIndex = 0; childIndex < scan.elements.length; childIndex++) {
    const child = scan.elements[childIndex];
    if (child.parentIndex !== index) {
      continue;
    }
    if (child.name === 'field') {
      const field = readField(scan, childIndex, uri, text);
      if (field) {
        fields.push(field);
      }
    } else if (child.name === 'relationship') {
      const relationship = readRelationship(scan, childIndex, uri);
      if (relationship) {
        relationships.push(relationship);
      }
    } else if (viewDef && (child.name === 'member-entity' || child.name === 'member-relationship')) {
      const aliasAttribute = attribute(child, 'entity-alias');
      const alias = aliasAttribute?.value.trim();
      if (alias && aliasAttribute) {
        const joinFromAlias = attribute(child, 'join-from-alias')?.value.trim();
        if (child.name === 'member-entity') {
          viewDef.members.push({
            alias,
            aliasRange: aliasAttribute.range,
            kind: 'entity',
            entityName: attribute(child, 'entity-name')?.value.trim() ?? '',
            joinFromAlias: joinFromAlias || undefined,
          });
        } else {
          viewDef.members.push({
            alias,
            aliasRange: aliasAttribute.range,
            kind: 'relationship',
            entityName: '',
            joinFromAlias: joinFromAlias || undefined,
            relationship: attribute(child, 'relationship')?.value.trim() || undefined,
          });
        }
      }
    } else if (viewDef && child.name === 'alias-all') {
      const entityAlias = attribute(child, 'entity-alias')?.value.trim();
      if (entityAlias) {
        const excludes: string[] = [];
        for (const grand of scan.elements) {
          if (grand.parentIndex === childIndex && grand.name === 'exclude') {
            const excluded = attribute(grand, 'field')?.value.trim();
            if (excluded) {
              excludes.push(excluded);
            }
          }
        }
        viewDef.aliasAll.push({
          entityAlias,
          prefix: attribute(child, 'prefix')?.value.trim() ?? '',
          excludes,
        });
      }
    } else if (viewDef && child.name === 'alias') {
      const nameAttribute = attribute(child, 'name');
      const name = nameAttribute?.value.trim();
      if (name && nameAttribute) {
        viewDef.aliases.push({ name, uri, nameRange: nameAttribute.range });
      }
    }
  }
  return {
    canonical,
    uri,
    range: element.startTagRange,
    entityNameRange,
    aliasRange: aliasAttribute?.range,
    alias: aliasAttribute?.value.trim() ?? '',
    noUpdateStamp: attribute(element, 'no-update-stamp')?.value.trim() === 'true',
    ...(description ? { description } : {}),
    fields,
    relationships,
    view: viewDef,
  };
}

function readField(scan: ScanResult, index: number, uri: string, text: string): FieldDef | undefined {
  const element = scan.elements[index];
  const nameAttribute = attribute(element, 'name');
  const name = nameAttribute?.value.trim();
  if (!name || !nameAttribute) {
    return undefined;
  }
  const description = readDescription(scan, index, text);
  return {
    name,
    type: attribute(element, 'type')?.value.trim() ?? '',
    isPk: attribute(element, 'is-pk')?.value.trim() === 'true',
    ...(description ? { description } : {}),
    uri,
    nameRange: nameAttribute.range,
  };
}

function readDescription(scan: ScanResult, parentIndex: number, text: string): string | undefined {
  for (const child of scan.elements) {
    if (child.parentIndex !== parentIndex || child.name !== 'description') {
      continue;
    }
    const value = descriptionText(text, child);
    return value || undefined;
  }
  return undefined;
}

function descriptionText(text: string, element: ScanElement): string {
  if (element.outerEnd <= element.endOffset) {
    return '';
  }
  const inner = text.slice(element.endOffset, element.outerEnd);
  const close = inner.lastIndexOf('</');
  const raw = close >= 0 ? inner.slice(0, close) : inner;
  return decodeEntities(raw).replace(/\s+/g, ' ').trim();
}

function readRelationship(scan: ScanResult, index: number, uri: string): RelationshipDef | undefined {
  const element = scan.elements[index];
  const relatedAttribute = attribute(element, 'related');
  const related = relatedAttribute?.value.trim();
  if (!related || !relatedAttribute) {
    return undefined;
  }
  const aliasAttribute = attribute(element, 'short-alias');
  const titleAttribute = attribute(element, 'title');
  const keyMaps: { fieldName: string; related: string }[] = [];
  for (const child of scan.elements) {
    if (child.parentIndex !== index || child.name !== 'key-map') {
      continue;
    }
    const fieldName = attribute(child, 'field-name')?.value.trim();
    if (!fieldName) {
      continue;
    }
    keyMaps.push({ fieldName, related: attribute(child, 'related')?.value.trim() ?? '' });
  }
  return {
    related,
    shortAlias: aliasAttribute?.value.trim() ?? '',
    title: titleAttribute?.value.trim() ?? '',
    type: attribute(element, 'type')?.value.trim() ?? '',
    keyMaps,
    uri,
    relatedRange: relatedAttribute.range,
    shortAliasRange: aliasAttribute?.range,
    titleRange: titleAttribute?.range,
  };
}

function readParameterGroup(scan: ScanResult, parentIndex: number, groupName: string, uri: string, text: string): ServiceMember[] {
  const members: ServiceMember[] = [];
  for (let index = 0; index < scan.elements.length; index++) {
    const element = scan.elements[index];
    if (element.parentIndex === parentIndex && element.name === groupName) {
      members.push(...readMembers(scan, index, uri, text));
    }
  }
  return members;
}

function readMembers(scan: ScanResult, parentIndex: number, uri: string, text: string): ServiceMember[] {
  const members: ServiceMember[] = [];
  for (let index = 0; index < scan.elements.length; index++) {
    const element = scan.elements[index];
    if (element.parentIndex !== parentIndex) {
      continue;
    }
    if (element.name === 'parameter') {
      const nameAttribute = attribute(element, 'name');
      const name = nameAttribute?.value.trim();
      if (!name || !nameAttribute) {
        continue;
      }
      const type = attribute(element, 'type')?.value.trim();
      const description = readDescription(scan, index, text);
      members.push({
        kind: 'parameter',
        name,
        type: type || 'String',
        required: attribute(element, 'required')?.value.trim() === 'true',
        ...(description ? { description } : {}),
        uri,
        nameRange: nameAttribute.range,
        children: readMembers(scan, index, uri, text),
      });
    } else if (element.name === 'auto-parameters') {
      const auto = readAutoParameters(scan, index);
      if (auto) {
        members.push({ kind: 'auto', auto });
      }
    }
  }
  return members;
}

function readImplements(scan: ScanResult, parentIndex: number): ServiceImplementsRef[] {
  const refs: ServiceImplementsRef[] = [];
  for (const element of scan.elements) {
    if (element.parentIndex !== parentIndex || element.name !== 'implements') {
      continue;
    }
    const service = attribute(element, 'service')?.value.trim();
    if (!service) {
      continue;
    }
    const requiredValue = attribute(element, 'required')?.value.trim();
    const ref: ServiceImplementsRef = { service };
    if (requiredValue === 'true') {
      ref.required = true;
    } else if (requiredValue === 'false') {
      ref.required = false;
    }
    refs.push(ref);
  }
  return refs;
}

function readAutoParameters(scan: ScanResult, index: number): AutoParameters | undefined {
  const element = scan.elements[index];
  const entityName = attribute(element, 'entity-name')?.value.trim();
  if (!entityName) {
    return undefined;
  }
  const includeValue = attribute(element, 'include')?.value.trim();
  const include = includeValue === 'pk' || includeValue === 'all' || includeValue === 'nonpk' ? includeValue : 'nonpk';
  const excludes: string[] = [];
  for (const child of scan.elements) {
    if (child.parentIndex !== index || child.name !== 'exclude') {
      continue;
    }
    const fieldName = attribute(child, 'field-name')?.value.trim();
    if (fieldName) {
      excludes.push(fieldName);
    }
  }
  return { entityName, include, excludes };
}

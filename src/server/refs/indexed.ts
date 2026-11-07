import { Range } from '../types';
import { decodeEntities } from '../xml/scan';
import { collectMemberRefs, collectRefs, MemberRole } from './classify';
import { collectEntityMemberRefs, FieldContext, RelationshipContext } from './entityMembers';

export interface IndexedRef {
  kind: 'entity' | 'service' | 'screen';
  lookup: string;
  written: string;
  uri: string;
  fsPath: string;
  range: Range;
  role: 'name' | 'crud' | 'service' | 'screen';
}

export function collectIndexedRefs(text: string, uri: string, fsPath: string): IndexedRef[] {
  const refs: IndexedRef[] = [];
  for (const ref of collectRefs(text)) {
    if (ref.dynamic || ref.skipDiagnostic || !ref.lookup) {
      continue;
    }
    if (ref.kind === 'service' && ref.serviceCall?.kind === 'crud') {
      const entityName = ref.serviceCall.entityName.trim();
      if (!entityName || entityName.includes('${')) {
        continue;
      }
      refs.push({
        kind: 'entity',
        lookup: entityName,
        written: entityName,
        uri,
        fsPath,
        range: ref.serviceCall.entityRange,
        role: 'crud',
      });
      continue;
    }
    refs.push({
      kind: ref.kind,
      lookup: ref.lookup,
      written: decodeEntities(text.slice(ref.startOffset, ref.endOffset)),
      uri,
      fsPath,
      range: ref.range,
      role: ref.kind === 'entity' ? 'name' : ref.kind === 'service' ? 'service' : 'screen',
    });
  }
  return refs;
}

export interface IndexedMemberRef {
  role: MemberRole;
  lookup: string;
  uri: string;
  fsPath: string;
  range: Range;
  dynamic: boolean;
  location?: string;
  locationDynamic?: boolean;
  fragmentKind?: 'section' | 'form';
  formTag?: 'form-single' | 'form-list';
  formKey?: string;
}

export interface IndexedEntityMemberRef {
  role: 'field' | 'relationship' | 'entity-alias';
  lookup: string;
  uri: string;
  fsPath: string;
  range: Range;
  field?: FieldContext;
  relationship?: RelationshipContext;
  viewName?: string;
  parts?: { kind: 'title' | 'related'; range: Range; startOffset: number; endOffset: number }[];
}

export function collectIndexedEntityMemberRefs(text: string, uri: string, fsPath: string): IndexedEntityMemberRef[] {
  const refs: IndexedEntityMemberRef[] = [];
  for (const ref of collectEntityMemberRefs(text)) {
    if (!ref.lookup) {
      continue;
    }
    refs.push({
      role: ref.role,
      lookup: ref.lookup,
      uri,
      fsPath,
      range: ref.range,
      field: ref.field,
      relationship: ref.relationship,
      viewName: ref.viewName,
      parts: ref.parts,
    });
  }
  return refs;
}

export function collectIndexedMemberRefs(text: string, uri: string, fsPath: string): IndexedMemberRef[] {
  const refs: IndexedMemberRef[] = [];
  for (const ref of collectMemberRefs(text)) {
    if (ref.dynamic || ref.locationDynamic || !ref.lookup) {
      continue;
    }
    refs.push({
      role: ref.role,
      lookup: ref.lookup,
      uri,
      fsPath,
      range: ref.range,
      dynamic: false,
      location: ref.location,
      locationDynamic: false,
      fragmentKind: ref.fragmentKind,
      formTag: ref.formTag,
      formKey: ref.formKey,
    });
  }
  return refs;
}

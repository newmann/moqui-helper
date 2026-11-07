import { Range } from '../types';
import { attribute, ScanElement, ScanResult } from '../xml/scan';

export type ScreenMemberKind = 'transition' | 'section' | 'form' | 'subscreens-item' | 'field';

export interface ScreenMember {
  kind: ScreenMemberKind;
  name: string;
  tag: string;
  uri: string;
  fsPath: string;
  nameRange: Range;
  formKey?: string;
  location?: string;
  extendsForm?: string;
  extendsLocation?: string;
}

const ROOTS = new Set(['screen', 'screen-extend', 'widget-templates']);

export function extractScreenMembers(scan: ScanResult, uri: string, fsPath: string): ScreenMember[] {
  if (!scan.rootName || !ROOTS.has(scan.rootName)) {
    return [];
  }
  const members: ScreenMember[] = [];
  for (let index = 0; index < scan.elements.length; index++) {
    const element = scan.elements[index];
    const nameAttribute = attribute(element, 'name');
    const name = nameAttribute?.value.trim();
    if (!name || !nameAttribute) {
      continue;
    }
    if (element.name === 'field') {
      const form = enclosingForm(scan, index);
      const key = form ? formKey(form) : undefined;
      if (!form || !key) {
        continue;
      }
      members.push({
        kind: 'field',
        name,
        tag: 'field',
        uri,
        fsPath,
        nameRange: nameAttribute.range,
        formKey: key,
      });
      continue;
    }
    const kind = memberKind(element.name);
    if (!kind) {
      continue;
    }
    const member: ScreenMember = {
      kind,
      name,
      tag: element.name,
      uri,
      fsPath,
      nameRange: nameAttribute.range,
    };
    if (element.name === 'form-single' || element.name === 'form-list') {
      member.formKey = formKey(element);
      const extended = extendsTarget(attribute(element, 'extends')?.value ?? '');
      if (extended) {
        member.extendsForm = extended.form;
        member.extendsLocation = extended.location;
      }
    }
    if (element.name === 'subscreens-item' || element.name === 'transition-include') {
      const location = filePart(attribute(element, 'location')?.value ?? '');
      if (location) {
        member.location = location;
      }
    }
    members.push(member);
  }
  return members;
}

export function formKey(element: ScanElement): string | undefined {
  const nameAttribute = attribute(element, 'name');
  if (!nameAttribute) {
    return undefined;
  }
  return `${nameAttribute.range.start.line}:${nameAttribute.range.start.character}`;
}

export function sameMember(left: ScreenMember, right: ScreenMember): boolean {
  return memberId(left) === memberId(right);
}

export function memberId(member: ScreenMember): string {
  return `${member.uri}\n${member.tag}\n${member.name}\n${member.nameRange.start.line}:${member.nameRange.start.character}`;
}

function memberKind(tag: string): ScreenMemberKind | undefined {
  if (tag === 'transition' || tag === 'transition-include') {
    return 'transition';
  }
  if (tag === 'section' || tag === 'section-iterate') {
    return 'section';
  }
  if (tag === 'form-single' || tag === 'form-list') {
    return 'form';
  }
  if (tag === 'subscreens-item') {
    return 'subscreens-item';
  }
  return undefined;
}

function enclosingForm(scan: ScanResult, index: number): ScanElement | undefined {
  let current = scan.elements[index].parentIndex;
  while (current >= 0) {
    const element = scan.elements[current];
    if (element.name === 'form-single' || element.name === 'form-list') {
      return element;
    }
    current = element.parentIndex;
  }
  return undefined;
}

function extendsTarget(value: string): { form: string; location?: string } | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('${')) {
    return undefined;
  }
  const hash = trimmed.indexOf('#');
  if (hash >= 0) {
    const location = trimmed.slice(0, hash).trim();
    const form = trimmed.slice(hash + 1).trim();
    if (!location || !form || !looksLikeScreenLocation(location)) {
      return undefined;
    }
    return { form, location };
  }
  if (looksLikeScreenLocation(trimmed)) {
    return undefined;
  }
  return { form: trimmed };
}

function filePart(value: string): string {
  const hash = value.indexOf('#');
  return (hash < 0 ? value : value.slice(0, hash)).trim();
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

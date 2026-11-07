import type { InterfaceParameter, WorkspaceIndex } from '../index/workspace';
import { isCrudVerb } from '../index/services';
import type { FieldDef } from '../index/model';
import { Range } from '../types';
import { attribute, decodeEntities, ScanAttribute, scanXml } from '../xml/scan';

export interface ServiceParamRef {
  name: string;
  range: Range;
  startOffset: number;
  endOffset: number;
  serviceName: string;
  crud?: { verb: string; entityName: string };
  siblings: string[];
}

export type ServiceParamTarget =
  | { type: 'parameter'; parameter: InterfaceParameter }
  | { type: 'field'; field: FieldDef };

export type ServiceParamResolve =
  | { status: 'skip' }
  | { status: 'ok'; targets: ServiceParamTarget[] }
  | { status: 'missing'; range: Range; messageKey: 'unresolvedParameter'; messageArgs: string[] };

interface CallTarget {
  serviceName: string;
  crud?: { verb: string; entityName: string };
}

export function collectServiceParamRefs(text: string): ServiceParamRef[] {
  const scan = scanXml(text);
  const refs: ServiceParamRef[] = [];
  for (let index = 0; index < scan.elements.length; index++) {
    const element = scan.elements[index];
    if (element.name === 'service-call') {
      const call = describeCall(attribute(element, 'name'));
      if (!call) {
        continue;
      }
      const inMap = attribute(element, 'in-map');
      if (inMap) {
        refs.push(...mapKeyRefs(inMap, scan.positionAt, call));
      }
      continue;
    }
    if (element.name !== 'field-map') {
      continue;
    }
    const parent = element.parentIndex >= 0 ? scan.elements[element.parentIndex] : undefined;
    if (!parent || parent.name !== 'service-call') {
      continue;
    }
    const call = describeCall(attribute(parent, 'name'));
    const fieldName = attribute(element, 'field-name');
    if (!call || !fieldName || fieldName.value.includes('${')) {
      continue;
    }
    const name = fieldName.value.trim();
    refs.push({
      name,
      range: fieldName.range,
      startOffset: fieldName.startOffset,
      endOffset: fieldName.endOffset,
      serviceName: call.serviceName,
      crud: call.crud,
      siblings: [],
    });
  }
  return refs;
}

export function serviceParamRefAt(refs: readonly ServiceParamRef[], offset: number): ServiceParamRef | undefined {
  for (let index = refs.length - 1; index >= 0; index--) {
    const ref = refs[index];
    if (offset >= ref.startOffset && offset <= ref.endOffset) {
      return ref;
    }
  }
  return undefined;
}

export function resolveServiceParamRef(ref: ServiceParamRef, index: WorkspaceIndex): ServiceParamResolve {
  if (!ref.name || ref.name.includes('${')) {
    return { status: 'skip' };
  }
  if (ref.crud) {
    const entities = index.findEntities(ref.crud.entityName);
    if (entities.length === 0) {
      return { status: 'skip' };
    }
    const fields: FieldDef[] = [];
    for (const entity of entities) {
      for (const field of index.entityShape(entity).fields) {
        if (field.name === ref.name) {
          fields.push(field);
        }
      }
    }
    if (fields.length > 0) {
      return { status: 'ok', targets: fields.map((field) => ({ type: 'field', field })) };
    }
    return missing(ref);
  }
  const symbols = index.findServices(ref.serviceName);
  if (symbols.length === 0) {
    return { status: 'skip' };
  }
  const parameters: InterfaceParameter[] = [];
  const seen = new Set<string>();
  for (const symbol of symbols) {
    for (const parameter of index.serviceInterface(symbol).inputs) {
      if (seen.has(parameter.name)) {
        continue;
      }
      seen.add(parameter.name);
      parameters.push(parameter);
    }
  }
  const matches = parameters.filter((parameter) => parameter.name === ref.name);
  if (matches.length > 0) {
    return { status: 'ok', targets: matches.map((parameter) => ({ type: 'parameter', parameter })) };
  }
  return missing(ref);
}

export function serviceParamLabels(ref: ServiceParamRef, prefix: string, index: WorkspaceIndex): string[] {
  const used = new Set(ref.siblings);
  return inputNames(ref, index).filter((name) => name.startsWith(prefix) && !used.has(name));
}

function inputNames(ref: ServiceParamRef, index: WorkspaceIndex): string[] {
  if (ref.crud) {
    const names = new Set<string>();
    for (const entity of index.findEntities(ref.crud.entityName)) {
      for (const field of index.entityShape(entity).fields) {
        names.add(field.name);
      }
    }
    return [...names];
  }
  const names = new Set<string>();
  for (const symbol of index.findServices(ref.serviceName)) {
    for (const parameter of index.serviceInterface(symbol).inputs) {
      names.add(parameter.name);
    }
  }
  return [...names];
}

function missing(ref: ServiceParamRef): ServiceParamResolve {
  return {
    status: 'missing',
    range: ref.range,
    messageKey: 'unresolvedParameter',
    messageArgs: [ref.name],
  };
}

function describeCall(nameAttribute: ScanAttribute | undefined): CallTarget | undefined {
  if (!nameAttribute || nameAttribute.value.includes('${')) {
    return undefined;
  }
  const lookup = nameAttribute.value.trim();
  if (!lookup) {
    return undefined;
  }
  const hash = nameAttribute.raw.lastIndexOf('#');
  if (hash >= 0) {
    const pathVerb = decodeEntities(nameAttribute.raw.slice(0, hash)).trim();
    const entityName = decodeEntities(nameAttribute.raw.slice(hash + 1)).trim();
    if (!pathVerb.includes('.')) {
      if (!isCrudVerb(pathVerb) || !entityName || entityName.includes('${')) {
        return undefined;
      }
      return { serviceName: lookup, crud: { verb: pathVerb, entityName } };
    }
  }
  return { serviceName: lookup };
}

function mapKeyRefs(
  attr: ScanAttribute,
  positionAt: (offset: number) => { line: number; character: number },
  call: CallTarget,
): ServiceParamRef[] {
  const keys = mapKeys(attr, positionAt);
  return keys.map((key, index) => ({
    name: key.name,
    range: key.range,
    startOffset: key.start,
    endOffset: key.end,
    serviceName: call.serviceName,
    crud: call.crud,
    siblings: keys.filter((item, itemIndex) => itemIndex !== index && item.name).map((item) => item.name),
  }));
}

interface MapKey {
  name: string;
  range: Range;
  start: number;
  end: number;
}

function mapKeys(attr: ScanAttribute, positionAt: (offset: number) => { line: number; character: number }): MapKey[] {
  const keys: MapKey[] = [];
  const raw = attr.raw;
  let step = 0;
  let fieldBegin = 0;
  let inMap = false;
  let inField = false;
  let nesting = 0;
  const emit = (from: number, to: number) => {
    if (raw.slice(from, to).includes('${')) {
      return;
    }
    let start = from;
    let end = to;
    while (start < end && isSpace(raw[start])) {
      start++;
    }
    while (end > start && isSpace(raw[end - 1])) {
      end--;
    }
    const keyName = decodeEntities(raw.slice(start, end)).trim();
    if (keyName.includes('${')) {
      return;
    }
    const rawStart = keyName ? start : from;
    const rawEnd = keyName ? end : to;
    const fileStart = attr.startOffset + rawStart;
    const fileEnd = attr.startOffset + rawEnd;
    keys.push({
      name: keyName,
      range: { start: positionAt(fileStart), end: positionAt(fileEnd) },
      start: fileStart,
      end: fileEnd,
    });
  };
  while (step < raw.length) {
    const char = raw[step];
    if (char === '[') {
      if (inMap) {
        nesting += 1;
      } else {
        fieldBegin = step + 1;
        inMap = true;
        inField = true;
      }
    } else if (char === ']') {
      if (inMap) {
        if (nesting === 0) {
          if (inField) {
            emit(fieldBegin, step);
          }
          inMap = false;
          inField = false;
        } else {
          nesting -= 1;
        }
      }
    } else if (char === ',' && inMap && nesting === 0) {
      if (inField) {
        emit(fieldBegin, step);
      }
      fieldBegin = step + 1;
      inField = true;
    } else if (char === ':' && inField && nesting === 0) {
      emit(fieldBegin, step);
      inField = false;
    }
    step += 1;
  }
  if (inField) {
    emit(fieldBegin, raw.length);
  }
  return keys;
}

function isSpace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

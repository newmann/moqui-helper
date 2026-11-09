import { Hover, MarkupKind } from 'vscode-languageserver';
import { EntityShape, FieldDef, RelationshipDef } from '../index/model';
import { InterfaceParameter, ServiceInterface, WorkspaceIndex } from '../index/workspace';
import { formatMessage, Messages } from '../messages';
import { toPosix } from '../paths';
import { SymbolRecord } from '../types';
import { ScreenMember } from '../index/screenMembers';
import { collectMemberRefs, collectRefs, memberRefAt, MemberRef, refAt } from '../refs/classify';
import { collectEntityMemberRefs, EntityMemberTarget, entityMemberRefAt, resolveEntityMemberRef, sourceRange } from '../refs/entityMembers';
import { describeTag, facadeTagAt } from '../refs/facade';
import { collectFileRefs, fileRefAt, resolveFileRef } from '../refs/files';
import { MemberTarget, resolveMemberRef } from '../refs/memberResolve';
import { resolveRef } from '../refs/resolve';
import { collectServiceIncludeRefs, includeRefAt, resolveServiceInclude } from '../refs/serviceInclude';
import { collectServiceParamRefs, resolveServiceParamRef, serviceParamRefAt, ServiceParamTarget } from '../refs/serviceParams';
import { scanXml } from '../xml/scan';

export function hoverAt(
  text: string,
  offset: number,
  fsPath: string,
  index: WorkspaceIndex,
  messages: Messages,
): Hover | null {
  const entityMember = entityMemberRefAt(collectEntityMemberRefs(text), offset);
  if (entityMember) {
    const resolved = resolveEntityMemberRef(entityMember, index);
    if (resolved.status !== 'ok') {
      return null;
    }
    const value = resolved.targets
      .map((target) => {
        if (target.type === 'field') {
          return fieldHover(target.field, messages);
        }
        if (target.type === 'relationship') {
          return relationshipHover(target.relationship, messages);
        }
        return aliasHover(target, index, messages);
      })
      .filter(Boolean)
      .join('\n\n');
    if (!value) {
      return null;
    }
    return { range: sourceRange(entityMember, offset), contents: { kind: MarkupKind.Markdown, value } };
  }
  const param = serviceParamRefAt(collectServiceParamRefs(text), offset);
  if (param) {
    const resolved = resolveServiceParamRef(param, index);
    if (resolved.status !== 'ok') {
      return null;
    }
    const value = resolved.targets.map((target) => paramTargetHover(target, messages)).filter(Boolean).join('\n\n');
    if (!value) {
      return null;
    }
    return { range: param.range, contents: { kind: MarkupKind.Markdown, value } };
  }
  const include = includeRefAt(collectServiceIncludeRefs(text), offset);
  if (include) {
    const resolved = resolveServiceInclude(include, fsPath, index);
    if (resolved.status !== 'ok') {
      return null;
    }
    const value = resolved.matches
      .map((match) => serviceHover(formatMessage(messages, 'hoverService', match.symbol.name), index.serviceInterface(match.symbol), messages))
      .join('\n\n');
    if (!value) {
      return null;
    }
    return { range: include.range, contents: { kind: MarkupKind.Markdown, value } };
  }
  const file = fileRefAt(collectFileRefs(text), offset);
  if (file) {
    const resolved = resolveFileRef(file, fsPath, index);
    if (resolved.status !== 'ok') {
      return null;
    }
    return {
      range: file.range,
      contents: { kind: MarkupKind.Markdown, value: `\`${toPosix(resolved.fsPath)}\`` },
    };
  }
  const member = memberRefAt(collectMemberRefs(text), offset);
  if (member) {
    const resolved = resolveMemberRef(member, fsPath, index);
    if (resolved.status !== 'ok') {
      return null;
    }
    const value = resolved.targets.map((target) => memberTargetHover(target, member, messages)).filter(Boolean).join('\n\n');
    if (!value) {
      return null;
    }
    return { range: member.range, contents: { kind: MarkupKind.Markdown, value } };
  }
  const defined = index.memberAt(fsPath, scanXml(text).positionAt(offset));
  if (defined?.kind === 'section') {
    return {
      range: defined.nameRange,
      contents: { kind: MarkupKind.Markdown, value: memberHover(defined, messages) },
    };
  }
  const ref = refAt(collectRefs(text), offset);
  if (!ref) {
    return facadeHover(text, offset, index, messages);
  }
  const result = resolveRef(ref, fsPath, index);
  if (result.status !== 'ok') {
    return null;
  }
  const value = result.crudCall
    ? crudHover(result.crudCall, result.records, index, messages)
    : result.records.map((record) => symbolHover(record, index, messages)).join('\n\n');
  if (!value) {
    return null;
  }
  return {
    range: ref.range,
    contents: { kind: MarkupKind.Markdown, value },
  };
}

function facadeHover(text: string, offset: number, index: WorkspaceIndex, messages: Messages): Hover | null {
  const tag = facadeTagAt(text, offset);
  if (!tag) {
    return null;
  }
  const described = describeTag(tag, index);
  if (described.kind === 'entity' || described.kind === 'service') {
    if (described.symbols.length === 0) {
      return null;
    }
    return {
      range: tag.range,
      contents: {
        kind: MarkupKind.Markdown,
        value: described.symbols.map((record) => symbolHover(record, index, messages)).join('\n\n'),
      },
    };
  }
  if (described.kind === 'field' && described.field) {
    return {
      range: tag.range,
      contents: { kind: MarkupKind.Markdown, value: fieldHover(described.field, messages) },
    };
  }
  if (described.kind === 'relationship' && described.relationship) {
    return {
      range: tag.range,
      contents: { kind: MarkupKind.Markdown, value: relationshipHover(described.relationship, messages) },
    };
  }
  return null;
}

function memberTargetHover(target: MemberTarget, ref: MemberRef, messages: Messages): string {
  if (target.type === 'screen') {
    return formatMessage(messages, 'hoverScreen', target.record.name);
  }
  if (ref.role === 'transition-include') {
    return formatMessage(messages, 'hoverTransitionInclude', target.member.name, ref.location ?? '');
  }
  return memberHover(target.member, messages);
}

function memberHover(member: ScreenMember, messages: Messages): string {
  switch (member.kind) {
    case 'transition':
      return formatMessage(messages, 'hoverTransition', member.name);
    case 'section':
      return formatMessage(messages, 'hoverSection', member.name);
    case 'form':
      return formatMessage(messages, member.tag === 'form-list' ? 'hoverFormList' : 'hoverFormSingle', member.name);
    case 'subscreens-item':
      return formatMessage(messages, 'hoverSubscreensItem', member.name);
    case 'field':
      return formatMessage(messages, 'hoverFormField', member.name);
    default:
      return member.name;
  }
}

function symbolHover(record: SymbolRecord, index: WorkspaceIndex, messages: Messages): string {
  const title = formatMessage(messages, hoverKey(record), record.name);
  if (record.kind === 'screen') {
    return title;
  }
  if (record.kind === 'service') {
    return serviceHover(title, index.serviceInterface(record), messages);
  }
  return entityHover(title, index.entityShape(record), messages);
}

function crudHover(crudCall: string, records: SymbolRecord[], index: WorkspaceIndex, messages: Messages): string {
  const title = formatMessage(messages, 'hoverCrud', crudCall, records.map((record) => record.name).join(', '));
  if (records.length === 0) {
    return title;
  }
  const lines = [title];
  const multiple = records.length > 1;
  for (const record of records) {
    const shape = index.entityShape(record);
    lines.push('');
    if (multiple) {
      lines.push(formatMessage(messages, hoverKey(record), record.name), '');
    }
    if (shape.description) {
      lines.push(shape.description, '');
    }
    lines.push(formatMessage(messages, 'hoverFields'), ...fieldTable(shape.fields, messages));
  }
  return lines.join('\n');
}

function serviceHover(title: string, face: ServiceInterface, messages: Messages): string {
  const lines = [title];
  if (face.description) {
    lines.push('', face.description);
  }
  lines.push(
    '',
    ...section(formatMessage(messages, 'hoverInParameters'), parameterLines(face.inputs, messages, 0), messages),
    '',
    ...section(formatMessage(messages, 'hoverOutParameters'), parameterLines(face.outputs, messages, 0), messages),
  );
  return lines.join('\n');
}

function entityHover(title: string, shape: EntityShape, messages: Messages): string {
  const lines = [title];
  if (shape.description) {
    lines.push('', shape.description);
  }
  lines.push('', formatMessage(messages, 'hoverFields'), ...fieldTable(shape.fields, messages));
  if (shape.relationships.length > 0) {
    lines.push(
      '',
      formatMessage(messages, 'hoverRelationships'),
      ...shape.relationships.map((relationship) => `- ${relationshipLabel(relationship)}`),
    );
  }
  return lines.join('\n');
}

function aliasHover(
  target: Extract<EntityMemberTarget, { type: 'alias' }>,
  index: WorkspaceIndex,
  messages: Messages,
): string {
  const view = index.viewByName(target.viewName);
  const entityName = view ? index.memberEntityName(view, target.member) : undefined;
  if (!entityName) {
    return target.member.alias;
  }
  const viewEntity = index.findEntities(entityName).some((symbol) => symbol.kind === 'view-entity');
  return formatMessage(messages, viewEntity ? 'hoverViewEntity' : 'hoverEntity', entityName);
}

function paramTargetHover(target: ServiceParamTarget, messages: Messages): string {
  if (target.type === 'field') {
    return fieldHover(target.field, messages);
  }
  const type = target.parameter.type ? `: ${target.parameter.type}` : '';
  const required = target.parameter.required ? ` ${formatMessage(messages, 'hoverRequired')}` : '';
  return `${target.parameter.name}${type}${required}`;
}

function fieldHover(field: FieldDef, messages: Messages): string {
  const title = formatMessage(messages, 'hoverField', field.name);
  if (!field.type && !field.isPk) {
    return title;
  }
  const type = field.type ? `: ${field.type}` : '';
  const pk = field.isPk ? ` ${formatMessage(messages, 'hoverPk')}` : '';
  return `${title}${type}${pk}`;
}

function relationshipHover(relationship: RelationshipDef, messages: Messages): string {
  const label = relationship.shortAlias || relationship.related;
  const title = formatMessage(messages, 'hoverRelationship', label);
  const parts: string[] = [];
  if (relationship.type) {
    parts.push(relationship.type);
  }
  if (relationship.shortAlias && relationship.related) {
    parts.push(relationship.related);
  }
  const maps = keyMapLabel(relationship);
  if (maps) {
    parts.push(maps);
  }
  if (parts.length === 0) {
    return title;
  }
  return `${title}\n${parts.join(' ')}`;
}

function section(title: string, lines: string[], messages: Messages): string[] {
  if (lines.length === 0) {
    return [title, formatMessage(messages, 'hoverNone')];
  }
  return [title, ...lines];
}

function parameterLines(parameters: InterfaceParameter[], messages: Messages, depth: number): string[] {
  const indent = '  '.repeat(depth);
  const lines: string[] = [];
  for (const parameter of parameters) {
    const label = parameter.type ? `${parameter.name}: ${parameter.type}` : parameter.name;
    const required = parameter.required ? ` ${formatMessage(messages, 'hoverRequired')}` : '';
    const description = parameter.description ? ` — ${singleLine(parameter.description)}` : '';
    lines.push(`${indent}- ${label}${required}${description}`);
    lines.push(...parameterLines(parameter.children, messages, depth + 1));
  }
  return lines;
}

function fieldTable(fields: FieldDef[], messages: Messages): string[] {
  if (fields.length === 0) {
    return [formatMessage(messages, 'hoverNone')];
  }
  const header = [
    formatMessage(messages, 'hoverColumnName'),
    formatMessage(messages, 'hoverColumnType'),
    formatMessage(messages, 'hoverPk'),
    formatMessage(messages, 'hoverColumnDescription'),
  ];
  const rows = fields.map((field) => [
    singleLine(field.name),
    singleLine(field.type),
    field.isPk ? formatMessage(messages, 'hoverYes') : '',
    singleLine(field.description ?? ''),
  ]);
  const widths = header.map((label, column) =>
    Math.max(displayWidth(label), ...rows.map((row) => displayWidth(row[column]))),
  );
  const rule = (left: string, middle: string, right: string) =>
    left + widths.map((width) => '─'.repeat(width + 2)).join(middle) + right;
  const line = (cells: string[]) => '│' + cells.map((cell, column) => padCell(cell, widths[column])).join('│') + '│';
  const body = [
    rule('┌', '┬', '┐'),
    line(header),
    rule('├', '┼', '┤'),
    ...rows.map(line),
    rule('└', '┴', '┘'),
  ];
  const fence = '`'.repeat(Math.max(3, ...body.map(backtickRun)));
  return ['', fence, ...body, fence];
}

function singleLine(value: string): string {
  return value.replace(/\r?\n/g, ' ');
}

function padCell(value: string, width: number): string {
  return ` ${value}${' '.repeat(Math.max(0, width - displayWidth(value)))} `;
}

function backtickRun(line: string): number {
  let longest = 0;
  for (const run of line.match(/`+/g) ?? []) {
    longest = Math.max(longest, run.length + 1);
  }
  return longest;
}

function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    width += isWide(char.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

function relationshipLabel(relationship: RelationshipDef): string {
  const parts: string[] = [];
  if (relationship.type) {
    parts.push(relationship.type);
  }
  if (relationship.related) {
    parts.push(relationship.related);
  }
  if (relationship.shortAlias) {
    parts.push(`(${relationship.shortAlias})`);
  }
  const maps = keyMapLabel(relationship);
  if (maps) {
    parts.push(maps);
  }
  return parts.join(' ');
}

function keyMapLabel(relationship: RelationshipDef): string {
  return relationship.keyMaps
    .map((map) => (map.related ? `${map.fieldName}->${map.related}` : map.fieldName))
    .join(', ');
}

function hoverKey(record: SymbolRecord): string {
  switch (record.kind) {
    case 'view-entity':
      return 'hoverViewEntity';
    case 'service':
      return 'hoverService';
    case 'screen':
      return 'hoverScreen';
    default:
      return 'hoverEntity';
  }
}

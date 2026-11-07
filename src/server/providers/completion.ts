import * as path from 'path';
import { CompletionItem, CompletionItemKind, TextEdit } from 'vscode-languageserver';
import { shortEntityName } from '../index/entities';
import { CRUD_VERBS } from '../index/services';
import { WorkspaceIndex } from '../index/workspace';
import { pathKey, toPosix } from '../paths';
import { aliasNameCompletion, collectEntityMemberRefs, completionLabels, entityMemberRefAt, aliasDetail } from '../refs/entityMembers';
import { collectFileRefs, fileRefAt } from '../refs/files';
import { collectPathRefs, pathLabels, pathRefAt, templateNameLabels } from '../refs/paths';
import { facadeCompletion } from '../refs/facade';
import { fixedValueCompletion } from '../refs/fixedValues';
import { ClassifiedRef, collectMemberRefs, collectRefs, memberRefAt, MemberRef, refAt } from '../refs/classify';
import { collectServiceIncludeRefs, includeLabels, includeRefAt } from '../refs/serviceInclude';
import { collectServiceParamRefs, serviceParamLabels, serviceParamRefAt } from '../refs/serviceParams';
import { encodeXmlAttribute, textTemplateLabels, textTemplateUseAt } from '../refs/textTemplates';
import { fieldsOfForm } from '../refs/memberResolve';
import { resolveScreenLocation } from '../refs/resolve';
import { decodeEntities } from '../xml/scan';

const SYSTEM_SCREEN_PREFIX = 'runtime/base-component/tools/screen/System/';
const TOOLS_SCREEN_PREFIX = 'runtime/base-component/tools/screen/Tools/';

// Word characters are intentionally absent. VS Code ignores them as trigger
// characters and uses quick suggestions instead, which attribute strings need enabled.
export const completionTriggerCharacters = ['"', '#', '.', '<', ' ', '/', ':', '-', ','];

export function completionAt(
  text: string,
  offset: number,
  index: WorkspaceIndex,
  fromFsPath = '',
): CompletionItem[] | null {
  const templateUse = textTemplateUseAt(text, offset);
  if (templateUse) {
    const prefix = decodeEntities(text.slice(templateUse.startOffset, Math.min(offset, templateUse.endOffset)));
    return textTemplateLabels(prefix, index).map((label) => ({
      label,
      kind: CompletionItemKind.Text,
      filterText: label,
      textEdit: TextEdit.replace(templateUse.range, encodeXmlAttribute(label)),
    }));
  }
  const entityMember = entityMemberRefAt(collectEntityMemberRefs(text), offset);
  if (entityMember) {
    const prefix = decodeEntities(text.slice(entityMember.editStart, Math.min(offset, entityMember.editEnd)));
    const labels = completionLabels(entityMember, prefix, index);
    labels.sort();
    return labels.map((label) => ({
      label,
      kind: entityMember.role === 'field' ? CompletionItemKind.Field : CompletionItemKind.Reference,
      detail: aliasDetail(entityMember, label, index),
      filterText: label,
      textEdit: TextEdit.replace(entityMember.editRange, label),
    }));
  }
  const aliasName = aliasNameCompletion(text, offset, index);
  if (aliasName) {
    const candidates = aliasName.candidates.filter((candidate) => candidate.fieldName.startsWith(aliasName.prefix));
    candidates.sort((left, right) => left.fieldName.localeCompare(right.fieldName) || left.entityAlias.localeCompare(right.entityAlias));
    return candidates.map((candidate) => ({
      label: candidate.fieldName,
      kind: CompletionItemKind.Field,
      detail: candidate.entityAlias,
      filterText: candidate.fieldName,
      sortText: `${candidate.fieldName}\n${candidate.entityAlias}`,
      textEdit: TextEdit.replace(aliasName.nameRange, candidate.fieldName),
      additionalTextEdits: [
        candidate.aliasRange
          ? TextEdit.replace(candidate.aliasRange, candidate.entityAlias)
          : TextEdit.insert(candidate.insertAt ?? aliasName.nameRange.start, ` entity-alias="${candidate.entityAlias}"`),
      ],
    }));
  }
  const param = serviceParamRefAt(collectServiceParamRefs(text), offset);
  if (param) {
    const prefix = decodeEntities(text.slice(param.startOffset, Math.min(offset, param.endOffset))).trim();
    const labels = serviceParamLabels(param, prefix, index);
    labels.sort();
    return labels.map((label) => ({
      label,
      kind: CompletionItemKind.Field,
      filterText: label,
      textEdit: TextEdit.replace(param.range, label),
    }));
  }
  const include = includeRefAt(collectServiceIncludeRefs(text), offset);
  if (include) {
    const prefix = decodeEntities(text.slice(include.startOffset, Math.min(offset, include.endOffset)));
    const labels = includeLabels(include, prefix, fromFsPath, index);
    labels.sort();
    return labels.map((label) => ({
      label,
      kind: CompletionItemKind.Function,
      filterText: label,
      textEdit: TextEdit.replace(include.range, label),
    }));
  }
  const pathHit = pathRefAt(collectPathRefs(text), offset);
  if (pathHit) {
    const fragmentRange = pathHit.ref.fragmentRange;
    if (
      pathHit.part === 'fragment' &&
      fragmentRange &&
      pathHit.ref.fragmentStart !== undefined &&
      pathHit.ref.fragmentEnd !== undefined
    ) {
      const prefix = decodeEntities(text.slice(pathHit.ref.fragmentStart, Math.min(offset, pathHit.ref.fragmentEnd)));
      const names = templateNameLabels(pathHit.ref, prefix, fromFsPath, index);
      return names.map((label) => ({
        label,
        kind: CompletionItemKind.Struct,
        filterText: label,
        textEdit: TextEdit.replace(fragmentRange, label),
      }));
    }
    if (pathHit.ref.dynamic) {
      return [];
    }
    const prefix = decodeEntities(text.slice(pathHit.ref.startOffset, Math.min(offset, pathHit.ref.endOffset)));
    return pathLabels(prefix, fromFsPath, index).map((item) => ({
      label: item.label,
      kind: item.directory ? CompletionItemKind.Folder : CompletionItemKind.File,
      filterText: item.label,
      textEdit: TextEdit.replace(pathHit.ref.range, item.label),
    }));
  }
  if (fileRefAt(collectFileRefs(text), offset)) {
    return null;
  }
  const member = memberRefAt(collectMemberRefs(text), offset);
  if (member) {
    if (member.dynamic || member.locationDynamic) {
      return null;
    }
    const labels = memberLabels(member, prefixOf(text, member, offset), index, fromFsPath);
    labels.sort();
    return labels.map((label) => ({
      label,
      kind: memberKind(label, member),
      filterText: label,
      textEdit: TextEdit.replace(member.range, label),
    }));
  }
  const ref = refAt(collectRefs(text), offset);
  if (!ref) {
    const facade = facadeCompletion(text, offset, index);
    if (facade) {
      return facade;
    }
    return fixedValueCompletion(text, offset, index);
  }
  if (ref.dynamic) {
    return null;
  }
  const prefix = decodeEntities(text.slice(ref.startOffset, Math.min(offset, ref.endOffset)));
  const labels = labelsFor(ref, prefix, index, fromFsPath);
  if (labels.length === 0) {
    return [];
  }
  labels.sort();
  return labels.map((label) => ({
    label,
    kind: kindFor(label, ref, index),
    filterText: label,
    textEdit: TextEdit.replace(ref.range, label),
  }));
}

function prefixOf(text: string, ref: { startOffset: number; endOffset: number }, offset: number): string {
  return decodeEntities(text.slice(ref.startOffset, Math.min(offset, ref.endOffset)));
}

function memberLabels(ref: MemberRef, prefix: string, index: WorkspaceIndex, fromFsPath: string): string[] {
  if (ref.role === 'transition') {
    return filterPrefix(transitionLabels(fromFsPath, index), prefix);
  }
  if (ref.role === 'transition-include') {
    return filterPrefix(
      locationMembers(ref, fromFsPath, index)
        .filter((member) => member.tag === 'transition')
        .map((member) => member.name),
      prefix,
    );
  }
  if (ref.role === 'section' || (ref.role === 'fragment' && ref.fragmentKind !== 'form')) {
    return filterPrefix(sectionLabels(ref, fromFsPath, index), prefix);
  }
  if (ref.role === 'form' || ref.role === 'fragment') {
    return filterPrefix(formLabels(ref, fromFsPath, index), prefix);
  }
  if (ref.role === 'subscreens-default') {
    const labels = new Set(filterPrefix(itemLabels(fromFsPath, index), prefix));
    if (prefix.startsWith('./') || prefix.startsWith('../') || prefix.startsWith('//') || prefix.startsWith('component://')) {
      for (const label of screenLabels(prefix, fromFsPath, index)) {
        labels.add(label);
      }
    }
    return [...labels];
  }
  if (ref.role === 'field') {
    const form = index.membersIn(fromFsPath).find((member) => member.kind === 'form' && member.formKey === ref.formKey);
    if (!form) {
      return [];
    }
    return filterPrefix(fieldsOfForm(form, index).map((member) => member.name), prefix);
  }
  return [];
}

function transitionLabels(fromFsPath: string, index: WorkspaceIndex): string[] {
  const labels = new Set<string>();
  for (const member of index.screenScope(fromFsPath)) {
    if (member.kind === 'transition' || member.kind === 'subscreens-item') {
      labels.add(member.name);
    }
  }
  if (!fromFsPath) {
    return [...labels];
  }
  const dir = pathKeyDir(fromFsPath);
  const nestedDirs = new Set(
    index.screenPaths(fromFsPath).map((screenPath) =>
      pathKey(path.join(path.dirname(screenPath), path.basename(screenPath, '.xml'))),
    ),
  );
  for (const record of index.screens()) {
    const target = index.symbolPath(record);
    if (!target) {
      continue;
    }
    const targetDir = pathKeyDir(target);
    if (nestedDirs.has(targetDir) || (targetDir === dir && pathKey(target) !== pathKey(fromFsPath))) {
      labels.add(path.basename(target, '.xml'));
    }
  }
  return [...labels];
}

function sectionLabels(ref: MemberRef, fromFsPath: string, index: WorkspaceIndex): string[] {
  return locationMembers(ref, fromFsPath, index)
    .filter((member) => member.kind === 'section')
    .map((member) => member.name);
}

function formLabels(ref: MemberRef, fromFsPath: string, index: WorkspaceIndex): string[] {
  if (ref.role === 'fragment') {
    return locationMembers(ref, fromFsPath, index)
      .filter((member) => member.kind === 'form' && member.tag === ref.formTag)
      .map((member) => member.name);
  }
  return index
    .screenScope(fromFsPath)
    .filter((member) => member.kind === 'form' && member.tag === ref.formTag)
    .map((member) => member.name);
}

function itemLabels(fromFsPath: string, index: WorkspaceIndex): string[] {
  return index
    .screenScope(fromFsPath)
    .filter((member) => member.kind === 'subscreens-item')
    .map((member) => member.name);
}

function locationMembers(ref: MemberRef, fromFsPath: string, index: WorkspaceIndex) {
  if (!ref.location || ref.locationDynamic || ref.location.includes('${')) {
    return [];
  }
  const resolved = resolveScreenLocation(ref.location, fromFsPath, index);
  if (resolved.status !== 'ok') {
    return [];
  }
  const members = [];
  for (const record of resolved.records) {
    const file = index.symbolPath(record);
    if (file) {
      members.push(...index.screenScope(file));
    }
  }
  return members;
}

function filterPrefix(labels: string[], prefix: string): string[] {
  return [...new Set(labels.filter((label) => label.startsWith(prefix)))];
}

function pathKeyDir(fsPath: string): string {
  return pathKey(path.dirname(fsPath));
}

function memberKind(label: string, ref: MemberRef): CompletionItemKind {
  if (ref.role === 'subscreens-default' && (label.includes('/') || label.startsWith('.'))) {
    return CompletionItemKind.File;
  }
  if (ref.role === 'transition' || ref.role === 'transition-include') {
    return CompletionItemKind.Function;
  }
  if (ref.role === 'field') {
    return CompletionItemKind.Field;
  }
  if (ref.role === 'form' || ref.fragmentKind === 'form') {
    return CompletionItemKind.Struct;
  }
  return CompletionItemKind.Module;
}

function labelsFor(ref: ClassifiedRef, prefix: string, index: WorkspaceIndex, fromFsPath: string): string[] {
  if (ref.kind === 'entity') {
    return ref.entityCompletion === 'short' ? shortEntityLabels(prefix, index) : entityLabels(prefix, index);
  }
  if (ref.kind === 'service') {
    if (ref.interfacesOnly) {
      return interfaceServiceLabels(prefix, index);
    }
    return [...new Set([...serviceLabels(prefix, index), ...crudLabels(prefix, index)])];
  }
  return screenLabels(prefix, fromFsPath, index);
}

function entityLabels(prefix: string, index: WorkspaceIndex): string[] {
  const labels = new Set<string>();
  const dotted = prefix.includes('.');
  for (const record of index.entities()) {
    if (record.name.startsWith(prefix)) {
      labels.add(record.name);
    }
    if (!dotted && shortEntityName(record.name).startsWith(prefix)) {
      labels.add(shortEntityName(record.name));
      labels.add(record.name);
    }
    for (const alias of record.aliases) {
      if (alias.startsWith(prefix)) {
        labels.add(alias);
      }
    }
  }
  return [...labels];
}

function shortEntityLabels(prefix: string, index: WorkspaceIndex): string[] {
  const labels = new Set<string>();
  for (const record of index.entities()) {
    if (prefix.includes('.')) {
      if (record.name.startsWith(prefix)) {
        labels.add(record.name);
      }
    } else if (shortEntityName(record.name).startsWith(prefix)) {
      labels.add(shortEntityName(record.name));
    }
  }
  return [...labels];
}

function screenLabels(prefix: string, fromFsPath: string, index: WorkspaceIndex): string[] {
  if (prefix.startsWith('./') || prefix.startsWith('../')) {
    return relativeScreenLabels(prefix, fromFsPath, index);
  }
  if (prefix.startsWith('//')) {
    return shorthandScreenLabels(prefix, index);
  }
  return index
    .screens()
    .map((record) => record.name)
    .filter((name) => name.startsWith(prefix));
}

function relativeScreenLabels(prefix: string, fromFsPath: string, index: WorkspaceIndex): string[] {
  if (!fromFsPath) {
    return [];
  }
  const fromDir = path.dirname(fromFsPath);
  const labels = new Set<string>();
  for (const record of index.screens()) {
    const target = index.symbolPath(record);
    if (!target) {
      continue;
    }
    let relative = toPosix(path.relative(fromDir, target));
    if (!relative || relative === '.') {
      continue;
    }
    if (!relative.startsWith('.')) {
      relative = `./${relative}`;
    }
    if (relative.startsWith(prefix)) {
      labels.add(relative);
    }
  }
  return [...labels];
}

function shorthandScreenLabels(prefix: string, index: WorkspaceIndex): string[] {
  const labels = new Set<string>();
  for (const record of index.screens()) {
    const target = index.symbolPath(record);
    if (!target) {
      continue;
    }
    for (const root of index.getWorkspaceRoots()) {
      const shorthand = shorthandLocation(toPosix(path.relative(root, target)));
      if (!shorthand) {
        continue;
      }
      const forms = [shorthand];
      if (prefix.startsWith('//apps')) {
        forms.push(`//apps/${shorthand.slice(2)}`);
      } else if (prefix.startsWith('//qapps')) {
        forms.push(`//qapps/${shorthand.slice(2)}`);
      }
      for (const form of forms) {
        if (form.startsWith(prefix)) {
          labels.add(form);
        }
      }
    }
  }
  return [...labels];
}

function shorthandLocation(relativePosix: string): string | undefined {
  if (relativePosix.startsWith('..') || relativePosix.includes(':')) {
    return undefined;
  }
  if (relativePosix.startsWith(SYSTEM_SCREEN_PREFIX)) {
    return `//system/${relativePosix.slice(SYSTEM_SCREEN_PREFIX.length)}`;
  }
  if (relativePosix.startsWith(TOOLS_SCREEN_PREFIX)) {
    return `//tools/${relativePosix.slice(TOOLS_SCREEN_PREFIX.length)}`;
  }
  return undefined;
}

function interfaceServiceLabels(prefix: string, index: WorkspaceIndex): string[] {
  const labels: string[] = [];
  for (const record of index.services()) {
    if (record.name.startsWith(prefix) && index.isServiceInterface(record)) {
      labels.push(record.name);
    }
  }
  return labels;
}

function serviceLabels(prefix: string, index: WorkspaceIndex): string[] {
  const labels: string[] = [];
  for (const record of index.services()) {
    if (record.name.startsWith(prefix)) {
      labels.push(record.name);
    }
  }
  return labels;
}

function crudLabels(prefix: string, index: WorkspaceIndex): string[] {
  if (!prefix) {
    return [];
  }
  const labels = new Set<string>();
  for (const verb of CRUD_VERBS) {
    const lead = `${verb}#`;
    const typingVerb = verb.startsWith(prefix) && prefix !== verb && !prefix.includes('#');
    if (typingVerb || (!prefix.startsWith(verb) && prefix !== verb)) {
      continue;
    }
    for (const record of index.entities()) {
      const names = new Set<string>([record.name, shortEntityName(record.name), ...record.aliases]);
      for (const name of names) {
        const label = lead + name;
        if (label.startsWith(prefix)) {
          labels.add(label);
        }
      }
    }
  }
  return [...labels];
}

function kindFor(label: string, ref: ClassifiedRef, index: WorkspaceIndex): CompletionItemKind {
  if (ref.kind === 'screen') {
    return CompletionItemKind.File;
  }
  if (ref.kind === 'service') {
    return CompletionItemKind.Function;
  }
  const records = index.findEntities(label);
  if (records.length === 1 && records[0].kind === 'view-entity') {
    return CompletionItemKind.Interface;
  }
  return CompletionItemKind.Class;
}

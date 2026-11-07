import { Location } from 'vscode-languageserver';
import { WorkspaceIndex } from '../index/workspace';
import { fsPathToUri } from '../paths';
import { collectMemberRefs, collectRefs, memberRefAt, refAt } from '../refs/classify';
import { collectEntityMemberRefs, entityMemberRefAt, relationshipPart, resolveEntityMemberRef, targetLocations } from '../refs/entityMembers';
import { describeTag, facadeTagAt } from '../refs/facade';
import { collectFileRefs, fileRefAt, resolveFileRef } from '../refs/files';
import { collectPathRefs, pathDefinition, pathRefAt } from '../refs/paths';
import { resolveMemberRef } from '../refs/memberResolve';
import { resolveRef } from '../refs/resolve';
import { collectServiceIncludeRefs, includeRefAt, resolveServiceInclude } from '../refs/serviceInclude';
import { collectServiceParamRefs, resolveServiceParamRef, serviceParamRefAt } from '../refs/serviceParams';
import { textTemplateLocations, textTemplateUseAt } from '../refs/textTemplates';

export function definitionAt(
  text: string,
  offset: number,
  fsPath: string,
  index: WorkspaceIndex,
): Location[] | null {
  const templateUse = textTemplateUseAt(text, offset);
  if (templateUse) {
    const locations = textTemplateLocations(templateUse, index);
    return locations.length > 0 ? locations : null;
  }
  const entityMember = entityMemberRefAt(collectEntityMemberRefs(text), offset);
  if (entityMember) {
    const resolved = resolveEntityMemberRef(entityMember, index);
    if (resolved.status !== 'ok') {
      return null;
    }
    const locations = resolved.targets.flatMap((target) => targetLocations(target, relationshipPart(entityMember, offset)));
    return locations.length > 0 ? locations : null;
  }
  const param = serviceParamRefAt(collectServiceParamRefs(text), offset);
  if (param) {
    const resolved = resolveServiceParamRef(param, index);
    if (resolved.status !== 'ok') {
      return null;
    }
    const locations = resolved.targets.flatMap((target) => {
      if (target.type === 'field') {
        return [{ uri: target.field.uri, range: target.field.nameRange }];
      }
      if (!target.parameter.uri || !target.parameter.nameRange) {
        return [];
      }
      return [{ uri: target.parameter.uri, range: target.parameter.nameRange }];
    });
    return locations.length > 0 ? locations : null;
  }
  const include = includeRefAt(collectServiceIncludeRefs(text), offset);
  if (include) {
    const resolved = resolveServiceInclude(include, fsPath, index);
    if (resolved.status !== 'ok' || resolved.matches.length === 0) {
      return null;
    }
    return resolved.matches.map((match) => ({ uri: match.symbol.uri, range: match.range }));
  }
  const pathHit = pathRefAt(collectPathRefs(text), offset);
  if (pathHit) {
    return pathDefinition(pathHit, fsPath, index);
  }
  const file = fileRefAt(collectFileRefs(text), offset);
  if (file) {
    const resolved = resolveFileRef(file, fsPath, index);
    if (resolved.status !== 'ok') {
      return null;
    }
    const uri = index.fileUri(resolved.fsPath) ?? fsPathToUri(resolved.fsPath);
    const origin = { line: 0, character: 0 };
    return [{ uri, range: { start: origin, end: origin } }];
  }
  const member = memberRefAt(collectMemberRefs(text), offset);
  if (member) {
    const resolved = resolveMemberRef(member, fsPath, index);
    if (resolved.status !== 'ok' || resolved.targets.length === 0) {
      return null;
    }
    return resolved.targets.map((target) =>
      target.type === 'member'
        ? { uri: target.member.uri, range: target.member.nameRange }
        : { uri: target.record.uri, range: target.record.range },
    );
  }
  const ref = refAt(collectRefs(text), offset);
  if (!ref) {
    return facadeDefinition(text, offset, index);
  }
  const result = resolveRef(ref, fsPath, index);
  if (result.status !== 'ok' || result.records.length === 0) {
    return null;
  }
  return result.records.map((record) => ({ uri: record.uri, range: record.range }));
}

function facadeDefinition(text: string, offset: number, index: WorkspaceIndex): Location[] | null {
  const tag = facadeTagAt(text, offset);
  if (!tag) {
    return null;
  }
  const described = describeTag(tag, index);
  if (described.kind === 'entity' || described.kind === 'service') {
    if (described.symbols.length === 0) {
      return null;
    }
    return described.symbols.map((symbol) => ({ uri: symbol.uri, range: symbol.range }));
  }
  if (described.kind === 'field' && described.field) {
    return [{ uri: described.field.uri, range: described.field.nameRange }];
  }
  if (described.kind === 'relationship' && described.relationship) {
    const range =
      described.relationship.shortAlias === described.written && described.relationship.shortAliasRange
        ? described.relationship.shortAliasRange
        : described.relationship.relatedRange;
    return [{ uri: described.relationship.uri, range }];
  }
  return null;
}

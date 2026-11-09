import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { WorkspaceIndex } from '../index/workspace';
import { formatMessage, Messages } from '../messages';
import { collectDynamicScreenUrls, collectMemberRefs, collectRefs } from '../refs/classify';
import { collectEntityMemberRefs, resolveEntityMemberRef } from '../refs/entityMembers';
import { describeTag } from '../refs/facade';
import { facadeDataChain } from '../refs/facadeScope';
import { collectFileRefs, resolveFileRef } from '../refs/files';
import { collectPathRefs, pathDiagnostics } from '../refs/paths';
import { resolveMemberRef } from '../refs/memberResolve';
import { resolveRef } from '../refs/resolve';
import { collectServiceIncludeRefs, resolveServiceInclude } from '../refs/serviceInclude';
import { collectServiceParamRefs, resolveServiceParamRef } from '../refs/serviceParams';
import { scanXml } from '../xml/scan';

export function collectDiagnostics(
  text: string,
  fsPath: string,
  index: WorkspaceIndex,
  messages: Messages,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const ref of collectRefs(text)) {
    const result = resolveRef(ref, fsPath, index);
    if (result.status !== 'missing') {
      continue;
    }
    diagnostics.push({
      range: result.range,
      severity: DiagnosticSeverity.Error,
      source: 'moqui-helper',
      message: formatMessage(messages, result.messageKey, ...result.messageArgs),
    });
  }
  for (const ref of collectDynamicScreenUrls(text)) {
    diagnostics.push({
      range: ref.range,
      severity: DiagnosticSeverity.Warning,
      source: 'moqui-helper',
      message: formatMessage(messages, 'dynamicUrl', ref.lookup),
    });
  }
  for (const ref of collectMemberRefs(text)) {
    const result = resolveMemberRef(ref, fsPath, index);
    if (result.status !== 'missing') {
      continue;
    }
    diagnostics.push({
      range: result.range,
      severity: DiagnosticSeverity.Error,
      source: 'moqui-helper',
      message: formatMessage(messages, result.messageKey, ...result.messageArgs),
    });
  }
  for (const ref of collectPathRefs(text)) {
    for (const result of pathDiagnostics(ref, fsPath, index)) {
      diagnostics.push({
        range: result.range,
        severity: DiagnosticSeverity.Error,
        source: 'moqui-helper',
        message: formatMessage(messages, result.messageKey, ...result.messageArgs),
      });
    }
  }
  for (const ref of collectFileRefs(text)) {
    const result = resolveFileRef(ref, fsPath, index);
    if (result.status !== 'missing') {
      continue;
    }
    diagnostics.push({
      range: result.range,
      severity: DiagnosticSeverity.Error,
      source: 'moqui-helper',
      message: formatMessage(messages, result.messageKey, ...result.messageArgs),
    });
  }
  for (const ref of collectServiceIncludeRefs(text)) {
    const result = resolveServiceInclude(ref, fsPath, index);
    if (result.status !== 'missing') {
      continue;
    }
    diagnostics.push({
      range: result.range,
      severity: DiagnosticSeverity.Error,
      source: 'moqui-helper',
      message: formatMessage(messages, result.messageKey, ...result.messageArgs),
    });
  }
  for (const ref of collectServiceParamRefs(text)) {
    const result = resolveServiceParamRef(ref, index);
    if (result.status !== 'missing') {
      continue;
    }
    diagnostics.push({
      range: result.range,
      severity: DiagnosticSeverity.Error,
      source: 'moqui-helper',
      message: formatMessage(messages, result.messageKey, ...result.messageArgs),
    });
  }
  for (const ref of collectEntityMemberRefs(text)) {
    const result = resolveEntityMemberRef(ref, index);
    if (result.status !== 'missing') {
      continue;
    }
    diagnostics.push({
      range: result.range,
      severity: DiagnosticSeverity.Error,
      source: 'moqui-helper',
      message: formatMessage(messages, result.messageKey, ...result.messageArgs),
    });
  }
  diagnostics.push(...facadeDiagnostics(text, index, messages));
  return diagnostics;
}

function facadeDiagnostics(text: string, index: WorkspaceIndex, messages: Messages): Diagnostic[] {
  const scan = scanXml(text);
  const diagnostics: Diagnostic[] = [];
  for (let elementIndex = 0; elementIndex < scan.elements.length; elementIndex++) {
    const chain = facadeDataChain(scan, elementIndex);
    if (!chain || chain.dynamic) {
      continue;
    }
    const described = describeTag({ uri: '', fsPath: '', names: chain.names, range: chain.leaf.nameRange }, index);
    if (described.kind !== 'unknown') {
      continue;
    }
    diagnostics.push({
      range: chain.leaf.nameRange,
      severity: DiagnosticSeverity.Error,
      source: 'moqui-helper',
      message: formatMessage(messages, 'unresolvedFacadeTag', chain.leaf.name),
    });
  }
  return diagnostics;
}

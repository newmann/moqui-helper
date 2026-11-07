import { InlayHint, InlayHintKind } from 'vscode-languageserver';
import { WorkspaceIndex } from '../index/workspace';
import { formatMessage, Messages } from '../messages';
import { collectTextTemplateUses } from '../refs/textTemplates';
import { Position, Range } from '../types';

export function inlayHintsFor(
  text: string,
  index: WorkspaceIndex,
  messages: Messages,
  range?: Range,
): InlayHint[] {
  const label = formatMessage(messages, 'localizedMessage');
  const hints: InlayHint[] = [];
  for (const use of collectTextTemplateUses(text)) {
    if (!use.value || index.findTextTemplates(use.value).length === 0) {
      continue;
    }
    if (range && !containsPosition(range, use.range.start)) {
      continue;
    }
    hints.push({
      position: use.range.start,
      label,
      kind: InlayHintKind.Type,
      paddingRight: true,
    });
  }
  return hints;
}

function containsPosition(range: Range, position: Position): boolean {
  if (position.line < range.start.line || position.line > range.end.line) {
    return false;
  }
  if (position.line === range.start.line && position.character < range.start.character) {
    return false;
  }
  if (position.line === range.end.line && position.character > range.end.character) {
    return false;
  }
  return true;
}

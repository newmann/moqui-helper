import { CodeLens } from 'vscode-languageserver';
import { WorkspaceIndex } from '../index/workspace';
import { formatMessage, Messages } from '../messages';
import { templateReferenceLocations } from '../refs/paths';
import { locationsForMember, locationsForSymbol } from '../refs/query';
import { foldingRanges } from './folding';

export const SHOW_REFERENCES_COMMAND = 'moquiHelper.showReferences';
export const FOLD_FORM_COMMAND = 'moquiHelper.foldForm';

export function codeLensesFor(fsPath: string, index: WorkspaceIndex, messages: Messages): CodeLens[] {
  const lenses: CodeLens[] = [];
  for (const symbol of index.symbolsIn(fsPath)) {
    const locations = locationsForSymbol(symbol, index);
    const position = symbol.range.start;
    lenses.push({
      range: symbol.range,
      command: {
        title: formatMessage(messages, 'referenceCount', String(locations.length)),
        command: SHOW_REFERENCES_COMMAND,
        arguments: [symbol.uri, position, locations],
      },
    });
  }
  for (const template of index.templatesIn(fsPath)) {
    const locations = templateReferenceLocations(template, index);
    lenses.push({
      range: template.nameRange,
      command: {
        title: formatMessage(messages, 'referenceCount', String(locations.length)),
        command: SHOW_REFERENCES_COMMAND,
        arguments: [template.uri, template.nameRange.start, locations],
      },
    });
  }
  for (const member of index.membersIn(fsPath)) {
    if (member.tag !== 'transition' && member.tag !== 'transition-include') {
      continue;
    }
    const locations = locationsForMember(member, index);
    lenses.push({
      range: member.nameRange,
      command: {
        title: formatMessage(messages, 'referenceCount', String(locations.length)),
        command: SHOW_REFERENCES_COMMAND,
        arguments: [member.uri, member.nameRange.start, locations],
      },
    });
  }
  return lenses;
}

export function formFoldLenses(text: string, uri: string, messages: Messages): CodeLens[] {
  return foldingRanges(text, messages).map((range) => ({
    range: {
      start: { line: range.startLine, character: 0 },
      end: { line: range.startLine, character: 0 },
    },
    command: {
      title: range.collapsedText ?? '',
      command: FOLD_FORM_COMMAND,
      arguments: [uri, range.startLine],
    },
  }));
}

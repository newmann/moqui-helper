import { FoldingRange } from 'vscode-languageserver';
import { formatMessage, Messages } from '../messages';
import { attribute, scanXml } from '../xml/scan';

const FOLD_ROOTS = new Set(['screen', 'screen-extend', 'widget-templates']);

export function foldingRanges(text: string, messages: Messages): FoldingRange[] {
  const scan = scanXml(text);
  if (!scan.rootName || !FOLD_ROOTS.has(scan.rootName)) {
    return [];
  }
  const ranges: FoldingRange[] = [];
  for (const element of scan.elements) {
    if (element.name !== 'form-single' && element.name !== 'form-list') {
      continue;
    }
    if (element.outerRange.start.line === element.outerRange.end.line) {
      continue;
    }
    const name = attribute(element, 'name')?.value.trim() ?? '';
    const key = element.name === 'form-single'
      ? name ? 'foldSingleForm' : 'foldSingleFormEmpty'
      : name ? 'foldListForm' : 'foldListFormEmpty';
    ranges.push({
      startLine: element.outerRange.start.line,
      endLine: element.outerRange.end.line,
      collapsedText: formatMessage(messages, key, name),
    });
  }
  return ranges;
}

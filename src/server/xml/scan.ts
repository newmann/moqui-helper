import { Position, Range } from '../types';

export interface ScanAttribute {
  name: string;
  raw: string;
  value: string;
  range: Range;
  startOffset: number;
  endOffset: number;
  nameStart: number;
  nameEnd: number;
}

export interface ScanElement {
  name: string;
  attributes: ScanAttribute[];
  startTagRange: Range;
  startOffset: number;
  endOffset: number;
  nameStart: number;
  nameEnd: number;
  nameRange: Range;
  parentIndex: number;
  outerRange: Range;
  outerEnd: number;
}

export interface ScanResult {
  rootName: string | undefined;
  elements: ScanElement[];
  positionAt(offset: number): Position;
}

export class LineMap {
  private readonly starts: number[];
  private readonly length: number;

  constructor(text: string) {
    const starts = [0];
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code === 10) {
        starts.push(index + 1);
      } else if (code === 13) {
        if (text.charCodeAt(index + 1) === 10) {
          index++;
        }
        starts.push(index + 1);
      }
    }
    this.starts = starts;
    this.length = text.length;
  }

  positionAt(offset: number): Position {
    const clamped = Math.max(0, Math.min(offset, this.length));
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.starts[mid] <= clamped) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return { line: low, character: clamped - this.starts[low] };
  }

  range(start: number, end: number): Range {
    return { start: this.positionAt(start), end: this.positionAt(end) };
  }
}

export function scanXml(text: string): ScanResult {
  const lines = new LineMap(text);
  const elements: ScanElement[] = [];
  const stack: number[] = [];
  let rootName: string | undefined;
  let index = 0;

  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open < 0) {
      break;
    }
    if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open + 4);
      index = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf(']]>', open + 9);
      index = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<?', open)) {
      const end = text.indexOf('?>', open + 2);
      index = end < 0 ? text.length : end + 2;
      continue;
    }
    if (text.startsWith('<!', open)) {
      index = skipDeclaration(text, open);
      continue;
    }
    if (text.startsWith('</', open)) {
      const closeEnd = closeEndTag(text, open, elements, stack, lines);
      index = closeEnd;
      continue;
    }

    const parsed = parseStartTag(text, open, lines, stack.length > 0 ? stack[stack.length - 1] : -1);
    if (!parsed) {
      index = open + 1;
      continue;
    }
    if (!rootName) {
      rootName = parsed.element.name;
    }
    elements.push(parsed.element);
    if (!parsed.selfClosing) {
      stack.push(elements.length - 1);
    }
    index = parsed.next;
  }

  return {
    rootName,
    elements,
    positionAt: (offset) => lines.positionAt(offset),
  };
}

export function decodeEntities(raw: string): string {
  if (!raw.includes('&')) {
    return raw;
  }
  return raw.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, body: string) => {
    switch (body) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default: {
        const codePoint = body.startsWith('#x')
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
        if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
          return match;
        }
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
    }
  });
}

export function attribute(element: ScanElement, name: string): ScanAttribute | undefined {
  return element.attributes.find((item) => item.name === name);
}

function closeEndTag(
  text: string,
  open: number,
  elements: ScanElement[],
  stack: number[],
  lines: LineMap,
): number {
  const end = text.indexOf('>', open + 2);
  const closeEnd = end < 0 ? text.length : end + 1;
  let nameAt = open + 2;
  while (nameAt < text.length && isWhitespace(text[nameAt])) {
    nameAt++;
  }
  const name = readName(text, nameAt);
  if (!name) {
    return closeEnd;
  }
  for (let index = stack.length - 1; index >= 0; index--) {
    if (elements[stack[index]].name !== name.name) {
      continue;
    }
    const closing = stack.splice(index);
    for (const elementIndex of closing) {
      const element = elements[elementIndex];
      element.outerEnd = closeEnd;
      element.outerRange = lines.range(element.startOffset, closeEnd);
    }
    break;
  }
  return closeEnd;
}

function parseStartTag(
  text: string,
  start: number,
  lines: LineMap,
  parentIndex: number,
): { element: ScanElement; next: number; selfClosing: boolean } | undefined {
  const name = readName(text, start + 1);
  if (!name) {
    return undefined;
  }
  const raw = text.slice(start + 1, name.next);
  const colon = raw.indexOf(':');
  const nameStart = colon >= 0 ? start + 1 + colon + 1 : start + 1;
  const nameEnd = name.next;

  const attributes: ScanAttribute[] = [];
  let selfClosing = false;
  let index = name.next;
  while (index < text.length) {
    index = skipWhitespace(text, index);
    if (index >= text.length) {
      break;
    }
    if (text.startsWith('/>', index)) {
      index += 2;
      selfClosing = true;
      break;
    }
    if (text[index] === '>') {
      index += 1;
      break;
    }
    if (text[index] === '<') {
      break;
    }

    const attributeName = readName(text, index);
    if (!attributeName) {
      index += 1;
      continue;
    }
    const attributeNameStart = index;
    const attributeNameEnd = attributeName.next;
    index = skipWhitespace(text, attributeName.next);
    if (text[index] !== '=') {
      continue;
    }
    index = skipWhitespace(text, index + 1);
    const quote = text[index];
    if (quote !== '"' && quote !== "'") {
      continue;
    }
    const valueStart = index + 1;
    const valueEnd = text.indexOf(quote, valueStart);
    if (valueEnd < 0) {
      index = text.length;
      break;
    }
    const rawValue = text.slice(valueStart, valueEnd);
    attributes.push({
      name: attributeName.name,
      raw: rawValue,
      value: decodeEntities(rawValue),
      range: lines.range(valueStart, valueEnd),
      startOffset: valueStart,
      endOffset: valueEnd,
      nameStart: attributeNameStart,
      nameEnd: attributeNameEnd,
    });
    index = valueEnd + 1;
  }

  const startTagRange = lines.range(start, index);
  return {
    element: {
      name: name.name,
      attributes,
      startTagRange,
      startOffset: start,
      endOffset: index,
      nameStart,
      nameEnd,
      nameRange: lines.range(nameStart, nameEnd),
      parentIndex,
      outerRange: startTagRange,
      outerEnd: index,
    },
    next: index,
    selfClosing,
  };
}

function readName(text: string, start: number): { name: string; next: number } | undefined {
  if (start >= text.length || !isNameStart(text[start])) {
    return undefined;
  }
  let index = start + 1;
  while (index < text.length && isNameChar(text[index])) {
    index++;
  }
  const raw = text.slice(start, index);
  const colon = raw.indexOf(':');
  return { name: colon >= 0 ? raw.slice(colon + 1) : raw, next: index };
}

function skipWhitespace(text: string, start: number): number {
  let index = start;
  while (index < text.length && isWhitespace(text[index])) {
    index++;
  }
  return index;
}

function skipDeclaration(text: string, start: number): number {
  let quote = '';
  let brackets = 0;
  for (let index = start + 2; index < text.length; index++) {
    const ch = text[index];
    if (quote) {
      if (ch === quote) {
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[') {
      brackets++;
    } else if (ch === ']') {
      brackets = Math.max(0, brackets - 1);
    } else if (ch === '>' && brackets === 0) {
      return index + 1;
    }
  }
  return text.length;
}

function isNameStart(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || ch === '_' || ch === ':';
}

function isNameChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return isNameStart(ch) || (code >= 48 && code <= 57) || ch === '-' || ch === '.';
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

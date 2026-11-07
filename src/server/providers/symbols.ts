import { DocumentSymbol, SymbolKind } from 'vscode-languageserver';
import { attribute, ScanElement, scanXml } from '../xml/scan';

const SERVICE_TAGS = new Set(['service', 'service-include']);

export function documentSymbols(text: string): DocumentSymbol[] {
  const scan = scanXml(text);
  const nodes: DocumentSymbol[] = scan.elements.map((element) => ({
    name: outlineLabel(element),
    kind: SymbolKind.Field,
    range: element.outerRange,
    selectionRange: element.startTagRange,
  }));
  const roots: DocumentSymbol[] = [];
  for (let index = 0; index < nodes.length; index++) {
    const parentIndex = scan.elements[index].parentIndex;
    const node = nodes[index];
    if (parentIndex < 0) {
      roots.push(node);
      continue;
    }
    const parent = nodes[parentIndex];
    if (!parent.children) {
      parent.children = [];
    }
    parent.children.push(node);
  }
  return roots;
}

function outlineLabel(element: ScanElement): string {
  const suffix = outlineSuffix(element);
  return suffix ? `${element.name}: ${suffix}` : element.name;
}

function outlineSuffix(element: ScanElement): string | undefined {
  if (SERVICE_TAGS.has(element.name)) {
    const verb = attributeText(element, 'verb');
    if (verb) {
      const noun = attributeText(element, 'noun');
      return noun ? `${verb}#${noun}` : verb;
    }
  }
  return attributeText(element, 'name')
    ?? attributeText(element, 'entity-name')
    ?? attributeText(element, 'field-name');
}

function attributeText(element: ScanElement, name: string): string | undefined {
  const value = attribute(element, name)?.value.trim();
  return value ? value : undefined;
}

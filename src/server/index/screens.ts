import { SymbolRecord } from '../types';
import { ScanResult } from '../xml/scan';
import { ComponentInfo, containingComponent, relativeToComponent } from './components';

export function screenFileName(location: string): string {
  const slash = Math.max(location.lastIndexOf('/'), location.lastIndexOf('\\'));
  return slash < 0 ? location : location.slice(slash + 1);
}

export function screenCanonicalLocation(
  filePath: string,
  components: readonly ComponentInfo[],
): string | undefined {
  const component = containingComponent(filePath, components);
  if (!component) {
    return undefined;
  }
  const relative = relativeToComponent(filePath, component);
  if (!relative) {
    return undefined;
  }
  return `component://${component.name}/${relative}`;
}

export function extractScreens(
  scan: ScanResult,
  filePath: string,
  uri: string,
  components: readonly ComponentInfo[],
): SymbolRecord[] {
  if (scan.rootName !== 'screen') {
    return [];
  }
  const root = scan.elements[0];
  if (!root || root.name !== 'screen') {
    return [];
  }
  const location = screenCanonicalLocation(filePath, components);
  if (!location) {
    return [];
  }
  return [
    {
      kind: 'screen',
      name: location,
      aliases: [],
      uri,
      range: root.startTagRange,
    },
  ];
}

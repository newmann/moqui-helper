import * as path from 'path';
import { isComponentXmlPath, isInside, toPosix } from '../paths';
import { attribute, ScanResult } from '../xml/scan';

export interface ComponentInfo {
  name: string;
  rootPath: string;
}

export function readComponent(filePath: string, scan: ScanResult): ComponentInfo | undefined {
  if (!isComponentXmlPath(filePath) || scan.rootName !== 'component') {
    return undefined;
  }
  const root = scan.elements[0];
  const name = root ? attribute(root, 'name')?.value.trim() : undefined;
  if (!root || root.name !== 'component' || !name) {
    return undefined;
  }
  return { name, rootPath: path.normalize(path.dirname(filePath)) };
}

export function containingComponent(
  filePath: string,
  components: readonly ComponentInfo[],
): ComponentInfo | undefined {
  let best: ComponentInfo | undefined;
  let bestLength = -1;
  for (const component of components) {
    if (isInside(filePath, component.rootPath) && component.rootPath.length > bestLength) {
      best = component;
      bestLength = component.rootPath.length;
    }
  }
  return best;
}

export function relativeToComponent(filePath: string, component: ComponentInfo): string | undefined {
  if (!isInside(filePath, component.rootPath)) {
    return undefined;
  }
  const relative = toPosix(path.relative(component.rootPath, filePath));
  if (!relative || relative.startsWith('..')) {
    return undefined;
  }
  return relative;
}

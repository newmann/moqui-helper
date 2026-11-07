import { ScanElement, ScanResult } from '../xml/scan';

export interface FacadeChain {
  names: string[];
  dynamic: boolean;
  leaf: ScanElement;
}

export function isFacadeRoot(scan: ScanResult, elementIndex: number): boolean {
  const element = scan.elements[elementIndex];
  if (!element) {
    return false;
  }
  if (element.parentIndex < 0) {
    return scan.rootName === 'entity-facade-xml';
  }
  if (element.name !== 'seed-data') {
    return false;
  }
  const parent = scan.elements[element.parentIndex];
  return parent?.name === 'entity' || parent?.name === 'extend-entity';
}

export function facadeRootIndex(scan: ScanResult, elementIndex: number): number | undefined {
  let current = elementIndex;
  while (current >= 0) {
    if (isFacadeRoot(scan, current)) {
      return current;
    }
    const parent = scan.elements[current]?.parentIndex;
    if (parent === undefined) {
      return undefined;
    }
    current = parent;
  }
  return undefined;
}

export function isFacadeDataElement(scan: ScanResult, elementIndex: number): boolean {
  const root = facadeRootIndex(scan, elementIndex);
  return root !== undefined && root !== elementIndex;
}

/** Name chain from the first child of the facade root through this element. */
export function facadeDataChain(scan: ScanResult, elementIndex: number): FacadeChain | undefined {
  if (!isFacadeDataElement(scan, elementIndex)) {
    return undefined;
  }
  const root = facadeRootIndex(scan, elementIndex);
  if (root === undefined) {
    return undefined;
  }
  const chain: ScanElement[] = [];
  let current = elementIndex;
  let dynamic = false;
  while (current >= 0 && current !== root) {
    const element = scan.elements[current];
    if (!element) {
      return undefined;
    }
    if (element.name.includes('${')) {
      dynamic = true;
    }
    chain.push(element);
    current = element.parentIndex;
  }
  chain.reverse();
  const leaf = chain[chain.length - 1];
  if (!leaf) {
    return undefined;
  }
  return { names: chain.map((element) => element.name), dynamic, leaf };
}

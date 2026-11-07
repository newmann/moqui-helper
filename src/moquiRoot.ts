import * as fs from 'fs';
import * as path from 'path';

export const MOQUI_ROOT_MARKERS = ['MoquiInit.properties', 'moq'] as const;

export function hasMoquiRootMarker(root: string): boolean {
  return MOQUI_ROOT_MARKERS.some((name) => fs.existsSync(path.join(root, name)));
}

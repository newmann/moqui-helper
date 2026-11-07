import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { hasMoquiRootMarker } from '../src/moquiRoot';

describe('hasMoquiRootMarker', () => {
  it('accepts MoquiInit.properties or moq at the workspace root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moqui-marker-'));
    try {
      assert.equal(hasMoquiRootMarker(root), false);
      fs.mkdirSync(path.join(root, 'nested'));
      fs.writeFileSync(path.join(root, 'nested', 'moq'), '');
      assert.equal(hasMoquiRootMarker(root), false);
      fs.writeFileSync(path.join(root, 'moq'), '');
      assert.equal(hasMoquiRootMarker(root), true);
      fs.rmSync(path.join(root, 'moq'));
      assert.equal(hasMoquiRootMarker(root), false);
      fs.writeFileSync(path.join(root, 'MoquiInit.properties'), '');
      assert.equal(hasMoquiRootMarker(root), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

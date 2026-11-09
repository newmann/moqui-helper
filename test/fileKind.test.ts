import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { describe, it } from 'node:test';
import { FILE_KINDS, fileKindForRoot, readRootTag } from '../src/fileKind';

describe('readRootTag', () => {
  it('reads a root after a declaration, comment, doctype, and cdata', () => {
    const text = [
      '\uFEFF<?xml version="1.0" encoding="UTF-8"?>',
      '<!-- <services> -->',
      '<![CDATA[ <secas/> ]]>',
      '<!DOCTYPE entities [',
      '  <!ELEMENT entities ANY>',
      ']>',
      '<ns:screen-extend xmlns:ns="urn:example">',
    ].join('\n');
    assert.equal(readRootTag(text), 'screen-extend');
  });

  it('stops when the prologue is not closed', () => {
    assert.equal(readRootTag('<!-- <entities>'), undefined);
    assert.equal(readRootTag('<?xml version="1.0"'), undefined);
    assert.equal(readRootTag(''), undefined);
    assert.equal(readRootTag('not xml'), undefined);
  });

  it('recognizes every moqui root and ignores other roots', () => {
    for (const kind of FILE_KINDS) {
      assert.equal(
        readRootTag(`<${kind.root} xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`),
        kind.root,
      );
      assert.equal(fileKindForRoot(kind.root), kind);
    }
    assert.equal(fileKindForRoot(readRootTag('<project/>')), undefined);
    assert.equal(fileKindForRoot('view-entity'), undefined);
  });

  it('uses distinct two-letter badges and one shared screen color', () => {
    const badges = FILE_KINDS.map((kind) => kind.badge);
    assert.equal(new Set(badges).size, badges.length);
    for (const badge of badges) {
      assert.equal(badge.length, 2);
    }
    const screen = fileKindForRoot('screen');
    const extend = fileKindForRoot('screen-extend');
    assert.ok(screen);
    assert.ok(extend);
    assert.equal(screen.colorId, extend.colorId);
    assert.notEqual(screen.badge, extend.badge);
    assert.equal(screen.badge, 'Sc');
    assert.equal(extend.badge, 'Sx');
  });

  it('publishes tooltip text and theme colors for each kind', () => {
    const english = readJson('package.nls.json');
    const chinese = readJson('package.nls.zh-cn.json');
    const manifest = readJson('package.json');
    const contributed = manifest.contributes as { colors?: Array<{ id?: string; description?: string }> };
    const colors = new Map((contributed.colors ?? []).map((color) => [color.id, color.description]));
    const seenColors = new Set<string>();
    for (const kind of FILE_KINDS) {
      assert.equal(typeof english[kind.tooltipKey], 'string');
      assert.equal(typeof chinese[kind.tooltipKey], 'string');
      assert.notEqual(english[kind.tooltipKey], '');
      assert.notEqual(chinese[kind.tooltipKey], '');
      assert.equal(typeof english[kind.colorKey], 'string');
      assert.equal(typeof chinese[kind.colorKey], 'string');
      if (seenColors.has(kind.colorId)) {
        continue;
      }
      seenColors.add(kind.colorId);
      assert.equal(colors.get(kind.colorId), `%${kind.colorKey}%`);
    }
    assert.equal(seenColors.size, 12);
  });
});

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', name), 'utf8')) as Record<string, unknown>;
}

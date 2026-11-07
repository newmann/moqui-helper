import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { describe, it } from 'node:test';
import { mergeMessages, nlsFileName } from '../src/nls';

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', name), 'utf8')) as Record<string, unknown>;
}

describe('nls', () => {
  it('selects simplified Chinese for zh-cn and zh-hans', () => {
    assert.equal(nlsFileName('zh-cn'), 'package.nls.zh-cn.json');
    assert.equal(nlsFileName('ZH-CN'), 'package.nls.zh-cn.json');
    assert.equal(nlsFileName('zh-hans'), 'package.nls.zh-cn.json');
  });

  it('uses the English pack for other host languages', () => {
    assert.equal(nlsFileName('en'), 'package.nls.json');
    assert.equal(nlsFileName('zh-tw'), 'package.nls.json');
    assert.equal(nlsFileName(''), 'package.nls.json');
  });

  it('fills missing localized keys from English', () => {
    const merged = mergeMessages(
      { unresolvedEntity: 'Entity "{0}" was not found.', hoverEntity: 'Entity {0}' },
      { hoverEntity: '实体 {0}' },
    );
    assert.equal(merged.unresolvedEntity, 'Entity "{0}" was not found.');
    assert.equal(merged.hoverEntity, '实体 {0}');
  });

  it('keeps the same keys in English and simplified Chinese', () => {
    const english = readJson('package.nls.json');
    const chinese = readJson('package.nls.zh-cn.json');
    const englishKeys = Object.keys(english).sort();
    const chineseKeys = Object.keys(chinese).sort();
    assert.deepEqual(chineseKeys, englishKeys);
    for (const key of ['displayName', 'description']) {
      assert.equal(englishKeys.includes(key), true);
      assert.equal(typeof english[key], 'string');
      assert.equal(typeof chinese[key], 'string');
      assert.notEqual(english[key], '');
      assert.notEqual(chinese[key], '');
    }
    const manifest = readJson('package.json');
    assert.equal(manifest.displayName, '%displayName%');
    assert.equal(manifest.description, '%description%');
  });
});

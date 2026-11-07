import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'node:test';
import { TextEdit } from 'vscode-languageserver';
import { WorkspaceIndex } from '../src/server/index/workspace';
import { Messages } from '../src/server/messages';
import { fsPathToUri } from '../src/server/paths';
import { completionAt } from '../src/server/providers/completion';
import { definitionAt } from '../src/server/providers/definition';
import { collectDiagnostics } from '../src/server/providers/diagnostics';
import { inlayHintsFor } from '../src/server/providers/inlayHint';
import { LineMap } from '../src/server/xml/scan';

const messages: Messages = {
  localizedMessage: '(LocalizedMessage)',
  unresolvedEntity: 'missing entity {0}',
};

const root = path.join(os.tmpdir(), 'moqui-p8-text');
const dataPath = path.join(root, 'data', 'LocalizedMessage.xml');
const otherPath = path.join(root, 'data', 'Other.xml');
const screenPath = path.join(root, 'screen', 'Order.xml');
const entityPath = path.join(root, 'entity', 'Person.xml');

const escaped = 'A & B < C > "D"';
const dataText = [
  '<entity-facade-xml type="seed">',
  '  <moqui.basic.LocalizedMessage original="Order" locale="default" localized="Order"/>',
  '  <LocalizedMessage original="Order Item" locale="default" localized="Order item"/>',
  '  <LocalizedMessage original="Order" locale="zh" localized="订单"/>',
  '  <LocalizedMessage original="OnlyZh" locale="zh" localized="仅中文"/>',
  '  <LocalizedMessage original="Skipped" localized="Skipped"/>',
  '  <LocalizedMessage original="WrongCase" locale="Default"/>',
  '  <LocalizedMessage original="" locale="default"/>',
  '  <LocalizedMessage locale="default" original="A &amp; B &lt; C &gt; &quot;D&quot;"/>',
  '  <LocalizedMessage locale="default" original="${description}"/>',
  '  <LocalizedMessage locale="default" original=" "/>',
  '  <LocalizedMessage original="Twin" locale="default"/>',
  '  <LocalizedMessage original="Twin" locale="default"/>',
  '  <wrapper>',
  '    <LocalizedMessage original="Hidden" locale="default"/>',
  '  </wrapper>',
  '</entity-facade-xml>',
].join('\n');
const otherText = '<entity-facade-xml><LocalizedMessage original="Order" locale="default" localized="Other"/></entity-facade-xml>';
const entityText = '<entities><entity entity-name="Person" package="moqui.basic"/></entities>';
const seedText = [
  '<entities>',
  '  <entity entity-name="LocalizedMessage" package="moqui.basic">',
  '    <seed-data>',
  '      <moqui.basic.LocalizedMessage original="FromSeed" locale="default"/>',
  '    </seed-data>',
  '  </entity>',
  '</entities>',
].join('\n');

const originals = [' ', '${description}', escaped, 'Order', 'Order Item', 'Twin'].sort((left, right) => left.localeCompare(right));

function build(files: Record<string, string>): WorkspaceIndex {
  const index = new WorkspaceIndex();
  for (const [file, text] of Object.entries(files)) {
    index.replaceFile(fsPathToUri(file), file, text);
  }
  return index;
}

function indexed(): WorkspaceIndex {
  return build({
    [dataPath]: dataText,
    [otherPath]: otherText,
    [entityPath]: entityText,
    [path.join(root, 'entity', 'Seed.xml')]: seedText,
  });
}

function labelsAt(text: string, index: WorkspaceIndex, marker: string): string[] {
  const offset = text.indexOf(marker) + marker.length;
  return completionAt(text, offset, index, screenPath)?.map((item) => item.label) ?? [];
}

function valueRange(text: string, value: string, from = 0) {
  const start = text.indexOf(value, from);
  return new LineMap(text).range(start, start + value.length);
}

describe('text templates', () => {
  const index = indexed();

  it('indexes default-locale originals from direct entity-facade-xml children', () => {
    assert.deepEqual(index.textTemplateOriginals().sort((left, right) => left.localeCompare(right)), originals);
    assert.equal(index.findTextTemplates('Order').length, 2);
    assert.equal(index.findTextTemplates('Twin').length, 2);
    assert.equal(index.findTextTemplates('OnlyZh').length, 0);
    assert.equal(index.findTextTemplates('Skipped').length, 0);
    assert.equal(index.findTextTemplates('WrongCase').length, 0);
    assert.equal(index.findTextTemplates('Hidden').length, 0);
    assert.equal(index.findTextTemplates('FromSeed').length, 0);
    assert.equal(index.findTextTemplates('').length, 0);
  });

  it('completes originals by decoded prefix and escapes the inserted value', () => {
    assert.deepEqual(labelsAt('<screen><label text=""/></screen>', index, 'text="'), originals);
    assert.deepEqual(labelsAt('<screen><display text="Order"/></screen>', index, 'text="Order'), ['Order', 'Order Item']);
    assert.deepEqual(labelsAt('<widget-templates><label text=""/></widget-templates>', index, 'text="'), originals);

    const partial = '<screen><label text="A &"/></screen>';
    const items = completionAt(partial, partial.indexOf('text="') + 'text="'.length + 'A &'.length, index, screenPath) ?? [];
    const escapedItem = items.find((item) => item.label === escaped);
    assert.ok(escapedItem?.textEdit && TextEdit.is(escapedItem.textEdit));
    if (escapedItem?.textEdit && TextEdit.is(escapedItem.textEdit)) {
      assert.equal(escapedItem.textEdit.newText, 'A &amp; B &lt; C &gt; &quot;D&quot;');
    }
  });

  it('leaves link urls and entity names on their existing completion', () => {
    const link = '<screen><link url="" text="Order"/></screen>';
    assert.equal(labelsAt(link, index, 'url="').includes('Order'), false);

    const entity = '<screen><display-entity entity-name="" text="Order"/></screen>';
    const names = labelsAt(entity, index, 'entity-name="');
    assert.ok(names.includes('Person'));
    assert.equal(names.includes('Order'), false);
  });

  it('jumps an exact value to every original and ignores literals', () => {
    const screen = '<screen><label text="Order"/></screen>';
    const locations = definitionAt(screen, screen.indexOf('Order'), screenPath, index);
    assert.equal(locations?.length, 2);
    const dataStart = dataText.indexOf('original="Order"') + 'original="'.length;
    const otherStart = otherText.indexOf('original="Order"') + 'original="'.length;
    assert.deepEqual(locations?.map((location) => location.range), [
      new LineMap(dataText).range(dataStart, dataStart + 'Order'.length),
      new LineMap(otherText).range(otherStart, otherStart + 'Order'.length),
    ]);

    const expression = '<screen><display text="${description}"/></screen>';
    const expressionDefs = definitionAt(expression, expression.indexOf('${description}'), screenPath, index);
    assert.equal(expressionDefs?.length, 1);
    const expressionStart = dataText.indexOf('original="${description}"') + 'original="'.length;
    assert.deepEqual(expressionDefs?.[0].range, new LineMap(dataText).range(expressionStart, expressionStart + '${description}'.length));

    const literal = '<screen><label text="Save"/></screen>';
    assert.equal(definitionAt(literal, literal.indexOf('Save'), screenPath, index), null);
    const partial = '<screen><label text="Or"/></screen>';
    assert.equal(definitionAt(partial, partial.indexOf('Or'), screenPath, index), null);
    const mismatchedCase = '<screen><label text="order"/></screen>';
    assert.equal(definitionAt(mismatchedCase, mismatchedCase.indexOf('order'), screenPath, index), null);
    const menu = '<screen><button-menu text="Order"/></screen>';
    assert.equal(definitionAt(menu, menu.indexOf('Order'), screenPath, index), null);
  });

  it('shows the localized-message hint only when the whole value matches', () => {
    const screen = [
      '<screen>',
      '  <label text="Order"/>',
      '  <display text="Save"/>',
      '  <link text="Hello ${name}"/>',
      '  <button-menu text="Order"/>',
      '</screen>',
    ].join('\n');
    const hints = inlayHintsFor(screen, index, messages);
    assert.equal(hints.length, 1);
    assert.equal(hints[0].label, '(LocalizedMessage)');
    assert.equal(hints[0].paddingRight, true);
    const start = screen.indexOf('Order');
    assert.deepEqual(hints[0].position, new LineMap(screen).positionAt(start));

    const extend = '<screen-extend><display-entity text="Order Item"/></screen-extend>';
    assert.equal(inlayHintsFor(extend, index, messages).length, 1);
    const templates = '<widget-templates><list-options text="${description}"/></widget-templates>';
    assert.equal(inlayHintsFor(templates, index, messages).length, 1);
    const services = '<services><label text="Order"/></services>';
    assert.deepEqual(inlayHintsFor(services, index, messages), []);

    const limited = inlayHintsFor(screen, index, messages, {
      start: { line: 2, character: 0 },
      end: { line: 2, character: 40 },
    });
    assert.deepEqual(limited, []);
  });

  it('does not diagnose unmatched text values', () => {
    const literal = '<screen><label text="Save"/><link text="Hello ${name}"/></screen>';
    assert.deepEqual(collectDiagnostics(literal, screenPath, index, messages), []);

    const mixed = '<screen><display-entity entity-name="missing.Name" text="Save"/></screen>';
    const diagnostics = collectDiagnostics(mixed, screenPath, index, messages);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].message, 'missing entity missing.Name');
    assert.deepEqual(diagnostics[0].range, valueRange(mixed, 'missing.Name'));
  });

  it('drops templates when the data file changes or is removed', () => {
    const fresh = build({ [dataPath]: dataText });
    const screen = '<screen><label text=""/></screen>';
    assert.ok(labelsAt(screen, fresh, 'text="').includes('Order'));

    fresh.replaceFile(fsPathToUri(dataPath), dataPath, '<entity-facade-xml><LocalizedMessage original="Kept" locale="default"/></entity-facade-xml>');
    assert.deepEqual(labelsAt(screen, fresh, 'text="'), ['Kept']);
    assert.deepEqual(inlayHintsFor('<screen><label text="Order"/></screen>', fresh, messages), []);
    assert.equal(inlayHintsFor('<screen><label text="Kept"/></screen>', fresh, messages).length, 1);

    fresh.removeFile(dataPath);
    assert.deepEqual(fresh.textTemplateOriginals(), []);
    assert.deepEqual(inlayHintsFor('<screen><label text="Kept"/></screen>', fresh, messages), []);
  });
});

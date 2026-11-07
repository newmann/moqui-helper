import assert from 'node:assert/strict';
import * as path from 'path';
import { describe, it } from 'node:test';
import { CompletionItemKind } from 'vscode-languageserver';
import { WorkspaceIndex } from '../src/server/index/workspace';
import { Messages } from '../src/server/messages';
import { completionAt } from '../src/server/providers/completion';
import { collectDiagnostics } from '../src/server/providers/diagnostics';
import { FORMAT_VALUES, PARAMETER_TYPES } from '../src/server/refs/fixedValues';
import { LineMap } from '../src/server/xml/scan';

const messages: Messages = {
  unresolvedEntity: 'missing entity {0}',
  unresolvedService: 'missing service {0}',
  unresolvedScreen: 'missing screen {0}',
  unresolvedFacadeTag: 'missing tag {0}',
};

const workspace = path.join(__dirname, 'virtual-fixed');
const partyPath = path.join(workspace, 'entity', 'Party.xml');
const otherPath = path.join(workspace, 'entity', 'Other.xml');
const extendPath = path.join(workspace, 'entity', 'Extend.xml');

function indexed(): WorkspaceIndex {
  const index = new WorkspaceIndex();
  index.setWorkspaceRoots([workspace]);
  index.replaceFile(
    'file:///party.xml',
    partyPath,
    '<entities><entity entity-name="Party" package="mantle.party"/><entity entity-name="Dyn" package="${dynamic.pack}"/></entities>',
  );
  index.replaceFile(
    'file:///other.xml',
    otherPath,
    '<entities><entity entity-name="Other" package="mantle.party"/><view-entity entity-name="PartyView" package="view.pack"/></entities>',
  );
  index.replaceFile(
    'file:///extend.xml',
    extendPath,
    '<entities><extend-entity entity-name="Party" package="only.extend"/></entities>',
  );
  return index;
}

function labelsAt(text: string, token: string, index: WorkspaceIndex, occurrence = 0): string[] {
  return completionAt(text, cursorAfter(text, token, occurrence), index)?.map((item) => String(item.label)) ?? [];
}

function cursorAfter(text: string, token: string, occurrence = 0): number {
  let from = 0;
  for (let index = 0; index <= occurrence; index++) {
    const at = text.indexOf(token, from);
    assert.notEqual(at, -1, token);
    from = at + token.length;
  }
  return from;
}

describe('fixed value completion', () => {
  it('completes distinct packages from entity and view-entity', () => {
    const index = indexed();
    assert.deepEqual(index.packages().sort(), ['mantle.party', 'view.pack']);

    const text = [
      '<entities>',
      '  <entity entity-name="New" package=""/>',
      '  <view-entity entity-name="NewView" package=""/>',
      '  <extend-entity entity-name="Party" package=""/>',
      '</entities>',
    ].join('\n');
    const expected = ['mantle.party', 'view.pack'];
    assert.deepEqual(labelsAt(text, 'package="', index, 0), expected);
    assert.deepEqual(labelsAt(text, 'package="', index, 1), expected);
    assert.deepEqual(labelsAt(text, 'package="', index, 2), expected);

    const prefixed = '<entities><entity entity-name="New" package="view"/></entities>';
    const items = completionAt(prefixed, cursorAfter(prefixed, 'package="view'), index) ?? [];
    assert.deepEqual(items.map((item) => item.label), ['view.pack']);
    assert.equal(items[0].kind, CompletionItemKind.Module);
    assert.deepEqual(items[0].textEdit, {
      range: new LineMap(prefixed).range(prefixed.indexOf('view"'), prefixed.indexOf('view"') + 'view'.length),
      newText: 'view.pack',
    });
  });

  it('skips dynamic packages and does not complete inside an expression', () => {
    const index = indexed();
    const text = '<entities><entity entity-name="New" package="${pack}"/></entities>';
    assert.equal(completionAt(text, cursorAfter(text, 'package="'), index), null);
  });

  it('completes parameter types, including nested parameters', () => {
    const index = indexed();
    const text = [
      '<services>',
      '  <service verb="get" noun="Party">',
      '    <in-parameters>',
      '      <parameter name="when" type="Big">',
      '        <parameter name="id" type="Big"/>',
      '      </parameter>',
      '    </in-parameters>',
      '  </service>',
      '</services>',
    ].join('\n');
    const expected = ['BigDecimal', 'BigInteger'];
    assert.deepEqual(labelsAt(text, 'type="Big', index, 0), expected);
    assert.deepEqual(labelsAt(text, 'type="Big', index, 1), expected);
    const open = '<services><service verb="get" noun="Party"><in-parameters><parameter name="when" type=""/></in-parameters></service></services>';
    const items = completionAt(open, cursorAfter(open, 'type="'), index) ?? [];
    assert.deepEqual(
      items.map((item) => item.label),
      [...PARAMETER_TYPES].sort(),
    );
    assert.equal(items[0].kind, CompletionItemKind.Class);
  });

  it('does not offer parameter types on other type attributes', () => {
    const index = indexed();
    const field = '<entities><entity entity-name="Party" package="mantle.party"><field name="partyId" type=""/></entity></entities>';
    const alias = '<entities><view-entity entity-name="PartyView" package="view.pack"><alias name="partyId" type=""/></view-entity></entities>';
    const service = '<services><service verb="get" noun="Party" type=""/></services>';
    assert.equal(completionAt(field, cursorAfter(field, 'type="'), index), null);
    assert.equal(completionAt(alias, cursorAfter(alias, 'type="'), index), null);
    assert.equal(completionAt(service, cursorAfter(service, 'type="'), index), null);
  });

  it('completes date and number formats on free-string format attributes', () => {
    const index = indexed();
    const snippets = [
      '<services><service verb="get" noun="Party"><in-parameters><parameter name="when" format=""/></in-parameters></service></services>',
      '<services><service verb="get" noun="Party"><in-parameters><parameter name="when"><time-range format=""/></parameter></in-parameters></service></services>',
      '<screen><actions><if><compare field="when" value="1" format=""/></if></actions></screen>',
      '<screen><form-single name="Find"><field name="when"><default-field><date-find format=""/></default-field></field></form-single></screen>',
      '<screen><form-single name="Find"><field name="when"><default-field><date-time format=""/></default-field></field></form-single></screen>',
      '<screen><form-single name="Find"><field name="when"><default-field><display format=""/></default-field></field></form-single></screen>',
      '<screen><form-single name="Find"><field name="when"><default-field><text-line format=""/></default-field></field></form-single></screen>',
    ];
    const expected = [...FORMAT_VALUES].sort();
    for (const text of snippets) {
      const items = completionAt(text, cursorAfter(text, 'format="'), index) ?? [];
      assert.deepEqual(
        items.map((item) => item.label),
        expected,
      );
      assert.equal(items[0].kind, CompletionItemKind.Value);
    }

    const prefixed = '<screen><form-single name="Find"><field name="when"><default-field><display format="yyyy"/></default-field></field></form-single></screen>';
    assert.deepEqual(labelsAt(prefixed, 'format="yyyy', index), [
      'yyyy-MM-dd',
      'yyyy-MM-dd HH:mm',
      'yyyy-MM-dd HH:mm:ss',
      'yyyy-MM-dd HH:mm:ss.SSS z',
    ]);
    const number = '<screen><form-single name="Find"><field name="amount"><default-field><text-line format="0.00"/></default-field></field></form-single></screen>';
    assert.deepEqual(labelsAt(number, 'format="0.00', index), ['0.00', '0.000', '0.00#'].sort());
  });

  it('does not complete text-format', () => {
    const index = indexed();
    const text = '<screen><form-single name="Find"><field name="when"><default-field><display text-format=""/></default-field></field></form-single></screen>';
    assert.equal(completionAt(text, cursorAfter(text, 'text-format="'), index), null);
  });

  it('keeps entity-name completion on the same extend-entity', () => {
    const index = indexed();
    const text = '<entities><extend-entity entity-name="Par" package="mant"/></entities>';
    const entityLabels = labelsAt(text, 'entity-name="Par', index);
    assert.ok(entityLabels.includes('Party'));
    assert.equal(entityLabels.includes('mantle.party'), false);
    assert.deepEqual(labelsAt(text, 'package="mant', index), ['mantle.party']);
  });

  it('does not diagnose values outside the lists', () => {
    const index = indexed();
    const entity = '<entities><entity entity-name="Thing" package="not.indexed"/></entities>';
    const extend = '<entities><extend-entity entity-name="mantle.party.Party" package="not.indexed"/></entities>';
    const service = [
      '<services><service verb="get" noun="Party"><in-parameters>',
      '<parameter name="when" type="java.util.Date" format="yyyy"/>',
      '</in-parameters></service></services>',
    ].join('');
    const screen = '<screen><form-single name="Find"><field name="when"><default-field><display text="Hello" format="dd/MM/yyyy"/></default-field></field></form-single></screen>';
    assert.deepEqual(collectDiagnostics(entity, partyPath, index, messages), []);
    assert.deepEqual(collectDiagnostics(extend, extendPath, index, messages), []);
    assert.deepEqual(collectDiagnostics(service, partyPath, index, messages), []);
    assert.deepEqual(collectDiagnostics(screen, partyPath, index, messages), []);
  });
});

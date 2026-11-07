import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SymbolKind } from 'vscode-languageserver';
import { documentSymbols } from '../src/server/providers/symbols';

function labels(text: string): unknown {
  return documentSymbols(text).map(function walk(symbol): unknown {
    return {
      name: symbol.name,
      kind: symbol.kind,
      children: symbol.children?.map(walk),
    };
  });
}

describe('documentSymbols', () => {
  it('shows name, entity-name, and field-name on the element', () => {
    const text = [
      '<entities>',
      '  <entity entity-name=" Party ">',
      '    <field name="partyId"/>',
      '    <relationship name="contact">',
      '      <key-map field-name="partyId"/>',
      '    </relationship>',
      '    <alias name="note" entity-name="ignored" field-name="ignored"/>',
      '  </entity>',
      '  <view-entity entity-name="A&amp;B"/>',
      '</entities>',
    ].join('\n');

    assert.deepEqual(labels(text), [
      {
        name: 'entities',
        kind: SymbolKind.Field,
        children: [
          {
            name: 'entity: Party',
            kind: SymbolKind.Field,
            children: [
              { name: 'field: partyId', kind: SymbolKind.Field, children: undefined },
              {
                name: 'relationship: contact',
                kind: SymbolKind.Field,
                children: [{ name: 'key-map: partyId', kind: SymbolKind.Field, children: undefined }],
              },
              { name: 'alias: note', kind: SymbolKind.Field, children: undefined },
            ],
          },
          { name: 'view-entity: A&B', kind: SymbolKind.Field, children: undefined },
        ],
      },
    ]);
  });

  it('joins verb and noun for service and service-include', () => {
    const text = [
      '<services>',
      '  <service verb="get" noun="Party" name="ignored"/>',
      '  <service verb=" store "/>',
      '  <service-include verb="find" noun="Party"/>',
      '  <service name="only-name"/>',
      '  <service verb="   " name="Fallback"/>',
      '</services>',
    ].join('\n');

    assert.deepEqual(labels(text), [
      {
        name: 'services',
        kind: SymbolKind.Field,
        children: [
          { name: 'service: get#Party', kind: SymbolKind.Field, children: undefined },
          { name: 'service: store', kind: SymbolKind.Field, children: undefined },
          { name: 'service-include: find#Party', kind: SymbolKind.Field, children: undefined },
          { name: 'service: only-name', kind: SymbolKind.Field, children: undefined },
          { name: 'service: Fallback', kind: SymbolKind.Field, children: undefined },
        ],
      },
    ]);
  });

  it('keeps the tag name when no identifier attribute is set', () => {
    const text = '<screen><actions/><section name=""/></screen>';
    assert.deepEqual(labels(text), [
      {
        name: 'screen',
        kind: SymbolKind.Field,
        children: [
          { name: 'actions', kind: SymbolKind.Field, children: undefined },
          { name: 'section', kind: SymbolKind.Field, children: undefined },
        ],
      },
    ]);
  });

  it('uses the outer range for the symbol and the start tag for selection', () => {
    const text = ['<screen>', '  <form-single name="Find">', '    <field name="partyId"/>', '  </form-single>', '</screen>'].join('\n');
    const screen = documentSymbols(text)[0];
    const form = screen.children?.[0];
    assert.ok(form);
    assert.equal(form.selectionRange.start.line, 1);
    assert.equal(form.selectionRange.end.line, 1);
    assert.equal(form.range.start.line, 1);
    assert.equal(form.range.end.line, 3);
    assert.ok(form.range.end.line > form.selectionRange.end.line);
  });
});

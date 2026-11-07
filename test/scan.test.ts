import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attribute, decodeEntities, scanXml } from '../src/server/xml/scan';

describe('scanXml', () => {
  it('records attribute values and skips comments, cdata, and doctype', () => {
    const text = [
      '<entities>',
      '  <!-- <entity entity-name="Hidden" package="nope"/> -->',
      '  <![CDATA[ <entity entity-name="Hidden2" package="nope"/> ]]>',
      '  <!DOCTYPE entities>',
      '  <ns:entity entity-name="A&amp;B" package="p"/>',
      '</entities>',
    ].join('\n');
    const scan = scanXml(text);

    assert.equal(scan.rootName, 'entities');
    assert.deepEqual(
      scan.elements.map((element) => element.name),
      ['entities', 'entity'],
    );
    const entityName = attribute(scan.elements[1], 'entity-name');
    assert.ok(entityName);
    assert.equal(entityName.value, 'A&B');
    assert.equal(text.slice(entityName.startOffset, entityName.endOffset), 'A&amp;B');
  });

  it('places a multiline attribute on its source line', () => {
    const text = '<entity\n  entity-name="Party"\n  package="mantle.party"/>';
    const scan = scanXml(text);
    const entityName = attribute(scan.elements[0], 'entity-name');
    assert.ok(entityName);
    assert.equal(entityName.range.start.line, 1);
    assert.equal(text.slice(entityName.startOffset, entityName.endOffset), 'Party');
    assert.equal(scan.positionAt(entityName.startOffset).character, entityName.range.start.character);
  });

  it('links parents and closes elements at the matching end tag', () => {
    const text = [
      '<screen>',
      '  <form-single name="Find">',
      '    <field name="partyId"><default-field/></field>',
      '  </form-single>',
      '</screen>',
    ].join('\n');
    const scan = scanXml(text);
    const screen = scan.elements[0];
    const form = scan.elements[1];
    const field = scan.elements[2];
    const widget = scan.elements[3];

    assert.equal(screen.parentIndex, -1);
    assert.equal(form.parentIndex, 0);
    assert.equal(field.parentIndex, 1);
    assert.equal(widget.parentIndex, 2);
    assert.equal(text.slice(form.startOffset, form.outerEnd), text.slice(text.indexOf('<form-single'), text.indexOf('</form-single>') + '</form-single>'.length));
    assert.equal(widget.outerEnd, widget.endOffset);
    assert.equal(text.slice(widget.startOffset, widget.outerEnd), '<default-field/>');
  });
});

describe('decodeEntities', () => {
  it('decodes the basic xml entities and numeric character references', () => {
    assert.equal(decodeEntities('A&amp;B&lt;&gt;&quot;&apos;&#65;&#x42;'), 'A&B<>"\'AB');
    assert.equal(decodeEntities('plain'), 'plain');
  });
});

import assert from 'node:assert/strict';
import * as path from 'path';
import { describe, it } from 'node:test';
import { Hover, RenameFile, TextDocumentEdit, WorkspaceEdit } from 'vscode-languageserver';
import { WorkspaceIndex } from '../src/server/index/workspace';
import { Messages } from '../src/server/messages';
import { codeLensesFor, formFoldLenses } from '../src/server/providers/codeLens';
import { completionAt } from '../src/server/providers/completion';
import { definitionAt } from '../src/server/providers/definition';
import { collectDiagnostics } from '../src/server/providers/diagnostics';
import { foldingRanges } from '../src/server/providers/folding';
import { hoverAt } from '../src/server/providers/hover';
import { prepareRenameAt, referenceLocations, renameAt } from '../src/server/refs/rename';
import { Range } from '../src/server/types';
import { LineMap } from '../src/server/xml/scan';

const messages: Messages = {
  unresolvedEntity: 'missing entity {0}',
  unresolvedService: 'missing service {0}',
  unresolvedScreen: 'missing screen {0}',
  unresolvedFacadeTag: 'missing tag {0}',
  hoverEntity: 'entity {0}',
  hoverViewEntity: 'view {0}',
  hoverService: 'service {0}',
  hoverScreen: 'screen {0}',
  hoverField: 'field {0}',
  hoverRelationship: 'relationship {0}',
  hoverPk: 'pk',
  hoverCrud: 'crud {0} entity {1}',
  referenceCount: '{0} refs',
  renameAmbiguous: 'ambiguous {0}',
  renameDynamic: 'dynamic',
  renamePattern: 'pattern',
  renamePackage: 'package',
  renameServiceClass: 'class',
  renameServicePart: 'part',
  renameScreenUnsupported: 'no file rename',
  renameInvalidScreenName: 'bad screen',
  renameInvalidName: 'bad name',
  foldSingleForm: 'Single Form: {0}',
  foldSingleFormEmpty: 'Single Form:',
  foldListForm: 'List Form: {0}',
  foldListFormEmpty: 'List Form:',
};

const options = { messages, fileRename: true, documentChanges: true };
const workspace = path.join(__dirname, 'virtual-edit');
const mantleRoot = path.join(workspace, 'runtime', 'component', 'mantle');
const entityPath = path.join(mantleRoot, 'entity', 'Party.xml');
const servicePath = path.join(mantleRoot, 'service', 'mantle', 'party', 'PartyServices.xml');
const findPath = path.join(mantleRoot, 'screen', 'Find.xml');
const editPath = path.join(mantleRoot, 'screen', 'Edit.xml');
const dataPath = path.join(mantleRoot, 'data', 'PartyData.xml');

const entityText = [
  '<entities>',
  '  <entity entity-name="Party" package="mantle.party" short-alias="parties">',
  '    <field name="partyId" type="id" is-pk="true"/>',
  '    <field name="statusId" type="id"/>',
  '    <relationship type="many" related="mantle.party.Contact" short-alias="contacts">',
  '      <key-map field-name="partyId"/>',
  '    </relationship>',
  '  </entity>',
  '  <entity entity-name="Contact" package="mantle.party">',
  '    <field name="contactMechId" type="id" is-pk="true"/>',
  '    <field name="note" type="text-long"/>',
  '  </entity>',
  '  <view-entity entity-name="PartyView" package="mantle.party">',
  '    <member-entity entity-alias="PTY" entity-name="mantle.party.Party"/>',
  '    <alias-all entity-alias="PTY" prefix="pty"><exclude field="statusId"/></alias-all>',
  '    <alias name="partyId" entity-alias="PTY" field="partyId"/>',
  '  </view-entity>',
  '</entities>',
].join('\n');

const extendedEntityText = entityText.replace(
  '</entities>',
  '  <extend-entity entity-name="Party" package="mantle.party"><field name="extra" type="text-long"/></extend-entity>\n</entities>',
);

const serviceText = [
  '<services>',
  '  <service verb="get" noun="Party">',
  '    <in-parameters>',
  '      <parameter name="partyId" required="true"/>',
  '      <auto-parameters entity-name="mantle.party.Party" include="nonpk"/>',
  '    </in-parameters>',
  '    <out-parameters>',
  '      <parameter name="resultCount"/>',
  '    </out-parameters>',
  '  </service>',
  '</services>',
].join('\n');

function indexed(): WorkspaceIndex {
  const index = new WorkspaceIndex();
  index.setWorkspaceRoots([workspace]);
  index.replaceFile('file:///mantle-component.xml', path.join(mantleRoot, 'component.xml'), '<component name="mantle"/>');
  index.replaceFile('file:///party.xml', entityPath, entityText);
  index.replaceFile('file:///services.xml', servicePath, serviceText);
  index.replaceFile('file:///find.xml', findPath, '<screen></screen>');
  return index;
}

function changes(edit: WorkspaceEdit): { uri: string; text: string }[] {
  const found: { uri: string; text: string }[] = [];
  for (const change of edit.documentChanges ?? []) {
    if (TextDocumentEdit.is(change)) {
      for (const textEdit of change.edits) {
        if ('range' in textEdit) {
          found.push({ uri: change.textDocument.uri, text: textEdit.newText });
        }
      }
    }
  }
  return found.sort((left, right) => left.uri.localeCompare(right.uri) || left.text.localeCompare(right.text));
}

describe('reference index', () => {
  it('finds entity, alias, crud, and screen references without the definition', () => {
    const index = indexed();
    const text = [
      '<screen>',
      '  <entity-find entity-name="mantle.party.Party"/>',
      '  <entity-find entity-name="Party"/>',
      '  <entity-find entity-name="parties"/>',
      '  <service-call name="create#Party"/>',
      '  <service-call name="mantle.party.PartyServices.get#Party"/>',
      '  <seca service="missing.Service" name-is-pattern="true"/>',
      '  <include-screen location="component://mantle/screen/Find.xml"/>',
      '</screen>',
    ].join('\n');
    index.replaceFile('file:///edit.xml', editPath, text);

    const entityUses = referenceLocations(entityText, entityText.indexOf('entity-name="Party"') + 'entity-name="'.length, entityPath, index);
    assert.equal(entityUses?.filter((item) => item.uri === 'file:///edit.xml').length, 4);
    assert.equal(entityUses?.length, 6);

    const service = index.findServices('mantle.party.PartyServices.get#Party')[0];
    const serviceUses = referenceLocations(serviceText, serviceText.indexOf('verb="get"') + 'verb="'.length, servicePath, index);
    assert.equal(serviceUses?.length, 1);

    const screen = index.findScreensByLocation('component://mantle/screen/Find.xml')[0];
    const screenUses = referenceLocations('<screen></screen>', 1, findPath, index);
    assert.equal(screenUses?.length, 1);
    assert.equal(screen.kind, 'screen');

    index.replaceFile('file:///edit.xml', editPath, '<screen></screen>');
    assert.equal(referenceLocations(entityText, entityText.indexOf('entity-name="Party"') + 'entity-name="'.length, entityPath, index)?.length, 2);
  });

  it('finds a screen reference that was indexed before the screen file', () => {
    const index = new WorkspaceIndex();
    index.setWorkspaceRoots([workspace]);
    index.replaceFile('file:///mantle-component.xml', path.join(mantleRoot, 'component.xml'), '<component name="mantle"/>');
    const refText = '<screen><include-screen location="./Find.xml"/></screen>';
    index.replaceFile('file:///edit.xml', editPath, refText);
    const screenText = '<screen></screen>';
    index.replaceFile('file:///find.xml', findPath, screenText);
    const uses = referenceLocations(screenText, 1, findPath, index);
    assert.equal(uses?.length, 1);
    assert.equal(uses?.[0].uri, 'file:///edit.xml');
  });

  it('counts a short name toward every matching entity', () => {
    const index = indexed();
    const otherPath = path.join(mantleRoot, 'entity', 'Other.xml');
    const otherText = '<entities><entity entity-name="Party" package="other.party"/></entities>';
    index.replaceFile('file:///other.xml', otherPath, otherText);
    const text = '<screen><entity-find entity-name="Party"/></screen>';
    index.replaceFile('file:///edit.xml', editPath, text);
    const mantleUses = referenceLocations(entityText, entityText.indexOf('entity-name="Party"') + 'entity-name="'.length, entityPath, index);
    const otherUses = referenceLocations(otherText, otherText.indexOf('entity-name="Party"') + 'entity-name="'.length, otherPath, index);
    assert.ok(mantleUses?.some((item) => item.uri === 'file:///edit.xml'));
    assert.ok(otherUses?.some((item) => item.uri === 'file:///edit.xml'));
  });
});

describe('rename', () => {
  it('renames an entity short name in canonical, short, and crud references', () => {
    const index = indexed();
    const text = [
      '<screen>',
      '  <entity-find entity-name="mantle.party.Party"/>',
      '  <entity-find entity-name="Party"/>',
      '  <entity-find entity-name="parties"/>',
      '  <service-call name="create#mantle.party.Party"/>',
      '  <extend-entity entity-name="Party" package="mantle.party"/>',
      '</screen>',
    ].join('\n');
    index.replaceFile('file:///edit.xml', editPath, text);
    const offset = entityText.indexOf('entity-name="Party"') + 'entity-name="'.length;
    const prepared = prepareRenameAt(entityText, offset, entityPath, index, options);
    assert.ok(prepared && 'placeholder' in prepared);
    assert.equal(prepared && 'placeholder' in prepared ? prepared.placeholder : '', 'Party');

    const edit = renameAt(entityText, offset, entityPath, index, 'Party2', options);
    assert.ok(edit && !('message' in edit));
    const texts = changes(edit as WorkspaceEdit).map((item) => item.text).sort();
    assert.deepEqual(texts, [
      'Party2',
      'Party2',
      'Party2',
      'mantle.party.Party2',
      'mantle.party.Party2',
      'mantle.party.Party2',
      'mantle.party.Party2',
    ]);
  });

  it('renames a short-alias without changing the entity name', () => {
    const index = indexed();
    const text = '<screen><entity-find entity-name="parties"/></screen>';
    index.replaceFile('file:///edit.xml', editPath, text);
    const offset = entityText.indexOf('short-alias="parties"') + 'short-alias="'.length;
    const edit = renameAt(entityText, offset, entityPath, index, 'people', options);
    assert.ok(edit && !('message' in edit));
    assert.deepEqual(changes(edit as WorkspaceEdit).map((item) => item.text).sort(), ['people', 'people']);
  });

  it('rejects an ambiguous short name and a pattern service', () => {
    const index = indexed();
    index.replaceFile(
      'file:///other.xml',
      path.join(mantleRoot, 'entity', 'Other.xml'),
      '<entities><entity entity-name="Party" package="other.party"/></entities>',
    );
    const text = '<screen><entity-find entity-name="Party"/><seca service="x" name-is-pattern="true"/></screen>';
    index.replaceFile('file:///edit.xml', editPath, text);
    const ambiguous = prepareRenameAt(text, text.indexOf('Party'), editPath, index, options);
    assert.deepEqual(ambiguous, { message: 'ambiguous Party' });
    const pattern = prepareRenameAt(text, text.indexOf('service="x"') + 'service="'.length, editPath, index, options);
    assert.deepEqual(pattern, { message: 'pattern' });
  });

  it('renames a service verb and a screen file', () => {
    const index = indexed();
    const text = [
      '<screen>',
      '  <service-call name="mantle.party.PartyServices.get#Party"/>',
      '  <include-screen location="component://mantle/screen/Find.xml"/>',
      '  <include-screen location="./Find.xml#Find"/>',
      '</screen>',
    ].join('\n');
    index.replaceFile('file:///edit.xml', editPath, text);

    const verbAt = serviceText.indexOf('verb="get"') + 'verb="'.length;
    const serviceEdit = renameAt(serviceText, verbAt, servicePath, index, 'fetch', options);
    assert.ok(serviceEdit && !('message' in serviceEdit));
    assert.deepEqual(changes(serviceEdit as WorkspaceEdit).map((item) => item.text).sort(), [
      'fetch',
      'mantle.party.PartyServices.fetch#Party',
    ]);

    const screenAt = text.indexOf('component://mantle/screen/Find.xml');
    const blocked = renameAt(text, screenAt, editPath, index, 'Search.xml', { ...options, fileRename: false });
    assert.deepEqual(blocked, { message: 'no file rename' });
    const screenEdit = renameAt(text, screenAt, editPath, index, 'Search.xml', options);
    assert.ok(screenEdit && !('message' in screenEdit));
    const applied = screenEdit as WorkspaceEdit;
    assert.deepEqual(changes(applied).map((item) => item.text).sort(), [
      './Search.xml',
      'component://mantle/screen/Search.xml',
    ]);
    const renamed = (applied.documentChanges ?? []).find((change): change is RenameFile => RenameFile.is(change));
    assert.ok(renamed);
    assert.equal(renamed.oldUri, 'file:///find.xml');
    assert.ok(renamed.newUri.endsWith('Search.xml'));
    const invalid = renameAt(text, screenAt, editPath, index, 'Search', options);
    assert.deepEqual(invalid, { message: 'bad screen' });
  });
});

describe('folding and code lens', () => {
  it('folds nested forms in screen and screen-extend files', () => {
    const text = [
      '<screen>',
      '  <form-single name="Find">',
      '    <field name="partyId"/>',
      '  </form-single>',
      '  <form-list>',
      '    <field name="partyId"/>',
      '  </form-list>',
      '</screen>',
    ].join('\n');
    const ranges = foldingRanges(text, messages);
    assert.deepEqual(ranges.map((range) => range.collapsedText), ['Single Form: Find', 'List Form:']);
    assert.equal(ranges[0].startCharacter, undefined);
    assert.equal(foldingRanges('<entities></entities>', messages).length, 0);
    const extend = text.replace('<screen>', '<screen-extend>').replace('</screen>', '</screen-extend>');
    assert.equal(foldingRanges(extend, messages).length, 2);
    const templates = text.replace('<screen>', '<widget-templates>').replace('</screen>', '</widget-templates>');
    assert.equal(foldingRanges(templates, messages).length, 2);
    assert.equal(formFoldLenses(templates, 'file:///widgets.xml', messages).length, 2);
    const lenses = formFoldLenses(text, 'file:///find.xml', messages);
    assert.deepEqual(lenses.map((lens) => lens.command?.title), ['Single Form: Find', 'List Form:']);
    assert.equal(lenses[0].command?.command, 'moquiHelper.foldForm');
    assert.deepEqual(lenses[0].command?.arguments, ['file:///find.xml', 1]);
  });

  it('shows the reference count on a definition', () => {
    const index = indexed();
    index.replaceFile('file:///edit.xml', editPath, '<screen><entity-find entity-name="Party"/></screen>');
    const lenses = codeLensesFor(entityPath, index, messages);
    const party = lenses.find((lens) => lens.command?.title === '1 refs');
    assert.ok(party);
    assert.equal(party?.command?.command, 'moquiHelper.showReferences');
  });
});

describe('entity-facade-xml', () => {
  it('completes tags and fields, including extend-entity and alias-all', () => {
    const index = indexed();
    index.replaceFile('file:///party.xml', entityPath, extendedEntityText);
    const root = '<entity-facade-xml><P</entity-facade-xml>';
    const rootItems = completionAt(root, root.indexOf('<P') + 1, index);
    assert.ok(rootItems?.some((item) => item.label === 'mantle.party.Party'));
    assert.ok(rootItems?.some((item) => item.label === 'parties'));
    assert.ok(rootItems?.some((item) => item.label === 'delete-Party'));

    const nested = '<entity-facade-xml><mantle.party.Party><x</mantle.party.Party></entity-facade-xml>';
    const nestedItems = completionAt(nested, nested.indexOf('<x') + 1, index)?.map((item) => item.label) ?? [];
    assert.ok(nestedItems.includes('contacts'));
    assert.ok(nestedItems.includes('mantle.party.Contact'));
    assert.ok(nestedItems.includes('extra'));
    assert.ok(!nestedItems.includes('note'));

    const contact = '<entity-facade-xml><mantle.party.Contact><x</mantle.party.Contact></entity-facade-xml>';
    const contactItems = completionAt(contact, contact.indexOf('<x') + 1, index)?.map((item) => item.label) ?? [];
    assert.ok(contactItems.includes('note'));

    const attributes = '<entity-facade-xml><mantle.party.Party ></mantle.party.Party></entity-facade-xml>';
    const attributeItems = completionAt(attributes, attributes.indexOf('Party >') + 'Party '.length, index)?.map((item) => item.label) ?? [];
    assert.ok(attributeItems.includes('partyId'));
    assert.ok(attributeItems.includes('extra'));
    assert.ok(attributeItems.includes('lastUpdatedStamp'));

    const view = index.findEntities('mantle.party.PartyView')[0];
    assert.deepEqual(
      index.entityShape(view).fields.map((field) => field.name).sort(),
      ['partyId', 'ptyExtra', 'ptyPartyId'],
    );
  });

  it('resolves service tags and reports unknown tags', () => {
    const index = indexed();
    index.replaceFile('file:///party.xml', entityPath, extendedEntityText);
    const text = [
      '<entity-facade-xml>',
      '  <mantle.party.PartyServices.getParty partyId="1"/>',
      '  <MissingThing/>',
      '  <mantle.party.Party><contacts contactMechId="1"/></mantle.party.Party>',
      '</entity-facade-xml>',
    ].join('\n');
    index.replaceFile('file:///data.xml', dataPath, text);
    const diagnostics = collectDiagnostics(text, dataPath, index, messages).map((item) => item.message);
    assert.deepEqual(diagnostics, ['missing tag MissingThing']);

    const serviceAt = text.indexOf('mantle.party.PartyServices.getParty');
    const definitions = definitionAt(text, serviceAt, dataPath, index);
    assert.equal(definitions?.[0].uri, 'file:///services.xml');
    const serviceItems = completionAt(text, text.indexOf('partyId') , index)?.map((item) => item.label) ?? [];
    assert.ok(serviceItems.includes('partyId'));
    assert.ok(serviceItems.includes('statusId'));
    assert.ok(serviceItems.includes('extra'));
    assert.ok(!serviceItems.includes('lastUpdatedStamp'));
    assert.ok(!serviceItems.includes('resultCount'));

    const relationshipAt = text.indexOf('contacts');
    const relationship = definitionAt(text, relationshipAt, dataPath, index);
    assert.equal(relationship?.[0].uri, 'file:///party.xml');

    const uses = referenceLocations(extendedEntityText, extendedEntityText.indexOf('entity-name="Party"') + 'entity-name="'.length, entityPath, index);
    assert.ok(uses?.some((item) => item.uri === 'file:///data.xml'));
  });
});

const seedText = [
  '<entities>',
  '  <entity entity-name="Party" package="mantle.party" short-alias="parties">',
  '    <field name="partyId" type="id" is-pk="true"/>',
  '    <field name="statusId" type="id"/>',
  '    <relationship type="many" related="mantle.party.Contact" short-alias="contacts">',
  '      <key-map field-name="partyId"/>',
  '    </relationship>',
  '    <seed-data>',
  '      <mantle.party.Party partyId="1">',
  '        <contacts/>',
  '        <extra/>',
  '      </mantle.party.Party>',
  '      <parties/>',
  '      <delete-Party/>',
  '      <MissingThing/>',
  '      <${entityName}/>',
  '      <mantle.party.PartyServices.getParty partyId="1"/>',
  '    </seed-data>',
  '    <master name="default">',
  '      <detail relationship="contacts"/>',
  '    </master>',
  '  </entity>',
  '  <entity entity-name="Contact" package="mantle.party">',
  '    <field name="contactMechId" type="id" is-pk="true"/>',
  '    <field name="note" type="text-long"/>',
  '  </entity>',
  '  <extend-entity entity-name="Party" package="mantle.party">',
  '    <field name="extra" type="text-long"/>',
  '    <seed-data>',
  '      <mantle.party.Party>',
  '        <extra/>',
  '      </mantle.party.Party>',
  '    </seed-data>',
  '  </extend-entity>',
  '  <view-entity entity-name="PartyView" package="mantle.party">',
  '    <member-entity entity-alias="PTY" entity-name="mantle.party.Party"/>',
  '    <alias-all entity-alias="PTY" prefix="pty"><exclude field="statusId"/></alias-all>',
  '    <alias name="partyId" entity-alias="PTY" field="partyId"/>',
  '    <seed-data>',
  '      <NotData/>',
  '    </seed-data>',
  '  </view-entity>',
  '</entities>',
].join('\n');

function seedIndex(): WorkspaceIndex {
  const index = indexed();
  index.replaceFile('file:///party.xml', entityPath, seedText);
  return index;
}

function labelsAt(text: string, offset: number, index: WorkspaceIndex): string[] {
  return completionAt(text, offset, index)?.map((item) => String(item.label)) ?? [];
}

function rangeOf(text: string, start: number, end: number): Range {
  return new LineMap(text).range(start, end);
}

function sameRange(left: Range, right: Range): boolean {
  return (
    left.start.line === right.start.line &&
    left.start.character === right.start.character &&
    left.end.line === right.end.line &&
    left.end.character === right.end.character
  );
}

function hoverValue(hover: Hover | null): string {
  const contents = hover?.contents;
  return contents && typeof contents === 'object' && !Array.isArray(contents) && 'value' in contents ? contents.value : '';
}

describe('seed-data', () => {
  it('completes entity, relationship, text-long, and field names inside seed-data', () => {
    const index = seedIndex();
    const entitySeed = '<entities><entity entity-name="Party" package="mantle.party"><seed-data><P</seed-data></entity></entities>';
    const entityItems = labelsAt(entitySeed, entitySeed.indexOf('<P') + 1, index);
    assert.ok(entityItems.includes('mantle.party.Party'));
    assert.ok(entityItems.includes('parties'));
    assert.ok(entityItems.includes('delete-Party'));

    const extendSeed = '<entities><extend-entity entity-name="Party" package="mantle.party"><seed-data><P</seed-data></extend-entity></entities>';
    const extendItems = labelsAt(extendSeed, extendSeed.indexOf('<P') + 1, index);
    assert.ok(extendItems.includes('mantle.party.Party'));
    assert.ok(extendItems.includes('parties'));
    assert.ok(extendItems.includes('delete-Party'));

    const nested = '<entities><entity entity-name="Party" package="mantle.party"><seed-data><mantle.party.Party><x</mantle.party.Party></seed-data></entity></entities>';
    const nestedItems = labelsAt(nested, nested.indexOf('<x') + 1, index);
    assert.ok(nestedItems.includes('contacts'));
    assert.ok(nestedItems.includes('mantle.party.Contact'));
    assert.ok(nestedItems.includes('extra'));
    assert.ok(!nestedItems.includes('note'));

    const contact = '<entities><entity entity-name="Party" package="mantle.party"><seed-data><mantle.party.Contact><x</mantle.party.Contact></seed-data></entity></entities>';
    const contactItems = labelsAt(contact, contact.indexOf('<x') + 1, index);
    assert.ok(contactItems.includes('note'));

    const attributes = '<entities><entity entity-name="Party" package="mantle.party"><seed-data><mantle.party.Party ></mantle.party.Party></seed-data></entity></entities>';
    const attributeItems = labelsAt(attributes, attributes.indexOf('Party >') + 'Party '.length, index);
    assert.ok(attributeItems.includes('partyId'));
    assert.ok(attributeItems.includes('extra'));
    assert.ok(attributeItems.includes('lastUpdatedStamp'));

    const serviceItems = labelsAt(seedText, seedText.indexOf('getParty ') + 'getParty '.length, index);
    assert.ok(serviceItems.includes('partyId'));
    assert.ok(serviceItems.includes('statusId'));
    assert.ok(serviceItems.includes('extra'));
    assert.ok(!serviceItems.includes('lastUpdatedStamp'));
    assert.ok(!serviceItems.includes('resultCount'));
  });

  it('hovers and jumps to the entity, relationship, field, and service', () => {
    const index = seedIndex();
    const partyAt = seedText.indexOf('<mantle.party.Party partyId') + 1;
    assert.ok(hoverValue(hoverAt(seedText, partyAt, entityPath, index, messages)).includes('entity mantle.party.Party'));
    const partyDefs = definitionAt(seedText, partyAt, entityPath, index);
    const entityOpen = seedText.indexOf('<entity entity-name="Party"');
    assert.deepEqual(partyDefs?.[0], {
      uri: 'file:///party.xml',
      range: rangeOf(seedText, entityOpen, seedText.indexOf('>', entityOpen) + 1),
    });

    const contactsAt = seedText.indexOf('<contacts/>') + 1;
    assert.equal(
      hoverValue(hoverAt(seedText, contactsAt, entityPath, index, messages)),
      'relationship contacts\nmany mantle.party.Contact partyId',
    );
    const aliasStart = seedText.indexOf('short-alias="contacts"') + 'short-alias="'.length;
    assert.deepEqual(definitionAt(seedText, contactsAt, entityPath, index), [
      { uri: 'file:///party.xml', range: rangeOf(seedText, aliasStart, aliasStart + 'contacts'.length) },
    ]);

    const extraAt = seedText.indexOf('<extra/>') + 1;
    assert.equal(hoverValue(hoverAt(seedText, extraAt, entityPath, index, messages)), 'field extra: text-long');
    const extraStart = seedText.indexOf('name="extra"') + 'name="'.length;
    assert.deepEqual(definitionAt(seedText, extraAt, entityPath, index), [
      { uri: 'file:///party.xml', range: rangeOf(seedText, extraStart, extraStart + 'extra'.length) },
    ]);

    const serviceAt = seedText.indexOf('mantle.party.PartyServices.getParty');
    assert.equal(definitionAt(seedText, serviceAt, entityPath, index)?.[0].uri, 'file:///services.xml');
  });

  it('reports unknown seed-data tags and leaves definition tags alone', () => {
    const index = seedIndex();
    const diagnostics = collectDiagnostics(seedText, entityPath, index, messages).map((item) => item.message);
    assert.deepEqual(diagnostics, ['missing tag MissingThing']);

    const fieldItems = completionAt(seedText, seedText.indexOf('<field ') + 1, index);
    assert.equal(fieldItems?.some((item) => item.label === 'mantle.party.Party') ?? false, false);
    const seedItems = completionAt(seedText, seedText.indexOf('<seed-data>') + 1, index);
    assert.equal(seedItems?.some((item) => item.label === 'mantle.party.Party') ?? false, false);

    const uses = referenceLocations(seedText, seedText.indexOf('entity-name="Party"') + 'entity-name="'.length, entityPath, index);
    const seedName = 'mantle.party.Party';
    const seedAt = seedText.indexOf(`<${seedName} partyId`);
    const nameRange = rangeOf(seedText, seedAt + 1, seedAt + 1 + seedName.length);
    assert.ok(uses?.some((item) => item.uri === 'file:///party.xml' && sameRange(item.range, nameRange)));
  });
});

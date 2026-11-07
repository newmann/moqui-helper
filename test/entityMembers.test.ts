import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'node:test';
import { CompletionItem, Hover, TextDocumentEdit, TextEdit, WorkspaceEdit } from 'vscode-languageserver';
import { fsPathToUri } from '../src/server/paths';
import { WorkspaceIndex } from '../src/server/index/workspace';
import { Messages } from '../src/server/messages';
import { completionAt } from '../src/server/providers/completion';
import { definitionAt } from '../src/server/providers/definition';
import { collectDiagnostics } from '../src/server/providers/diagnostics';
import { hoverAt } from '../src/server/providers/hover';
import { referenceLocations, renameAt } from '../src/server/refs/rename';
import { Range } from '../src/server/types';
import { LineMap } from '../src/server/xml/scan';

const messages: Messages = {
  unresolvedEntity: 'missing entity {0}',
  unresolvedField: 'missing field {0}',
  unresolvedRelationship: 'missing relationship {0}',
  unresolvedEntityAlias: 'missing alias {0}',
  hoverEntity: 'entity {0}',
  hoverViewEntity: 'view {0}',
  hoverField: 'field {0}',
  hoverRelationship: 'relationship {0}',
  hoverPk: 'pk',
  renameAmbiguous: 'ambiguous {0}',
  renameInvalidName: 'bad name',
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moqui-entity-members-'));
const componentRoot = path.join(root, 'runtime', 'component', 'mantle');
const entityPath = path.join(componentRoot, 'entity', 'Party.xml');
const screenPath = path.join(componentRoot, 'screen', 'Find.xml');
const servicePath = path.join(componentRoot, 'service', 'PartyServices.xml');
const entityUri = fsPathToUri(entityPath);
const screenUri = fsPathToUri(screenPath);

const entityText = [
  '<entities>',
  '  <entity entity-name="Party" package="mantle.party">',
  '    <field name="partyId" type="id" is-pk="true"/>',
  '    <field name="statusId" type="id"/>',
  '    <relationship type="one" title="primary" related="mantle.party.Contact" short-alias="contact">',
  '      <key-map field-name="partyId" related="contactMechId"/>',
  '    </relationship>',
  '    <master>',
  '      <detail relationship="contact">',
  '        <detail relationship="missingRel"/>',
  '      </detail>',
  '      <detail relationship="moreContacts"/>',
  '      <detail relationship="primary#mantle.party.Contact"/>',
  '      <detail relationship="noParent">',
  '        <detail relationship="alsoMissing"/>',
  '      </detail>',
  '    </master>',
  '  </entity>',
  '  <entity entity-name="Contact" package="mantle.party">',
  '    <field name="contactMechId" type="id" is-pk="true"/>',
  '    <field name="note" type="text-long"/>',
  '  </entity>',
  '  <extend-entity entity-name="Party" package="mantle.party">',
  '    <field name="extra" type="text-long"/>',
  '    <relationship type="many" related="mantle.party.Contact" short-alias="moreContacts"/>',
  '  </extend-entity>',
  '  <view-entity entity-name="PartyView" package="mantle.party">',
  '    <member-entity entity-alias="PTY" entity-name="mantle.party.Party"/>',
  '    <member-relationship entity-alias="CON" join-from-alias="PTY" relationship="contact">',
  '      <entity-condition>',
  '        <econdition field-name="note" to-entity-alias="PTY" to-field-name="partyId"/>',
  '      </entity-condition>',
  '    </member-relationship>',
  '    <member-relationship entity-alias="BAD" join-from-alias="NOPE" relationship="contact"/>',
  '    <alias-all entity-alias="PTY" prefix="pty"><exclude field="statusId"/></alias-all>',
  '    <alias name="keptName" entity-alias="PTY" field="partyId"/>',
  '    <alias name="customLabel"/>',
  '    <alias name=""/>',
    '    <alias name="not" entity-alias="OLD"/>',
  '    <alias entity-alias="PTY" field="noSuch"/>',
  '    <entity-condition>',
  '      <econdition field-name="ptyPartyId"/>',
  '      <econdition field-name="partyId" entity-alias="PTY"/>',
  '      <econdition field-name="nope" entity-alias="GONE"/>',
  '    </entity-condition>',
  '    <order-by field-name="+ptyExtra,-^keptName"/>',
  '  </view-entity>',
  '</entities>',
].join('\n');

const screenText = [
  '<screen>',
  '  <entity-find entity-name="mantle.party.Party">',
  '    <econdition field-name="partyId"/>',
  '    <econdition field-name="${partyId}"/>',
  '    <econdition field-name="lastUpdatedStamp"/>',
  '    <select-field field-name="partyId,nopeField"/>',
  '    <order-by field-name="+partyId,-^statusId"/>',
  '    <having-econditions><econdition field-name="extra"/></having-econditions>',
  '    <search-form-inputs default-order-by="-extra" skip-fields="partyId,missingSkip"/>',
  '  </entity-find>',
  '  <entity-find-one entity-name="Party">',
  '    <field-map field-name="statusId"/>',
  '  </entity-find-one>',
  '  <entity-find entity-name="PartyView">',
  '    <select-field field-name="keptName,ptyPartyId"/>',
  '  </entity-find>',
  '  <entity-find entity-name="${dynamic}">',
  '    <econdition field-name="nope"/>',
  '  </entity-find>',
  '  <entity-find entity-name="Missing">',
  '    <econdition field-name="nope"/>',
  '  </entity-find>',
  '  <service-call name="get#Party"><field-map field-name="notAField"/></service-call>',
  '  <filter-map-list><field-map field-name="notAField"/></filter-map-list>',
  '  <order-map-list><order-by field-name="notAField"/></order-map-list>',
  '  <form-single name="Edit">',
  '    <auto-fields-entity entity-name="Party">',
  '      <exclude field-name="statusId"/>',
  '      <exclude field-name="missingForm"/>',
  '    </auto-fields-entity>',
  '    <auto-fields-service service-name="get#Party"><exclude parameter-name="notAField"/></auto-fields-service>',
  '  </form-single>',
  '</screen>',
].join('\n');

const serviceText = [
  '<services>',
  '  <service verb="get" noun="Party">',
  '    <auto-parameters>',
  '      <exclude field-name="extra"/>',
  '      <exclude field-name="missingAuto"/>',
  '    </auto-parameters>',
  '  </service>',
  '</services>',
].join('\n');

function indexed(): WorkspaceIndex {
  const index = new WorkspaceIndex();
  index.setWorkspaceRoots([root]);
  index.replaceFile(fsPathToUri(path.join(componentRoot, 'component.xml')), path.join(componentRoot, 'component.xml'), '<component name="mantle"/>');
  index.replaceFile(entityUri, entityPath, entityText);
  index.replaceFile(screenUri, screenPath, screenText);
  index.replaceFile(fsPathToUri(servicePath), servicePath, serviceText);
  return index;
}

function at(text: string, token: string, from = 0): number {
  const offset = text.indexOf(token, from);
  assert.ok(offset >= 0, token);
  return offset;
}

function rangeOf(text: string, token: string, from = 0): Range {
  const offset = at(text, token, from);
  return new LineMap(text).range(offset, offset + token.length);
}

function same(left: Range, right: Range): boolean {
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

function labelsAt(text: string, token: string, index: WorkspaceIndex, from = 0): string[] {
  const offset = at(text, token, from) + token.length;
  return completionAt(text, offset, index)?.map((item) => String(item.label)) ?? [];
}

function itemAt(text: string, token: string, index: WorkspaceIndex, label: string, from = 0): CompletionItem {
  const offset = at(text, token, from) + token.length;
  const item = completionAt(text, offset, index)?.find((candidate) => candidate.label === label);
  assert.ok(item, label);
  return item;
}

function replaceText(item: CompletionItem): string {
  const edit = item.textEdit;
  assert.ok(edit && TextEdit.is(edit));
  return edit.newText;
}

function replaceRange(item: CompletionItem): Range {
  const edit = item.textEdit;
  assert.ok(edit && TextEdit.is(edit));
  return edit.range;
}

function located(locations: { uri: string; range: Range }[] | null, uri: string, text: string, token: string, from = 0): boolean {
  const range = rangeOf(text, token, from);
  return (locations ?? []).some((item) => item.uri === uri && same(item.range, range));
}

function edits(result: WorkspaceEdit): { uri: string; range: Range; text: string }[] {
  const changes = (result.documentChanges ?? []).filter((change): change is TextDocumentEdit => TextDocumentEdit.is(change));
  return changes.flatMap((change) =>
    change.edits.flatMap((edit) => (TextEdit.is(edit) ? [{ uri: change.textDocument.uri, range: edit.range, text: edit.newText }] : [])),
  );
}

const options = { messages, fileRename: true, documentChanges: true };

describe('entity members', () => {
  it('completes and defines fields in entity operations, including sort prefixes and commas', () => {
    const index = indexed();
    assert.deepEqual(labelsAt(screenText, 'field-name="partyId,', index).sort(), ['extra', 'partyId', 'statusId']);
    const partyItem = itemAt(screenText, 'field-name="+', index, 'partyId');
    assert.equal(replaceText(partyItem), 'partyId');
    const plus = at(screenText, 'field-name="+partyId,-^statusId"') + 'field-name="'.length;
    assert.ok(replaceRange(partyItem).start.character > new LineMap(screenText).positionAt(plus).character);

    const partyDef = definitionAt(screenText, at(screenText, 'field-name="partyId"') + 'field-name="'.length, screenPath, index);
    assert.deepEqual(partyDef, [{ uri: entityUri, range: rangeOf(entityText, 'partyId') }]);
    const sorted = at(screenText, 'field-name="+partyId,-^statusId"');
    const statusDef = definitionAt(screenText, sorted + 'field-name="+partyId,-^'.length, screenPath, index);
    assert.deepEqual(statusDef, [{ uri: entityUri, range: rangeOf(entityText, 'statusId') }]);
    const extraDef = definitionAt(screenText, at(screenText, 'field-name="extra"') + 'field-name="'.length, screenPath, index);
    assert.deepEqual(extraDef, [{ uri: entityUri, range: rangeOf(entityText, 'extra', at(entityText, 'name="extra"')) }]);

    const hover = hoverValue(hoverAt(screenText, at(screenText, 'field-name="partyId"') + 'field-name="'.length, screenPath, index, messages));
    assert.equal(hover, 'field partyId: id pk');
  });

  it('ignores expressions, lastUpdatedStamp, service-call, and filter-map-list', () => {
    const index = indexed();
    const diagnostics = collectDiagnostics(screenText, screenPath, index, messages)
      .map((item) => item.message)
      .filter((message) => message.startsWith('missing '))
      .sort();
    assert.deepEqual(diagnostics, ['missing entity Missing', 'missing field missingForm', 'missing field missingSkip', 'missing field nopeField']);
    const serviceDiagnostics = collectDiagnostics(serviceText, servicePath, index, messages).map((item) => item.message);
    assert.deepEqual(serviceDiagnostics, ['missing field missingAuto']);
    const entityDiagnostics = collectDiagnostics(entityText, entityPath, index, messages).map((item) => item.message).sort();
    assert.deepEqual(entityDiagnostics, [
      'missing alias GONE',
      'missing alias NOPE',
      'missing alias OLD',
      'missing field noSuch',
      'missing relationship missingRel',
      'missing relationship noParent',
    ]);
  });

  it('completes and defines view aliases, member fields, conditions, and relationships', () => {
    const index = indexed();
    assert.deepEqual(labelsAt(entityText, 'relationship="', index).sort(), ['contact', 'moreContacts']);
    const contactAt = at(entityText, 'relationship="contact"') + 'relationship="'.length;
    assert.deepEqual(definitionAt(entityText, contactAt, entityPath, index), [
      { uri: entityUri, range: rangeOf(entityText, 'contact', at(entityText, 'short-alias="contact"')) },
    ]);
    const titled = at(entityText, 'relationship="primary#mantle.party.Contact"');
    assert.deepEqual(definitionAt(entityText, titled + 'relationship="'.length, entityPath, index), [
      { uri: entityUri, range: rangeOf(entityText, 'primary', at(entityText, 'title="primary"')) },
    ]);
    assert.deepEqual(definitionAt(entityText, titled + 'relationship="primary#'.length, entityPath, index), [
      { uri: entityUri, range: rangeOf(entityText, 'mantle.party.Contact', at(entityText, 'related="mantle.party.Contact"')) },
    ]);
    const moreAt = at(entityText, 'relationship="moreContacts"') + 'relationship="'.length;
    assert.deepEqual(definitionAt(entityText, moreAt, entityPath, index), [
      { uri: entityUri, range: rangeOf(entityText, 'moreContacts', at(entityText, 'short-alias="moreContacts"')) },
    ]);

    const joinAt = at(entityText, 'join-from-alias="PTY"') + 'join-from-alias="'.length;
    assert.deepEqual(definitionAt(entityText, joinAt, entityPath, index), [
      { uri: entityUri, range: rangeOf(entityText, 'PTY', at(entityText, 'entity-alias="PTY"')) },
    ]);
    assert.equal(
      hoverValue(hoverAt(entityText, joinAt, entityPath, index, messages)),
      'entity mantle.party.Party',
    );
    const noteAt = at(entityText, 'field-name="note"') + 'field-name="'.length;
    assert.deepEqual(definitionAt(entityText, noteAt, entityPath, index), [
      { uri: entityUri, range: rangeOf(entityText, 'note', at(entityText, 'name="note"')) },
    ]);
    const viewField = at(entityText, 'field-name="ptyPartyId"') + 'field-name="'.length;
    assert.deepEqual(definitionAt(entityText, viewField, entityPath, index), [
      { uri: entityUri, range: rangeOf(entityText, 'partyId', at(entityText, 'name="partyId"')) },
    ]);
    const aliasName = at(entityText, 'name="keptName"') + 'name="'.length;
    const keptUse = at(screenText, 'keptName,ptyPartyId');
    assert.deepEqual(definitionAt(screenText, keptUse, screenPath, index), [{ uri: entityUri, range: rangeOf(entityText, 'keptName') }]);
    assert.deepEqual(definitionAt(entityText, aliasName, entityPath, index), null);

    const openAlias = at(entityText, '<alias name=""/>') + '<alias name="'.length;
    const openItems = completionAt(entityText, openAlias, index) ?? [];
    assert.equal(openItems.some((item) => item.label === 'keptName'), false);
    const party = openItems.find((item) => item.label === 'partyId');
    assert.equal(party?.detail, 'PTY');
    const status = openItems.find((item) => item.label === 'statusId');
    const note = openItems.find((item) => item.label === 'note');
    assert.equal(status?.detail, 'PTY');
    assert.equal(note?.detail, 'CON');
    assert.equal(status?.additionalTextEdits?.[0] && TextEdit.is(status.additionalTextEdits[0]) ? status.additionalTextEdits[0].newText : '', ' entity-alias="PTY"');
    const preset = itemAt(entityText, '<alias name="not', index, 'note');
    const presetEdit = preset.additionalTextEdits?.[0];
    assert.ok(presetEdit && TextEdit.is(presetEdit));
    assert.equal(presetEdit.newText, 'CON');
    assert.deepEqual(presetEdit.range, rangeOf(entityText, 'OLD'));
    assert.equal(collectDiagnostics(entityText, entityPath, index, messages).some((item) => item.message.includes('customLabel')), false);
  });

  it('finds references and renames fields, aliases, and short-aliases', () => {
    const index = indexed();
    const partyUse = at(screenText, 'field-name="partyId"') + 'field-name="'.length;
    const uses = referenceLocations(screenText, partyUse, screenPath, index);
    assert.equal(located(uses, screenUri, screenText, 'ptyPartyId'), true);
    assert.equal(located(uses, entityUri, entityText, 'partyId', at(entityText, 'field="partyId"')), true);
    assert.equal(located(uses, entityUri, entityText, 'keptName'), false);

    const renamed = renameAt(screenText, partyUse, screenPath, index, 'personId', options);
    assert.ok(renamed && !('message' in renamed));
    const changes = edits(renamed);
    assert.equal(changes.some((change) => change.text === 'personId' && same(change.range, rangeOf(entityText, 'partyId', at(entityText, 'name="partyId"')))), true);
    assert.equal(changes.some((change) => change.text === 'ptyPersonId' && same(change.range, rangeOf(screenText, 'ptyPartyId'))), true);
    assert.equal(changes.some((change) => same(change.range, rangeOf(entityText, 'keptName'))), false);
    assert.equal(changes.some((change) => change.text === 'personId' && same(change.range, rangeOf(entityText, 'partyId', at(entityText, 'field="partyId"')))), true);

    const keptAt = at(entityText, 'name="keptName"') + 'name="'.length;
    const keptRename = renameAt(entityText, keptAt, entityPath, index, 'labelId', options);
    assert.ok(keptRename && !('message' in keptRename));
    const keptChanges = edits(keptRename);
    assert.equal(keptChanges.some((change) => change.text === 'labelId' && same(change.range, rangeOf(screenText, 'keptName'))), true);
    assert.equal(keptChanges.some((change) => same(change.range, rangeOf(entityText, 'partyId', at(entityText, 'name="partyId"')))), false);

    const aliasAt = at(entityText, 'join-from-alias="PTY"') + 'join-from-alias="'.length;
    const aliasUses = referenceLocations(entityText, aliasAt, entityPath, index);
    assert.equal(located(aliasUses, entityUri, entityText, 'PTY', at(entityText, 'entity-alias="PTY" prefix')), true);
    const aliasRename = renameAt(entityText, aliasAt, entityPath, index, 'MEM', options);
    assert.ok(aliasRename && !('message' in aliasRename));
    const aliasChanges = edits(aliasRename);
    assert.equal(aliasChanges.some((change) => change.text === 'MEM' && same(change.range, rangeOf(entityText, 'PTY', at(entityText, 'entity-alias="PTY"')))), true);
    assert.equal(aliasChanges.some((change) => same(change.range, rangeOf(entityText, 'keptName'))), false);

    const shortAt = at(entityText, 'relationship="contact"') + 'relationship="'.length;
    const shortUses = referenceLocations(entityText, shortAt, entityPath, index);
    assert.equal(located(shortUses, entityUri, entityText, 'primary#mantle.party.Contact'), true);
    const shortRename = renameAt(entityText, shortAt, entityPath, index, 'people', options);
    assert.ok(shortRename && !('message' in shortRename));
    const shortChanges = edits(shortRename);
    assert.equal(shortChanges.some((change) => change.text === 'people' && same(change.range, rangeOf(entityText, 'contact', at(entityText, 'short-alias="contact"')))), true);
    assert.equal(shortChanges.some((change) => change.text === 'people' && same(change.range, rangeOf(entityText, 'contact', at(entityText, 'relationship="contact"')))), true);
    assert.equal(shortChanges.some((change) => same(change.range, rangeOf(entityText, 'primary#mantle.party.Contact'))), false);
    const titled = at(entityText, 'relationship="primary#mantle.party.Contact"') + 'relationship="'.length;
    assert.equal(renameAt(entityText, titled, entityPath, index, 'other', options), null);
  });
});

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'node:test';
import { DiagnosticSeverity, Hover, TextDocumentEdit, WorkspaceEdit } from 'vscode-languageserver';
import { fsPathToUri } from '../src/server/paths';
import { WorkspaceIndex } from '../src/server/index/workspace';
import { Messages } from '../src/server/messages';
import { codeLensesFor } from '../src/server/providers/codeLens';
import { completionAt } from '../src/server/providers/completion';
import { definitionAt } from '../src/server/providers/definition';
import { collectDiagnostics } from '../src/server/providers/diagnostics';
import { hoverAt } from '../src/server/providers/hover';
import { referenceLocations, renameAt } from '../src/server/refs/rename';
import { LineMap } from '../src/server/xml/scan';

const messages: Messages = {
  unresolvedEntity: 'missing entity {0}',
  unresolvedScreen: 'missing screen {0}',
  unresolvedTransition: 'missing transition {0}',
  dynamicUrl: 'dynamic url {0}',
  unresolvedSection: 'missing section {0}',
  unresolvedForm: 'missing form {0}',
  unresolvedSubscreensItem: 'missing subscreens-item {0}',
  unresolvedField: 'missing field {0}',
  hoverScreen: 'screen {0}',
  hoverTransition: 'transition {0}',
  hoverTransitionInclude: 'transition {0} from {1}',
  hoverSection: 'section {0}',
  hoverFormSingle: 'single {0}',
  hoverFormList: 'list {0}',
  hoverSubscreensItem: 'subscreens {0}',
  hoverFormField: 'form field {0}',
  referenceCount: '{0} refs',
  renameAmbiguous: 'ambiguous {0}',
  renameInvalidName: 'bad name',
  renameInvalidScreenName: 'bad screen',
  renameScreenUnsupported: 'no file rename',
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moqui-screen-members-'));
const appRoot = path.join(root, 'runtime', 'component', 'app');
const partyDir = path.join(appRoot, 'screen', 'Party');
const findPath = path.join(partyDir, 'Find.xml');
const detailPath = path.join(partyDir, 'Detail.xml');
const otherPath = path.join(partyDir, 'Other.xml');
const extendPath = path.join(root, 'runtime', 'component', 'extra', 'screen', 'Party', 'Find.xml');
const widgetPath = path.join(appRoot, 'template', 'PartyWidgets.xml');

const findText = [
  '<screen>',
  '  <transition name="save"/>',
  '  <transition-include name="load" location="component://app/screen/Party/Detail.xml"/>',
  '  <transition-include name="missingLoad" location="component://app/screen/Party/Detail.xml"/>',
  '  <subscreens-item name="Other" location="component://app/screen/Party/Other.xml"/>',
  '  <subscreens-item name="OnlyItem" location="component://app/screen/Party/Detail.xml"/>',
  '  <subscreens default-item="Other"/>',
  '  <subscreens default-item="Nope"/>',
  '  <subscreens default-item="./Detail.xml"/>',
  '  <subscreens default-item="./Missing.xml"/>',
  '  <section name="Options"/>',
  '  <section-iterate name="Rows" list="rows"/>',
  '  <section-include name="Rows" location="component://app/screen/Party/Find.xml#Rows"/>',
  '  <section-include name="DetailSection" location="component://app/screen/Party/Detail.xml#DetailSection"/>',
  '  <section-include name="Absent" location="component://app/screen/Party/Detail.xml#Gone"/>',
  '  <include-screen location="./Detail.xml#Gone"/>',
  '  <service-call name="create#missing.Entity"/>',
  '  <form-single name="Base" transition="save">',
  '    <field name="partyId"/>',
  '  </form-single>',
  '  <form-single name="Edit" extends="Base" focus-field="partyId" transition="Detail">',
  '    <field name="extra"/>',
  '    <field-layout><field-row><field-ref name="partyId"/></field-row></field-layout>',
  '  </form-single>',
  '  <form-single name="Remote" extends="component://app/screen/Party/Detail.xml#DetailForm"/>',
  '  <form-single name="UsesExtend" transition="extraSave"/>',
  '  <form-single name="CycleA" extends="CycleB"><field name="fromA"/></form-single>',
  '  <form-single name="CycleB" extends="CycleA"><field name="fromB"/><field-ref name="fromA"/></form-single>',
  '  <form-list name="List" extends="MissingList" focus-field="notAField"/>',
  '  <dynamic-container transition="save"/>',
  '  <dynamic-dialog transition="${skip}"/>',
  '  <dynamic-dialog transition="RequestCommentUpdate"/>',
  '  <dynamic-options transition="OnlyItem"/>',
  '  <form-single name="Broken" transition="nope" focus-field="nope">',
  '    <field name="keep"/>',
  '    <field-ref name="missingField"/>',
  '  </form-single>',
  '  <form-single name="Folder" transition="FolderOnly"/>',
  '</screen>',
].join('\n');

const detailText = [
  '<screen>',
  '  <transition name="load"/>',
  '  <section name="DetailSection"/>',
  '  <form-single name="DetailForm"><field name="detailId"/></form-single>',
  '</screen>',
].join('\n');

function indexed(): WorkspaceIndex {
  fs.mkdirSync(path.join(partyDir, 'FolderOnly'), { recursive: true });
  const index = new WorkspaceIndex();
  index.setWorkspaceRoots([root]);
  index.replaceFile(fsPathToUri(path.join(appRoot, 'component.xml')), path.join(appRoot, 'component.xml'), '<component name="app"/>');
  index.replaceFile(fsPathToUri(detailPath), detailPath, detailText);
  index.replaceFile(fsPathToUri(otherPath), otherPath, '<screen></screen>');
  index.replaceFile(fsPathToUri(extendPath), extendPath, '<screen-extend><transition name="extraSave"/></screen-extend>');
  index.replaceFile(
    fsPathToUri(widgetPath),
    widgetPath,
    '<widget-templates><form-single name="WidgetForm"><field name="widgetField"/></form-single><form-single name="WidgetEdit" extends="WidgetForm" focus-field="widgetField"/></widget-templates>',
  );
  index.replaceFile(fsPathToUri(findPath), findPath, findText);
  index.replaceFile(
    fsPathToUri(path.join(partyDir, 'Find', 'RequestCommentUpdate.xml')),
    path.join(partyDir, 'Find', 'RequestCommentUpdate.xml'),
    '<screen></screen>',
  );
  return index;
}

function at(text: string, token: string, from = 0): number {
  const offset = text.indexOf(token, from);
  assert.ok(offset >= 0, token);
  return offset;
}

function rangeOf(text: string, token: string, from = 0) {
  const offset = at(text, token, from);
  return new LineMap(text).range(offset, offset + token.length);
}

function hoverValue(hover: Hover | null): string {
  const contents = hover?.contents;
  return contents && typeof contents === 'object' && !Array.isArray(contents) && 'value' in contents ? contents.value : '';
}

function labelsAt(text: string, token: string, index: WorkspaceIndex, fsPath: string): string[] {
  const offset = at(text, token) + token.length;
  return completionAt(text, offset, index, fsPath)?.map((item) => item.label) ?? [];
}

function edits(result: WorkspaceEdit): { uri: string; text: string }[] {
  const changes = (result.documentChanges ?? []).filter((change): change is TextDocumentEdit => TextDocumentEdit.is(change));
  return changes.flatMap((change) => change.edits.map((edit) => ({ uri: change.textDocument.uri, text: edit.newText })));
}

describe('screen members', () => {
  it('completes, defines, and hovers screen-internal names', () => {
    const index = indexed();
    assert.ok(labelsAt('<screen><form-single transition="sa"/></screen>', 'sa', index, findPath).includes('save'));
    assert.ok(labelsAt('<screen><form-single transition="Det"/></screen>', 'Det', index, findPath).includes('Detail'));
    assert.ok(labelsAt('<screen><form-single transition="Onl"/></screen>', 'Onl', index, findPath).includes('OnlyItem'));
    assert.ok(labelsAt('<screen><form-single transition="ext"/></screen>', 'ext', index, findPath).includes('extraSave'));
    assert.ok(
      labelsAt('<screen><dynamic-dialog transition="Req"/></screen>', 'Req', index, findPath).includes('RequestCommentUpdate'),
    );
    assert.deepEqual(
      labelsAt('<screen><transition-include name="lo" location="component://app/screen/Party/Detail.xml"/></screen>', 'lo', index, findPath),
      ['load'],
    );
    assert.ok(
      labelsAt('<screen><section-include name="Det" location="component://app/screen/Party/Detail.xml"/></screen>', 'Det', index, findPath).includes(
        'DetailSection',
      ),
    );
    assert.ok(labelsAt('<screen><form-single extends="Ba"/></screen>', 'Ba', index, findPath).includes('Base'));
    const remoteExtends = '<screen><form-single extends="component://app/screen/Party/Detail.xml#Det"/></screen>';
    assert.deepEqual(
      completionAt(remoteExtends, at(remoteExtends, '#Det') + '#Det'.length, index, findPath)?.map((item) => item.label),
      ['DetailForm'],
    );
    assert.ok(labelsAt('<screen><subscreens default-item="Ot"/></screen>', 'Ot', index, findPath).includes('Other'));
    assert.ok(labelsAt(findText, 'field-ref name="par', index, findPath).includes('partyId'));
    const widgetText = '<widget-templates><form-single extends="Wid"/></widget-templates>';
    assert.ok(labelsAt(widgetText, 'Wid', index, widgetPath).includes('WidgetForm'));

    const saveAt = at(findText, 'transition="save"') + 'transition="'.length;
    assert.deepEqual(definitionAt(findText, saveAt, findPath, index), [{ uri: fsPathToUri(findPath), range: rangeOf(findText, 'save') }]);
    assert.equal(hoverValue(hoverAt(findText, saveAt, findPath, index, messages)), 'transition save');

    const detailTransition = at(findText, 'transition="Detail"') + 'transition="'.length;
    assert.equal(definitionAt(findText, detailTransition, findPath, index)?.[0].uri, fsPathToUri(detailPath));

    const onlyItem = at(findText, 'transition="OnlyItem"') + 'transition="'.length;
    assert.equal(definitionAt(findText, onlyItem, findPath, index)?.[0].uri, fsPathToUri(detailPath));

    const includeAt = at(findText, 'name="load"') + 'name="'.length;
    assert.equal(definitionAt(findText, includeAt, findPath, index)?.[0].uri, fsPathToUri(detailPath));
    assert.equal(
      hoverValue(hoverAt(findText, includeAt, findPath, index, messages)),
      'transition load from component://app/screen/Party/Detail.xml',
    );

    const sectionAt = at(findText, 'name="Options"') + 'name="'.length;
    assert.equal(hoverValue(hoverAt(findText, sectionAt, findPath, index, messages)), 'section Options');
    const sectionRef = at(findText, 'name="DetailSection"') + 'name="'.length;
    assert.equal(hoverValue(hoverAt(findText, sectionRef, findPath, index, messages)), 'section DetailSection');
    assert.equal(definitionAt(findText, sectionRef, findPath, index)?.[0].uri, fsPathToUri(detailPath));

    const formRef = at(findText, 'extends="Base"') + 'extends="'.length;
    assert.deepEqual(definitionAt(findText, formRef, findPath, index), [{ uri: fsPathToUri(findPath), range: rangeOf(findText, 'Base') }]);
    assert.equal(hoverValue(hoverAt(findText, formRef, findPath, index, messages)), 'single Base');

    const remoteForm = at(findText, '#DetailForm') + 1;
    assert.equal(definitionAt(findText, remoteForm, findPath, index)?.[0].uri, fsPathToUri(detailPath));

    const itemRef = at(findText, 'default-item="Other"') + 'default-item="'.length;
    assert.deepEqual(definitionAt(findText, itemRef, findPath, index), [
      { uri: fsPathToUri(findPath), range: rangeOf(findText, 'Other') },
    ]);
    assert.equal(hoverValue(hoverAt(findText, itemRef, findPath, index, messages)), 'subscreens Other');

    const relativeItem = at(findText, 'default-item="./Detail.xml"') + 'default-item="'.length;
    assert.equal(definitionAt(findText, relativeItem, findPath, index)?.[0].uri, fsPathToUri(detailPath));

    const fieldRef = at(findText, 'field-ref name="partyId"') + 'field-ref name="'.length;
    assert.deepEqual(definitionAt(findText, fieldRef, findPath, index), [
      { uri: fsPathToUri(findPath), range: rangeOf(findText, 'partyId') },
    ]);
    const focus = at(findText, 'focus-field="partyId"') + 'focus-field="'.length;
    assert.equal(hoverValue(hoverAt(findText, focus, findPath, index, messages)), 'form field partyId');
    const inherited = at(findText, 'field-ref name="fromA"') + 'field-ref name="'.length;
    assert.equal(definitionAt(findText, inherited, findPath, index)?.[0].uri, fsPathToUri(findPath));

    const extendTransition = at(findText, 'transition="extraSave"') + 'transition="'.length;
    assert.equal(definitionAt(findText, extendTransition, findPath, index)?.[0].uri, fsPathToUri(extendPath));

    const commentUpdate = at(findText, 'transition="RequestCommentUpdate"') + 'transition="'.length;
    const commentUpdatePath = path.join(partyDir, 'Find', 'RequestCommentUpdate.xml');
    assert.equal(definitionAt(findText, commentUpdate, findPath, index)?.[0].uri, fsPathToUri(commentUpdatePath));
    assert.equal(
      hoverValue(hoverAt(findText, commentUpdate, findPath, index, messages)),
      'screen component://app/screen/Party/Find/RequestCommentUpdate.xml',
    );
  });

  it('resolves a default-item to the screen in the matching directory', () => {
    const index = indexed();
    const text = '<screen><subscreens default-item="RequestCommentUpdate"/></screen>';
    const offset = at(text, 'default-item="RequestCommentUpdate"') + 'default-item="'.length;
    const commentUpdatePath = path.join(partyDir, 'Find', 'RequestCommentUpdate.xml');
    assert.equal(definitionAt(text, offset, findPath, index)?.[0].uri, fsPathToUri(commentUpdatePath));
    assert.equal(
      hoverValue(hoverAt(text, offset, findPath, index, messages)),
      'screen component://app/screen/Party/Find/RequestCommentUpdate.xml',
    );
    assert.ok(
      labelsAt('<screen><subscreens default-item="Req"/></screen>', 'Req', index, findPath).includes('RequestCommentUpdate'),
    );
    assert.equal(
      labelsAt('<screen><subscreens default-item="Det"/></screen>', 'Det', index, findPath).includes('Detail'),
      false,
    );
    assert.equal(collectDiagnostics(text, findPath, index, messages).length, 0);
  });

  it('prefers a local transition over a same-named subscreen', () => {
    const index = indexed();
    const text = '<screen><transition name="RequestCommentUpdate"/><dynamic-dialog transition="RequestCommentUpdate"/></screen>';
    index.replaceFile(fsPathToUri(findPath), findPath, text);
    const offset = at(text, 'transition="RequestCommentUpdate"') + 'transition="'.length;
    assert.deepEqual(definitionAt(text, offset, findPath, index), [
      { uri: fsPathToUri(findPath), range: rangeOf(text, 'RequestCommentUpdate') },
    ]);
  });

  it('reports unresolved names and checks hash fragments without flagging dynamic values', () => {
    const index = indexed();
    const diagnostics = collectDiagnostics(findText, findPath, index, messages);
    const reported = diagnostics.map((item) => item.message).sort();
    assert.deepEqual(reported, [
      'missing entity missing.Entity',
      'missing field missingField',
      'missing field nope',
      'missing form MissingList',
      'missing screen ./Missing.xml',
      'missing section Absent',
      'missing section Gone',
      'missing subscreens-item Nope',
      'missing transition missingLoad',
      'missing transition nope',
    ]);
    const gone = diagnostics.find((item) => item.message === 'missing section Gone');
    assert.deepEqual(gone?.range, rangeOf(findText, 'Gone'));
    const crud = diagnostics.find((item) => item.message === 'missing entity missing.Entity');
    assert.deepEqual(crud?.range, rangeOf(findText, 'missing.Entity'));
    assert.equal(collectDiagnostics('<screen><form-list focus-field="notAField"/></screen>', findPath, index, messages).length, 0);
  });

  it('finds references, renames definitions, and counts transition references', () => {
    const index = indexed();
    const options = { messages, fileRename: true, documentChanges: true };
    const saveAt = at(findText, 'name="save"') + 'name="'.length;
    const saveUses = referenceLocations(findText, saveAt, findPath, index) ?? [];
    assert.equal(saveUses.length, 2);
    assert.ok(saveUses.some((item) => item.range.start.line === rangeOf(findText, 'transition="save"').start.line));

    const renamed = renameAt(findText, saveAt, findPath, index, 'store', options);
    assert.ok(renamed && !('message' in renamed));
    assert.deepEqual(
      edits(renamed as WorkspaceEdit).map((item) => item.text).sort(),
      ['store', 'store', 'store'],
    );

    const includeAt = at(findText, 'name="load"') + 'name="'.length;
    const includeRename = renameAt(findText, includeAt, findPath, index, 'reload', options);
    assert.ok(includeRename && !('message' in includeRename));
    const includeEdits = edits(includeRename as WorkspaceEdit);
    assert.equal(includeEdits.length, 2);
    assert.ok(includeEdits.every((item) => item.text === 'reload'));
    assert.ok(includeEdits.some((item) => item.uri === fsPathToUri(detailPath)));

    const sectionAt = at(detailText, 'name="DetailSection"') + 'name="'.length;
    const sectionUses = referenceLocations(detailText, sectionAt, detailPath, index) ?? [];
    assert.equal(sectionUses.length, 2);
    const sectionRename = renameAt(detailText, sectionAt, detailPath, index, 'Summary', options);
    assert.ok(sectionRename && !('message' in sectionRename));
    assert.equal(edits(sectionRename as WorkspaceEdit).length, 3);

    const formAt = at(findText, 'name="Base"') + 'name="'.length;
    const formRename = renameAt(findText, formAt, findPath, index, 'Main', options);
    assert.ok(formRename && !('message' in formRename));
    assert.deepEqual(edits(formRename as WorkspaceEdit).map((item) => item.text).sort(), ['Main', 'Main']);

    const fieldAt = at(findText, 'name="partyId"') + 'name="'.length;
    const fieldRename = renameAt(findText, fieldAt, findPath, index, 'party', options);
    assert.ok(fieldRename && !('message' in fieldRename));
    assert.equal(edits(fieldRename as WorkspaceEdit).length, 3);

    const itemAt = at(findText, 'name="Other"') + 'name="'.length;
    const itemRename = renameAt(findText, itemAt, findPath, index, 'Others', options);
    assert.ok(itemRename && !('message' in itemRename));
    assert.deepEqual(edits(itemRename as WorkspaceEdit).map((item) => item.text).sort(), ['Others', 'Others']);

    const lenses = codeLensesFor(findPath, index, messages);
    const saveLens = lenses.find((lens) => lens.range.start.line === rangeOf(findText, 'save').start.line && lens.command?.title === '2 refs');
    assert.ok(saveLens);
    const sectionLens = lenses.find((lens) => lens.range.start.line === rangeOf(findText, 'Options').start.line && lens.range.start.character === rangeOf(findText, 'Options').start.character);
    assert.equal(sectionLens, undefined);
    const formLens = lenses.find((lens) => lens.range.start.line === rangeOf(findText, 'Base').start.line && lens.range.start.character === rangeOf(findText, 'Base').start.character);
    assert.equal(formLens, undefined);

    const twins = '<screen><transition name="save"/><transition name="save"/></screen>';
    index.replaceFile(fsPathToUri(findPath), findPath, twins);
    const ambiguous = renameAt(twins, at(twins, 'save'), findPath, index, 'store', options);
    assert.deepEqual(ambiguous, { message: 'ambiguous save' });
  });

  it('resolves screen paths and transitions from the updated schemas', () => {
    const index = indexed();
    const text = [
      '<screen>',
      '  <form-list name="Rows" peek-url="save">',
      '    <view-board transition="save"/>',
      '    <view-calendar create-screen="./RequestCommentUpdate" create-transition="save"/>',
      '  </form-list>',
      '  <ext-action name="boss.open" slot="message-actions" screen="Detail" transition="missingMove"/>',
      '  <ext-action name="boss.path" slot="message-actions" screen="../Detail"/>',
      '  <ext-action name="boss.gone" slot="message-actions" screen="MissingScreen"/>',
      '  <keymap><key keys="ctrl+k" screen="Other"/></keymap>',
      '  <text-area mention-transition="https://example.test/search"/>',
      '  <text-area record-transition="${skip}"/>',
      '  <status-bar status-id="Open" transition="nope"/>',
      '</screen>',
    ].join('\n');

    const board = at(text, 'view-board transition="save"') + 'view-board transition="'.length;
    assert.equal(definitionAt(text, board, findPath, index)?.[0].uri, fsPathToUri(findPath));
    assert.equal(hoverValue(hoverAt(text, board, findPath, index, messages)), 'transition save');
    assert.ok(
      labelsAt('<screen><form-list><view-board transition="sa"/></form-list></screen>', 'sa', index, findPath).includes('save'),
    );

    const peek = at(text, 'peek-url="save"') + 'peek-url="'.length;
    assert.equal(hoverValue(hoverAt(text, peek, findPath, index, messages)), 'transition save');

    const detail = at(text, 'screen="Detail"') + 'screen="'.length;
    assert.equal(definitionAt(text, detail, findPath, index)?.[0].uri, fsPathToUri(detailPath));
    assert.ok(
      labelsAt('<screen><ext-action name="a" slot="s" screen="Det"/></screen>', 'Det', index, findPath).includes('Detail'),
    );
    assert.equal(
      labelsAt('<screen><ext-action name="a" slot="s" screen="sa"/></screen>', 'sa', index, findPath).includes('save'),
      false,
    );

    const relative = at(text, 'screen="../Detail"') + 'screen="'.length;
    assert.equal(definitionAt(text, relative, findPath, index)?.[0].uri, fsPathToUri(detailPath));
    const created = at(text, 'create-screen="./RequestCommentUpdate"') + 'create-screen="'.length;
    assert.equal(
      definitionAt(text, created, findPath, index)?.[0].uri,
      fsPathToUri(path.join(partyDir, 'Find', 'RequestCommentUpdate.xml')),
    );
    const other = at(text, 'screen="Other"') + 'screen="'.length;
    assert.equal(definitionAt(text, other, findPath, index)?.[0].uri, fsPathToUri(otherPath));

    const reported = collectDiagnostics(text, findPath, index, messages).map((item) => item.message).sort();
    assert.deepEqual(reported, [
      'missing screen MissingScreen',
      'missing transition missingMove',
      'missing transition nope',
    ]);
  });

  it('resolves a token-route transition on the screen it names', () => {
    const index = indexed();
    const text = [
      '<moqui-conf>',
      '  <webapp name="webroot">',
      '    <token-route name="s" screen-location="component://app/screen/Party/Detail.xml" token-service="missing.Service.get#Token" post-transition="load"/>',
      '    <token-route name="plain" screen-location="not-a-path" token-service="${skip}" post-transition="load"/>',
      '    <token-route name="gone" screen-location="component://app/screen/Party/Missing.xml" token-service="${skip}" post-transition="load"/>',
      '  </webapp>',
      '</moqui-conf>',
    ].join('\n');
    const post = at(text, 'post-transition="load"') + 'post-transition="'.length;
    assert.equal(definitionAt(text, post, findPath, index)?.[0].uri, fsPathToUri(detailPath));
    assert.equal(
      hoverValue(hoverAt(text, post, findPath, index, messages)),
      'transition load from component://app/screen/Party/Detail.xml',
    );
    const reported = collectDiagnostics(text, findPath, index, {
      ...messages,
      unresolvedService: 'missing service {0}',
    }).map((item) => item.message).sort();
    assert.deepEqual(reported, [
      'missing screen component://app/screen/Party/Missing.xml',
      'missing service missing.Service.get#Token',
    ]);
  });

  it('resolves a screen url without a path separator by the first letter', () => {
    const index = indexed();
    const lower = labelsAt('<screen><link url="sa"/></screen>', 'sa', index, findPath);
    assert.ok(lower.includes('save'));
    assert.equal(lower.includes('RequestCommentUpdate'), false);
    assert.equal(lower.includes('OnlyItem'), false);
    const upper = labelsAt('<screen><link url="Req"/></screen>', 'Req', index, findPath);
    assert.ok(upper.includes('RequestCommentUpdate'));
    assert.equal(upper.includes('save'), false);
    const emptyText = '<screen><link url=""/></screen>';
    const emptyAt = emptyText.indexOf('url="') + 'url="'.length;
    const empty = completionAt(emptyText, emptyAt, index, findPath)?.map((item) => item.label) ?? [];
    assert.ok(empty.includes('save'));
    assert.ok(empty.includes('RequestCommentUpdate'));
    assert.ok(empty.includes('OnlyItem'));
    assert.equal(empty.includes('Detail'), false);

    const saveLink = '<screen><link url="save"/></screen>';
    const saveOffset = at(saveLink, 'url="save"') + 'url="'.length;
    assert.deepEqual(definitionAt(saveLink, saveOffset, findPath, index), [
      { uri: fsPathToUri(findPath), range: rangeOf(findText, 'save') },
    ]);
    assert.equal(hoverValue(hoverAt(saveLink, saveOffset, findPath, index, messages)), 'transition save');

    const queried = '<screen><link url="save?x=1"/></screen>';
    const queriedOffset = at(queried, 'url="save?') + 'url="'.length;
    assert.deepEqual(definitionAt(queried, queriedOffset, findPath, index), [
      { uri: fsPathToUri(findPath), range: rangeOf(findText, 'save') },
    ]);

    const response = '<screen><transition name="save"><default-response url="save"/></transition></screen>';
    const responseOffset = at(response, 'url="save"') + 'url="'.length;
    assert.equal(definitionAt(response, responseOffset, findPath, index)?.[0].uri, fsPathToUri(findPath));

    const nested = '<screen><link url="RequestCommentUpdate"/></screen>';
    const nestedOffset = at(nested, 'url="RequestCommentUpdate"') + 'url="'.length;
    assert.equal(
      definitionAt(nested, nestedOffset, findPath, index)?.[0].uri,
      fsPathToUri(path.join(partyDir, 'Find', 'RequestCommentUpdate.xml')),
    );
    const item = '<screen><link url="OnlyItem"/></screen>';
    const itemOffset = at(item, 'url="OnlyItem"') + 'url="'.length;
    assert.equal(definitionAt(item, itemOffset, findPath, index)?.[0].uri, fsPathToUri(detailPath));

    const relative = '<screen><link url="../Detail"/></screen>';
    const relativeOffset = at(relative, 'url="../Detail"') + 'url="'.length;
    assert.equal(definitionAt(relative, relativeOffset, findPath, index)?.[0].uri, fsPathToUri(detailPath));

    const extendLink = '<screen-extend><link url="extraSave"/></screen-extend>';
    const extendOffset = at(extendLink, 'url="extraSave"') + 'url="'.length;
    assert.equal(definitionAt(extendLink, extendOffset, extendPath, index)?.[0].uri, fsPathToUri(extendPath));

    const text = [
      '<screen>',
      '  <transition name="save"/>',
      '  <link url="missingName"/>',
      '  <link url="missingName?x=1"/>',
      '  <link url="MissingScreen"/>',
      '  <link url="Detail"/>',
      '  <link url="${name}"/>',
      '  <link url="edit${name}"/>',
      '  <link url="../${name}"/>',
      '  <link url="actions"/>',
      '  <link url="nope" url-type="plain"/>',
      '</screen>',
    ].join('\n');
    const diagnostics = collectDiagnostics(text, findPath, index, messages);
    assert.deepEqual(
      diagnostics.map((item) => item.message).sort(),
      [
        'dynamic url ${name}',
        'dynamic url ../${name}',
        'dynamic url edit${name}',
        'missing screen Detail',
        'missing screen MissingScreen',
        'missing transition missingName',
        'missing transition missingName',
      ].sort(),
    );
    const dynamic = diagnostics.filter((item) => item.message.startsWith('dynamic url'));
    assert.ok(dynamic.every((item) => item.severity === DiagnosticSeverity.Warning));
    const queryToken = rangeOf(text, 'missingName?x=1');
    const queriedName = diagnostics.find(
      (item) => item.message === 'missing transition missingName' && item.range.start.line === queryToken.start.line,
    );
    assert.equal(queriedName?.range.start.character, queryToken.start.character);
    assert.equal(
      queriedName && queriedName.range.end.character - queriedName.range.start.character,
      'missingName'.length,
    );
    const expression = at(text, 'url="${name}"') + 'url="'.length;
    assert.equal(definitionAt(text, expression, findPath, index), null);
    assert.equal(hoverAt(text, expression, findPath, index, messages), null);
    assert.equal(completionAt(text, expression, index, findPath), null);
    assert.deepEqual(collectDiagnostics('<widget-templates><link url="nope"/></widget-templates>', widgetPath, index, messages), []);

    const renamedText = '<screen><transition name="save"/><link url="save"/><link url="save?x=1"/></screen>';
    index.replaceFile(fsPathToUri(findPath), findPath, renamedText);
    const renamed = renameAt(renamedText, at(renamedText, 'name="save"') + 'name="'.length, findPath, index, 'store', {
      messages,
      fileRename: true,
      documentChanges: true,
    });
    assert.ok(renamed && !('message' in renamed));
    const editsInFile = ((renamed as WorkspaceEdit).documentChanges ?? [])
      .filter((change): change is TextDocumentEdit => TextDocumentEdit.is(change))
      .flatMap((change) => change.edits);
    assert.deepEqual(editsInFile.map((edit) => edit.newText).sort(), ['store', 'store', 'store']);
    const queryEdit = editsInFile.find((edit) => edit.range.start.line === rangeOf(renamedText, 'save?x=1').start.line);
    assert.ok(queryEdit);
    assert.equal(queryEdit.range.end.character - queryEdit.range.start.character, 'save'.length);
  });
});

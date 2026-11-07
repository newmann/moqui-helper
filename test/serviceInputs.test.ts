import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'node:test';
import { Hover, TextDocumentEdit, WorkspaceEdit } from 'vscode-languageserver';
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
  unresolvedService: 'missing service {0}',
  unresolvedServiceInterface: 'missing interface {0}',
  unresolvedParameter: 'missing parameter {0}',
  unresolvedFile: 'missing file {0}',
  hoverService: 'service {0}',
  hoverField: 'field {0}',
  hoverInParameters: 'in',
  hoverOutParameters: 'out',
  hoverRequired: 'required',
  hoverPk: 'pk',
  hoverNone: 'none',
  renameInvalidName: 'bad name',
};

const workspace = path.join(__dirname, 'virtual-service-inputs');
const mantleRoot = path.join(workspace, 'runtime', 'component', 'mantle');
const entityPath = path.join(mantleRoot, 'entity', 'Party.xml');
const servicePath = path.join(mantleRoot, 'service', 'mantle', 'party', 'PartyServices.xml');
const includePath = path.join(mantleRoot, 'service', 'mantle', 'party', 'Included.xml');
const callerPath = path.join(mantleRoot, 'screen', 'Call.xml');
const serviceUri = 'file:///services.xml';
const includeUri = 'file:///included.xml';
const callerUri = 'file:///call.xml';
const entityUri = 'file:///party.xml';

const entityText = [
  '<entities>',
  '  <entity entity-name="Party" package="mantle.party">',
  '    <field name="partyId" type="id" is-pk="true"/>',
  '    <field name="statusId" type="id"/>',
  '  </entity>',
  '</entities>',
].join('\n');

const serviceText = [
  '<services>',
  '  <service verb="face" noun="Party" type="interface">',
  '    <in-parameters><parameter name="note" type="text-long"/></in-parameters>',
  '  </service>',
  '  <service verb="get" noun="Party">',
  '    <implements service="mantle.party.PartyServices.face#Party"/>',
  '    <in-parameters>',
  '      <parameter name="partyId" type="id" required="true"/>',
  '      <auto-parameters entity-name="mantle.party.Party" include="nonpk"/>',
  '    </in-parameters>',
  '    <out-parameters><parameter name="resultCount"/></out-parameters>',
  '  </service>',
  '  <service verb="store" noun="Other"/>',
  '  <service verb="run" noun="Job" type="java" location="org.moqui.impl.Example"/>',
  '</services>',
].join('\n');

const serviceLocation = 'component://mantle/service/mantle/party/PartyServices.xml';

const includeText = [
  '<services>',
  `  <service-include verb="get" noun="Party" location="${serviceLocation}"/>`,
  '</services>',
].join('\n');

const callerText = [
  '<screen>',
  '  <service-call name="mantle.party.PartyServices.get#Party" in-map="context + [partyId:partyId, statusId:statusId, note:note, missing:1]"/>',
  '  <service-call name="mantle.party.PartyServices.get#Party"><field-map field-name="partyId"/></service-call>',
  '  <service-call name="mantle.party.PartyServices.get#Party" in-map="[partyId:partyId,"/>',
  '  <service-call name="create#mantle.party.Party" in-map="[partyId:partyId, noSuch:1]"/>',
  '  <service-call name="create#missing.Thing" in-map="[partyId:1]"/>',
  '  <service-call name="mantle.party.PartyServices.get#Party" in-map="true"/>',
  '  <service-call name="mantle.party.PartyServices.get#Party"><field-map field-name="${name}"/></service-call>',
  '</screen>',
].join('\n');

function indexed(): WorkspaceIndex {
  const index = new WorkspaceIndex();
  index.setWorkspaceRoots([workspace]);
  index.replaceFile('file:///mantle-component.xml', path.join(mantleRoot, 'component.xml'), '<component name="mantle"/>');
  index.replaceFile(entityUri, entityPath, entityText);
  index.replaceFile(serviceUri, servicePath, serviceText);
  index.replaceFile(includeUri, includePath, includeText);
  index.replaceFile(callerUri, callerPath, callerText);
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

function labelsAt(text: string, token: string, index: WorkspaceIndex, fromFsPath = servicePath): string[] {
  const offset = at(text, token) + token.length;
  return completionAt(text, offset, index, fromFsPath)?.map((item) => String(item.label)) ?? [];
}

function messagesOf(text: string, fsPath: string, index: WorkspaceIndex): string[] {
  return collectDiagnostics(text, fsPath, index, messages).map((item) => item.message).sort();
}

function hoverValue(hover: Hover | null): string {
  const contents = hover?.contents;
  return contents && typeof contents === 'object' && !Array.isArray(contents) && 'value' in contents ? contents.value : '';
}

function changes(edit: WorkspaceEdit): string[] {
  const found: string[] = [];
  for (const change of edit.documentChanges ?? []) {
    if (TextDocumentEdit.is(change)) {
      for (const textEdit of change.edits) {
        if ('range' in textEdit) {
          found.push(textEdit.newText);
        }
      }
    }
  }
  return found.sort();
}

describe('service include, interfaces, and inputs', () => {
  it('points include verb and noun at the service in the location file', () => {
    const index = indexed();
    assert.equal(index.findServices('mantle.party.PartyServices.get#Party').length, 1);
    assert.equal(index.findServices('mantle.party.Included.get#Party').length, 0);

    const verbAt = at(includeText, 'verb="get"') + 'verb="'.length;
    const defined = definitionAt(includeText, verbAt, includePath, index);
    assert.deepEqual(defined, [{ uri: serviceUri, range: rangeOf(serviceText, 'get', at(serviceText, 'verb="get"')) }]);
    const nounAt = at(includeText, 'noun="Party"') + 'noun="'.length;
    const nounDefined = definitionAt(includeText, nounAt, includePath, index);
    assert.deepEqual(nounDefined, [{ uri: serviceUri, range: rangeOf(serviceText, 'Party', at(serviceText, 'verb="get"')) }]);

    const hover = hoverValue(hoverAt(includeText, verbAt, includePath, index, messages));
    assert.ok(hover.includes('service mantle.party.PartyServices.get#Party'));
    assert.ok(hover.includes('partyId: id required'));
    assert.ok(hover.includes('note: text-long'));
    assert.ok(hover.includes('resultCount: String'));

    const locationAt = at(includeText, serviceLocation);
    const fileDefined = definitionAt(includeText, locationAt, includePath, index);
    assert.equal(fileDefined?.[0].uri, serviceUri);
    assert.deepEqual(fileDefined?.[0].range, { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } });
    assert.ok(hoverValue(hoverAt(includeText, locationAt, includePath, index, messages)).includes('PartyServices.xml'));

    assert.deepEqual(labelsAt(includeText, 'verb="', index, includePath).sort(), ['face', 'get', 'run', 'store']);
    assert.deepEqual(labelsAt(includeText, 'noun="', index, includePath), ['Party']);

    const uses = referenceLocations(serviceText, at(serviceText, 'verb="get"') + 'verb="'.length, servicePath, index);
    assert.ok(uses?.some((item) => item.uri === includeUri));
    assert.ok(uses?.some((item) => item.uri === callerUri));
  });

  it('reports a missing include file once, and a missing verb inside a real file', () => {
    const index = indexed();
    const missingFile = `<services><service-include verb="get" noun="Party" location="component://mantle/service/Missing.xml"/></services>`;
    assert.deepEqual(messagesOf(missingFile, includePath, index), ['missing file component://mantle/service/Missing.xml']);

    const missingVerb = `<services><service-include verb="nope" noun="Party" location="${serviceLocation}"/></services>`;
    assert.deepEqual(messagesOf(missingVerb, includePath, index), ['missing service nope#Party', 'missing service nope#Party']);

    const dynamic = '<services><service-include verb="get" noun="Party" location="${path}"/></services>';
    assert.deepEqual(messagesOf(dynamic, includePath, index), []);

    const classpath = `<services><service-include verb="get" noun="Party" location="classpath://service/mantle/party/PartyServices.xml"/></services>`;
    assert.equal(definitionAt(classpath, at(classpath, 'classpath://'), includePath, index)?.[0].uri, serviceUri);

    const relative = '<services><service-include verb="get" noun="Party" location="./PartyServices.xml"/></services>';
    assert.equal(definitionAt(relative, at(relative, './PartyServices.xml'), includePath, index)?.[0].uri, serviceUri);
  });

  it('resolves file locations and leaves non-paths alone', () => {
    const index = indexed();
    const text = [
      '<moqui-conf>',
      '  <service-file location="BasicServices"/>',
      '  <service-location name="main" location="https://example.com/api"/>',
      `  <service-location name="local" location="component://mantle/service/Missing.xml"/>`,
      '  <script location="https://example.com/run.groovy"/>',
      '  <text location="component://mantle/template/missing.ftl"/>',
      '</moqui-conf>',
    ].join('\n');
    assert.deepEqual(messagesOf(text, path.join(mantleRoot, 'MoquiConf.xml'), index), [
      'missing file BasicServices',
      'missing file component://mantle/service/Missing.xml',
      'missing file component://mantle/template/missing.ftl',
    ]);
    assert.deepEqual(messagesOf(serviceText, servicePath, index), []);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moqui-p6-'));
    const scriptPath = path.join(dir, 'run.groovy');
    fs.writeFileSync(scriptPath, 'true');
    const caller = '<screen><script location="./run.groovy"/></screen>';
    const defined = definitionAt(caller, at(caller, './run.groovy'), path.join(dir, 'caller.xml'), index);
    assert.equal(defined?.[0].uri, fsPathToUri(scriptPath));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('completes and resolves only service interfaces', () => {
    const index = indexed();
    const text = [
      '<services>',
      '  <service verb="use" noun="Face">',
      '    <implements service="mantle.party.PartyServices."/>',
      '  </service>',
      '</services>',
    ].join('\n');
    const labels = labelsAt(text, 'service="mantle.party.PartyServices.', index);
    assert.deepEqual(labels, ['mantle.party.PartyServices.face#Party']);
    assert.equal(labels.some((label) => label.startsWith('create#')), false);

    const ordinary = '<services><service verb="use" noun="Face"><implements service="mantle.party.PartyServices.get#Party"/></service></services>';
    assert.deepEqual(messagesOf(ordinary, servicePath, index), ['missing interface mantle.party.PartyServices.get#Party']);
    const face = '<services><service verb="use" noun="Face"><implements service="mantle.party.PartyServices.face#Party"/></service></services>';
    assert.deepEqual(messagesOf(face, servicePath, index), []);
  });

  it('matches in-map keys and field names to service inputs', () => {
    const index = indexed();
    const reported = messagesOf(callerText, callerPath, index);
    assert.ok(reported.includes('missing parameter missing'));
    assert.ok(reported.includes('missing parameter noSuch'));
    assert.ok(reported.includes('missing entity missing.Thing'));
    assert.equal(reported.filter((message) => message.startsWith('missing parameter')).length, 2);

    const partyKey = at(callerText, 'partyId:partyId');
    assert.deepEqual(definitionAt(callerText, partyKey, callerPath, index), [
      { uri: serviceUri, range: rangeOf(serviceText, 'partyId', at(serviceText, 'name="partyId"')) },
    ]);
    assert.equal(
      hoverValue(hoverAt(callerText, partyKey, callerPath, index, messages)),
      'partyId: id required',
    );

    const statusKey = at(callerText, 'statusId:statusId');
    assert.deepEqual(definitionAt(callerText, statusKey, callerPath, index), [
      { uri: entityUri, range: rangeOf(entityText, 'statusId') },
    ]);
    const noteKey = at(callerText, 'note:note');
    assert.deepEqual(definitionAt(callerText, noteKey, callerPath, index), [
      { uri: serviceUri, range: rangeOf(serviceText, 'note') },
    ]);

    const fieldMap = at(callerText, 'field-name="partyId"') + 'field-name="'.length;
    assert.deepEqual(definitionAt(callerText, fieldMap, callerPath, index), [
      { uri: serviceUri, range: rangeOf(serviceText, 'partyId', at(serviceText, 'name="partyId"')) },
    ]);

    const crudKey = at(callerText, 'create#mantle.party.Party" in-map="[partyId');
    assert.deepEqual(definitionAt(callerText, crudKey + 'create#mantle.party.Party" in-map="['.length, callerPath, index), [
      { uri: entityUri, range: rangeOf(entityText, 'partyId') },
    ]);

    const open = at(callerText, '[partyId:partyId,"') + '[partyId:partyId,'.length;
    const openLabels = completionAt(callerText, open, index, callerPath)?.map((item) => String(item.label)).sort();
    assert.deepEqual(openLabels, ['note', 'statusId']);
    const typing = '<screen><service-call name="mantle.party.PartyServices.get#Party" in-map="[sta"/></screen>';
    assert.deepEqual(labelsAt(typing, 'in-map="[sta', index, callerPath), ['statusId']);
    const dynamicValue = '<screen><service-call name="mantle.party.PartyServices.get#Party" in-map="[dyn:${x}]"/></screen>';
    assert.deepEqual(messagesOf(dynamicValue, callerPath, index), ['missing parameter dyn']);
  });

  it('renames an included verb without rewriting the whole service name', () => {
    const index = new WorkspaceIndex();
    index.setWorkspaceRoots([workspace]);
    index.replaceFile('file:///mantle-component.xml', path.join(mantleRoot, 'component.xml'), '<component name="mantle"/>');
    index.replaceFile(serviceUri, servicePath, serviceText);
    index.replaceFile(includeUri, includePath, includeText);
    const call = '<screen><service-call name="mantle.party.PartyServices.get#Party"/></screen>';
    index.replaceFile(callerUri, callerPath, call);
    const verbAt = at(serviceText, 'verb="get"') + 'verb="'.length;
    const edit = renameAt(serviceText, verbAt, servicePath, index, 'fetch', {
      messages,
      fileRename: true,
      documentChanges: true,
    });
    assert.ok(edit && !('message' in edit));
    assert.deepEqual(changes(edit as WorkspaceEdit), [
      'fetch',
      'fetch',
      'mantle.party.PartyServices.fetch#Party',
    ]);
  });
});

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { describe, it } from 'node:test';
import { Hover } from 'vscode-languageserver';
import { WorkspaceIndex } from '../src/server/index/workspace';
import { Messages } from '../src/server/messages';
import { completionAt, completionTriggerCharacters } from '../src/server/providers/completion';
import { definitionAt } from '../src/server/providers/definition';
import { collectDiagnostics } from '../src/server/providers/diagnostics';
import { hoverAt } from '../src/server/providers/hover';
import { referenceLocations } from '../src/server/refs/rename';
import { LineMap } from '../src/server/xml/scan';

const messages: Messages = {
  unresolvedEntity: 'missing entity {0}',
  unresolvedService: 'missing service {0}',
  unresolvedScreen: 'missing screen {0}',
  hoverEntity: 'entity {0}',
  hoverViewEntity: 'view {0}',
  hoverService: 'service {0}',
  hoverScreen: 'screen {0}',
  unresolvedForm: 'missing form {0}',
  hoverCrud: 'crud {0} entity {1}',
  hoverField: 'field {0}',
  hoverRelationship: 'relationship {0}',
  hoverInParameters: 'in',
  hoverOutParameters: 'out',
  hoverFields: 'fields',
  hoverRelationships: 'relationships',
  hoverRequired: 'required',
  hoverPk: 'pk',
  hoverNone: 'none',
  hoverColumnName: 'name',
  hoverColumnType: 'type',
  hoverYes: 'yes',
};

const workspace = path.join(__dirname, 'virtual-refs');
const mantleRoot = path.join(workspace, 'runtime', 'component', 'mantle');
const toolsRoot = path.join(workspace, 'runtime', 'base-component', 'tools');
const entityPath = path.join(mantleRoot, 'entity', 'Party.xml');
const servicePath = path.join(mantleRoot, 'service', 'mantle', 'party', 'PartyServices.xml');
const findPath = path.join(mantleRoot, 'screen', 'Find.xml');
const editPath = path.join(mantleRoot, 'screen', 'Edit.xml');
const securityPath = path.join(toolsRoot, 'screen', 'System', 'Security.xml');

function indexed(): WorkspaceIndex {
  const index = new WorkspaceIndex();
  index.setWorkspaceRoots([workspace]);
  index.replaceFile('file:///mantle-component.xml', path.join(mantleRoot, 'component.xml'), '<component name="mantle"/>');
  index.replaceFile('file:///tools-component.xml', path.join(toolsRoot, 'component.xml'), '<component name="tools"/>');
  index.replaceFile(
    'file:///party.xml',
    entityPath,
    '<entities><entity entity-name="Party" package="mantle.party" short-alias="parties"/><view-entity entity-name="PartyView" package="mantle.party"/></entities>',
  );
  index.replaceFile(
    'file:///services.xml',
    servicePath,
    '<services><service verb="get" noun="Party"/></services>',
  );
  index.replaceFile('file:///find.xml', findPath, '<screen><form-single name="FindForm"/></screen>');
  index.replaceFile('file:///security.xml', securityPath, '<screen></screen>');
  return index;
}

function rangeOf(text: string, name: string) {
  const offset = text.indexOf(name);
  return new LineMap(text).range(offset, offset + name.length);
}

function labelsAt(text: string, index: WorkspaceIndex): string[] {
  return completionAt(text, text.indexOf('""') + 1, index)?.map((item) => item.label) ?? [];
}

function hoverValue(hover: Hover | null): string {
  const contents = hover?.contents;
  return contents && typeof contents === 'object' && !Array.isArray(contents) && 'value' in contents ? contents.value : '';
}

describe('references', () => {
  it('resolves entities, services, crud, and screen locations', () => {
    const index = indexed();
    const text = [
      '<screen>',
      '  <entity-find entity-name="mantle.party.Party"/>',
      '  <entity-find entity-name="parties"/>',
      '  <service-call name="mantle.party.PartyServices.get#Party"/>',
      '  <service-call name="create#mantle.party.Party"/>',
      '  <include-screen location="component://mantle/screen/Find.xml"/>',
      '  <include-screen location="./Find.xml"/>',
      '  <include-screen location="//apps/system/Security.xml"/>',
      '  <form-single name="Find" extends="component://mantle/screen/Find.xml#FindForm"/>',
      '  <extend-entity entity-name="Party" package="mantle.party"/>',
      '</screen>',
    ].join('\n');

    assert.equal(collectDiagnostics(text, editPath, index, messages).length, 0);

    const crud = text.indexOf('create#mantle.party.Party');
    const definitions = definitionAt(text, crud + 'create#'.length, editPath, index);
    assert.equal(definitions?.[0].uri, 'file:///party.xml');

    const hoverText = hoverValue(hoverAt(text, crud + 'create#'.length, editPath, index, messages));
    assert.equal(
      hoverText,
      ['crud create#mantle.party.Party entity mantle.party.Party', '', 'fields', 'none'].join('\n'),
    );

    const screenOffset = text.indexOf('component://mantle/screen/Find.xml');
    assert.equal(hoverValue(hoverAt(text, screenOffset + 1, editPath, index, messages)), 'screen component://mantle/screen/Find.xml');
    const screenDefinitions = definitionAt(text, screenOffset + 1, editPath, index);
    assert.equal(screenDefinitions?.[0].uri, 'file:///find.xml');
  });

  it('reports unresolved names and ignores dynamic values, patterns, and non-file paths', () => {
    const index = indexed();
    const text = [
      '<screen>',
      '  <entity-find entity-name="missing.Name"/>',
      '  <service-call name="create#missing.Entity"/>',
      '  <service-call name="missing.Service.get#Thing"/>',
      '  <service-call name="${name}"/>',
      '  <seca service="missing.Service" name-is-pattern="true"/>',
      '  <include-screen location="component://mantle/screen/Missing.xml"/>',
      '  <include-screen location="./Missing.xml"/>',
      '  <include-screen location="//apps/other/Nope.xml"/>',
      '  <include-screen location="http://example.com/a.xml"/>',
      '  <include-screen location="${dynamic}"/>',
      '  <form-single name="Local" extends="LocalForm"/>',
      '  <extend-entity entity-name="Party" package="missing.party"/>',
      '  <relationship type="one" related="missing.Related"/>',
      '  <key-value related="fieldName" value="x"/>',
      '  <transition name="find"/>',
      '</screen>',
    ].join('\n');

    const diagnostics = collectDiagnostics(text, editPath, index, messages);
    const reported = diagnostics.map((item) => item.message).sort();
    assert.deepEqual(reported, [
      'missing entity missing.Entity',
      'missing entity missing.Name',
      'missing entity missing.Related',
      'missing entity missing.party.Party',
      'missing form LocalForm',
      'missing screen ./Missing.xml',
      'missing screen component://mantle/screen/Missing.xml',
      'missing service missing.Service.get#Thing',
    ]);
    const entityDiagnostic = diagnostics.find((item) => item.message === 'missing entity missing.Name');
    assert.deepEqual(entityDiagnostic?.range, rangeOf(text, 'missing.Name'));
    const crudDiagnostic = diagnostics.find((item) => item.message === 'missing entity missing.Entity');
    assert.deepEqual(crudDiagnostic?.range, rangeOf(text, 'missing.Entity'));
  });

  it('completes canonical names, short extend-entity names, crud, and screen locations', () => {
    const index = indexed();
    const entityText = '<entity-find entity-name="man"/>';
    const entityItems = completionAt(entityText, entityText.indexOf('man') + 3, index);
    assert.ok(entityItems?.some((item) => item.label === 'mantle.party.Party'));
    assert.ok(entityItems?.some((item) => item.label === 'mantle.party.PartyView'));

    const shortText = '<entity-find entity-name="Par"/>';
    const shortItems = completionAt(shortText, shortText.indexOf('Par') + 3, index)?.map((item) => item.label) ?? [];
    assert.ok(shortItems.includes('Party'));
    assert.ok(shortItems.includes('mantle.party.Party'));

    const extendText = '<extend-entity entity-name="Par" package="mantle.party"/>';
    const extendItems = completionAt(extendText, extendText.indexOf('Par') + 3, index);
    assert.deepEqual(extendItems?.map((item) => item.label), ['Party', 'PartyView']);

    const crudText = '<service-call name="create#Par"/>';
    const crudItems = completionAt(crudText, crudText.indexOf('create#Par') + 'create#Par'.length, index);
    assert.ok(crudItems?.some((item) => item.label === 'create#Party'));
    assert.ok(crudItems?.some((item) => item.label === 'create#PartyView'));

    const screenText = '<include-screen location="component://mantle/screen/F"/>';
    const screenItems = completionAt(screenText, screenText.indexOf('component://mantle/screen/F') + 'component://mantle/screen/F'.length, index);
    assert.deepEqual(screenItems?.map((item) => item.label), ['component://mantle/screen/Find.xml']);
    assert.equal(screenItems?.[0].textEdit && 'newText' in screenItems[0].textEdit ? screenItems[0].textEdit.newText : '', 'component://mantle/screen/Find.xml');

    const relativeText = '<include-screen location="./F"/>';
    const relativeItems = completionAt(relativeText, relativeText.indexOf('./F') + './F'.length, index, editPath);
    assert.deepEqual(relativeItems?.map((item) => item.label), ['./Find.xml']);

    const shorthandText = '<include-screen location="//apps/system/S"/>';
    const shorthandItems = completionAt(shorthandText, shorthandText.indexOf('//apps/system/S') + '//apps/system/S'.length, index, editPath);
    assert.deepEqual(shorthandItems?.map((item) => item.label), ['//apps/system/Security.xml']);
  });

  it('offers name completion for an empty attribute value', () => {
    const index = indexed();
    const entityText = '<entity-find entity-name=""/>';
    const entityItems = labelsAt(entityText, index);
    assert.ok(entityItems.includes('mantle.party.Party'));
    assert.ok(entityItems.includes('Party'));
    assert.equal(collectDiagnostics(entityText, editPath, index, messages).length, 0);

    const extendText = '<extend-entity entity-name="" package="mantle.party"/>';
    const extendItems = labelsAt(extendText, index);
    assert.ok(extendItems.includes('Party'));
    assert.ok(extendItems.includes('PartyView'));
    assert.equal(collectDiagnostics(extendText, editPath, index, messages).length, 0);

    const serviceText = '<service-call name=""/>';
    assert.ok(labelsAt(serviceText, index).includes('mantle.party.PartyServices.get#Party'));

    const screenText = '<include-screen location=""/>';
    assert.ok(labelsAt(screenText, index).includes('component://mantle/screen/Find.xml'));
  });

  it('keeps separator triggers and enables quick suggestions for word characters', () => {
    for (const character of ['/', ':', '.', '"', '#', '-', '<', ' ']) {
      assert.equal(completionTriggerCharacters.includes(character), true);
    }
    for (const character of ['a', 'M', '0', '_']) {
      assert.equal(completionTriggerCharacters.includes(character), false);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')) as {
      contributes: {
        configurationDefaults: {
          '[xml]': {
            'editor.quickSuggestions': { strings: string; other: string; comments: string };
            'editor.wordBasedSuggestions': string;
          };
        };
      };
    };
    const xmlDefaults = manifest.contributes.configurationDefaults['[xml]'];
    const suggestions = xmlDefaults['editor.quickSuggestions'];
    assert.equal(suggestions.strings, 'on');
    assert.equal(suggestions.other, 'on');
    assert.equal(suggestions.comments, 'off');
    assert.equal(xmlDefaults['editor.wordBasedSuggestions'], 'off');
  });

  it('resolves service and entity names under a resource root', () => {
    const index = indexed();
    const resourcePath = path.join(mantleRoot, 'service', 'mantle', 'party', 'PartyServices.rest.xml');
    const text = [
      '<resource name="parties">',
      '  <method type="get"><service name="mantle.party.PartyServices.get#Party"/></method>',
      '  <method type="put"><entity name="mantle.party.Party" operation="update"/></method>',
      '</resource>',
    ].join('\n');
    index.replaceFile('file:///party.rest.xml', resourcePath, text);
    assert.equal(collectDiagnostics(text, resourcePath, index, messages).length, 0);

    const serviceAt = text.indexOf('mantle.party.PartyServices.get#Party');
    assert.equal(definitionAt(text, serviceAt, resourcePath, index)?.[0].uri, 'file:///services.xml');
    const entityAt = text.indexOf('entity name="mantle.party.Party"') + 'entity name="'.length;
    assert.equal(definitionAt(text, entityAt, resourcePath, index)?.[0].uri, 'file:///party.xml');

    const missing = [
      '<resource name="parties">',
      '  <method type="get"><service name="missing.Service.get#Thing"/></method>',
      '  <method type="put"><entity name="missing.Entity" operation="update"/></method>',
      '  <id name="partyId"><method type="get"><service name="${dynamic}"/></method></id>',
      '</resource>',
    ].join('\n');
    const reported = collectDiagnostics(missing, resourcePath, index, messages).map((item) => item.message).sort();
    assert.deepEqual(reported, ['missing entity missing.Entity', 'missing service missing.Service.get#Thing']);

    const servicePartial = '<resource name="p"><method type="get"><service name="mantle.party.PartyServices.get#P"/></method></resource>';
    const serviceItems = completionAt(servicePartial, servicePartial.indexOf('get#P') + 'get#P'.length, index);
    assert.ok(serviceItems?.some((item) => item.label === 'mantle.party.PartyServices.get#Party'));

    const serviceFile = '<services><service verb="get" noun="Party"/></services>';
    const uses = referenceLocations(serviceFile, serviceFile.indexOf('verb="get"') + 'verb="'.length, servicePath, index);
    assert.ok(uses?.some((item) => item.uri === 'file:///party.rest.xml'));

    const namedService = '<services><service verb="get" noun="Party" name="missing.Service.get#Nope"/></services>';
    assert.equal(collectDiagnostics(namedService, servicePath, index, messages).length, 0);
  });

  it('shows entity fields and the merged service interface', () => {
    const index = indexed();
    index.replaceFile(
      'file:///party.xml',
      entityPath,
      [
        '<entities>',
        '  <entity entity-name="Party" package="mantle.party">',
        '    <field name="partyId" type="id" is-pk="true"/>',
        '    <field name="statusId" type="id"/>',
        '    <relationship type="many" related="mantle.party.Contact" short-alias="contacts">',
        '      <key-map field-name="partyId"/>',
        '    </relationship>',
        '  </entity>',
        '  <entity entity-name="Contact" package="mantle.party">',
        '    <field name="contactMechId" type="id" is-pk="true"/>',
        '  </entity>',
        '</entities>',
      ].join('\n'),
    );
    index.replaceFile(
      'file:///services.xml',
      servicePath,
      [
        '<services>',
        '  <service verb="store" noun="Party">',
        '    <in-parameters>',
        '      <parameter name="partyId" type="id" required="true"/>',
        '      <parameter name="info" type="Map">',
        '        <parameter name="note"/>',
        '      </parameter>',
        '    </in-parameters>',
        '    <out-parameters>',
        '      <parameter name="partyId" type="id"/>',
        '      <parameter name="resultCount"/>',
        '    </out-parameters>',
        '  </service>',
        '  <service verb="get" noun="Party">',
        '    <implements service="mantle.party.PartyServices.store#Party" required="true"/>',
        '    <in-parameters>',
        '      <parameter name="partyId" required="false"/>',
        '      <auto-parameters entity-name="mantle.party.Party" include="nonpk"/>',
        '    </in-parameters>',
        '  </service>',
        '  <service verb="cycle" noun="A">',
        '    <implements service="mantle.party.PartyServices.cycle#B"/>',
        '    <in-parameters><parameter name="fromA"/></in-parameters>',
        '  </service>',
        '  <service verb="cycle" noun="B">',
        '    <implements service="mantle.party.PartyServices.cycle#A"/>',
        '    <in-parameters><parameter name="fromB" required="true"/></in-parameters>',
        '  </service>',
        '</services>',
      ].join('\n'),
    );

    const caller = [
      '<screen>',
      '  <entity-find entity-name="mantle.party.Party"/>',
      '  <service-call name="mantle.party.PartyServices.get#Party"/>',
      '  <service-call name="mantle.party.PartyServices.cycle#A"/>',
      '</screen>',
    ].join('\n');
    const entityAt = caller.indexOf('mantle.party.Party');
    assert.equal(
      hoverValue(hoverAt(caller, entityAt, editPath, index, messages)),
      [
        'entity mantle.party.Party',
        '',
        'fields',
        '',
        '```',
        '┌──────────┬──────┬─────┐',
        '│ name     │ type │ pk  │',
        '├──────────┼──────┼─────┤',
        '│ partyId  │ id   │ yes │',
        '│ statusId │ id   │     │',
        '└──────────┴──────┴─────┘',
        '```',
        '',
        'relationships',
        '- many mantle.party.Contact (contacts) partyId',
      ].join('\n'),
    );

    const serviceAt = caller.indexOf('mantle.party.PartyServices.get#Party');
    assert.equal(
      hoverValue(hoverAt(caller, serviceAt, editPath, index, messages)),
      [
        'service mantle.party.PartyServices.get#Party',
        '',
        'in',
        '- partyId: String',
        '- statusId: id',
        '- info: Map required',
        '  - note: String required',
        '',
        'out',
        '- partyId: id required',
        '- resultCount: String required',
      ].join('\n'),
    );

    const get = index.findServices('mantle.party.PartyServices.get#Party')[0];
    assert.deepEqual(
      index.serviceParameters(get).map((parameter) => parameter.name),
      ['partyId', 'statusId'],
    );

    const cycleAt = caller.indexOf('mantle.party.PartyServices.cycle#A');
    assert.equal(
      hoverValue(hoverAt(caller, cycleAt, editPath, index, messages)),
      [
        'service mantle.party.PartyServices.cycle#A',
        '',
        'in',
        '- fromA: String',
        '- fromB: String required',
        '',
        'out',
        'none',
      ].join('\n'),
    );

    const facade = [
      '<entity-facade-xml>',
      '  <mantle.party.Party>',
      '    <partyId/>',
      '    <contacts/>',
      '  </mantle.party.Party>',
      '</entity-facade-xml>',
    ].join('\n');
    const dataPath = path.join(mantleRoot, 'data', 'PartyData.xml');
    index.replaceFile('file:///data.xml', dataPath, facade);
    assert.equal(
      hoverValue(hoverAt(facade, facade.indexOf('partyId'), dataPath, index, messages)),
      'field partyId: id pk',
    );
    assert.equal(
      hoverValue(hoverAt(facade, facade.indexOf('contacts'), dataPath, index, messages)),
      'relationship contacts\nmany mantle.party.Contact partyId',
    );
  });
});

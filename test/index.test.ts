import assert from 'node:assert/strict';
import * as path from 'path';
import { describe, it } from 'node:test';
import { WorkspaceIndex } from '../src/server/index/workspace';
import { pathKey } from '../src/server/paths';

const workspace = path.join(__dirname, 'virtual');
const mantleRoot = path.join(workspace, 'runtime', 'component', 'mantle');
const componentXml = path.join(mantleRoot, 'component.xml');
const serviceXml = path.join(mantleRoot, 'service', 'mantle', 'party', 'PartyServices.xml');
const entityXml = path.join(mantleRoot, 'entity', 'Party.xml');
const screenXml = path.join(mantleRoot, 'screen', 'Find.xml');

const componentText = '<component name="mantle"/>';
const serviceText = '<services><service verb="get" noun="Party"/><service verb="ping"/><service-include verb="store" noun="Party" location="component://mantle/service/Other.xml"/></services>';
const entityText = [
  '<entities>',
  '  <entity entity-name="Party" package="mantle.party" short-alias="parties"/>',
  '  <entity entity-name="Party" package="other.party"/>',
  '  <view-entity entity-name="PartyView" package="mantle.party"/>',
  '  <extend-entity entity-name="Party" package="mantle.party"/>',
  '</entities>',
].join('\n');
const screenText = '<screen></screen>';

function texts(files: Record<string, string>): (fsPath: string) => string | undefined {
  return (fsPath) => {
    for (const [candidate, text] of Object.entries(files)) {
      if (pathKey(candidate) === pathKey(fsPath)) {
        return text;
      }
    }
    return undefined;
  };
}

describe('workspace index', () => {
  it('indexes entity full names, short names, and short aliases', () => {
    const index = new WorkspaceIndex();
    index.replaceFile('file:///party.xml', entityXml, entityText);

    assert.equal(index.findEntities('mantle.party.Party').length, 1);
    assert.equal(index.findEntities('mantle.party.Party')[0].kind, 'entity');
    assert.deepEqual(
      index.findEntities('Party').map((record) => record.name).sort(),
      ['mantle.party.Party', 'other.party.Party'],
    );
    assert.equal(index.findEntities('parties')[0].name, 'mantle.party.Party');
    assert.equal(index.findEntities('mantle.party.PartyView')[0].kind, 'view-entity');
    assert.equal(index.findEntities('mantle.party.Party').length, 1);
  });

  it('drops names from a file when that file is replaced', () => {
    const index = new WorkspaceIndex();
    index.replaceFile('file:///party.xml', entityXml, entityText);
    index.replaceFile(
      'file:///party.xml',
      entityXml,
      '<entities><entity entity-name="Other" package="mantle.other"/></entities>',
    );

    assert.equal(index.findEntities('mantle.party.Party').length, 0);
    assert.equal(index.findEntities('parties').length, 0);
    assert.equal(index.findEntities('mantle.other.Other').length, 1);
  });

  it('builds service names from the path under service/', () => {
    const index = new WorkspaceIndex();
    index.replaceFile('file:///component.xml', componentXml, componentText);
    index.replaceFile('file:///services.xml', serviceXml, serviceText);

    assert.equal(index.findServices('mantle.party.PartyServices.get#Party').length, 1);
    assert.equal(index.findServices('mantle.party.PartyServices.ping').length, 1);
    assert.equal(index.findServices('mantle.party.PartyServices.store#Party').length, 0);
  });

  it('indexes a service after its component.xml arrives', () => {
    const index = new WorkspaceIndex();
    index.replaceFile('file:///services.xml', serviceXml, serviceText);
    assert.equal(index.findServices('mantle.party.PartyServices.get#Party').length, 0);

    const changed = index.replaceFile('file:///component.xml', componentXml, componentText);
    assert.equal(changed, true);
    index.reindexIndexedFiles(texts({ [serviceXml]: serviceText }), componentXml);

    assert.equal(index.findServices('mantle.party.PartyServices.get#Party').length, 1);
    assert.equal(index.replaceFile('file:///component.xml', componentXml, componentText), false);
  });

  it('renames screen locations when the component name changes', () => {
    const index = new WorkspaceIndex();
    index.replaceFile('file:///component.xml', componentXml, componentText);
    index.replaceFile('file:///find.xml', screenXml, screenText);
    assert.equal(index.findScreensByLocation('component://mantle/screen/Find.xml').length, 1);

    const changed = index.replaceFile('file:///component.xml', componentXml, '<component name="other"/>');
    assert.equal(changed, true);
    index.reindexIndexedFiles(texts({ [screenXml]: screenText }), componentXml);

    assert.equal(index.findScreensByLocation('component://mantle/screen/Find.xml').length, 0);
    assert.equal(index.findScreensByLocation('component://other/screen/Find.xml').length, 1);
  });
});

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { after, describe, it } from 'node:test';
import { WorkspaceIndex } from '../src/server/index/workspace';
import { Messages } from '../src/server/messages';
import { fsPathToUri, pathKey, uriToFsPath } from '../src/server/paths';
import { codeLensesFor } from '../src/server/providers/codeLens';
import { completionAt } from '../src/server/providers/completion';
import { definitionAt } from '../src/server/providers/definition';
import { collectDiagnostics } from '../src/server/providers/diagnostics';
import { LineMap } from '../src/server/xml/scan';

const messages: Messages = {
  unresolvedFile: 'missing file {0}',
  unresolvedWidgetTemplate: 'missing template {0}',
  referenceCount: '{0} references',
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moqui-p7-'));
const mantleRoot = path.join(root, 'runtime', 'component', 'mantle');
const editPath = path.join(mantleRoot, 'screen', 'Edit.xml');
const findPath = path.join(mantleRoot, 'screen', 'Find.xml');
const templatePath = path.join(mantleRoot, 'template', 'PartyForms.xml');
const securityPath = path.join(root, 'runtime', 'base-component', 'tools', 'screen', 'System', 'Security.xml');
const demoRoot = path.join(root, 'runtime', 'dev-component', 'demo');
const demoScreen = path.join(demoRoot, 'screen', 'Home.xml');
const macroPath = path.join(root, 'template', 'Macro.ftl');

const templateText = '<widget-templates><widget-template name="Party"><label text="Hi"/></widget-template></widget-templates>';
const editText = [
  '<screen>',
  '  <widget-template-include location="component://mantle/template/PartyForms.xml#Party"/>',
  '  <widget-template-include location="component://mantle/template/PartyForms.xml#Party"/>',
  '  <widget-template-include location="${dynamic}#Party"/>',
  '</screen>',
].join('\n');

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

write(path.join(mantleRoot, 'component.xml'), '<component name="mantle"/>');
write(findPath, '<screen></screen>');
write(editPath, editText);
write(templatePath, templateText);
write(securityPath, '<screen></screen>');
write(path.join(demoRoot, 'component.xml'), '<component name="demo"/>');
write(demoScreen, '<screen></screen>');
write(macroPath, 'macro');

function indexed(): WorkspaceIndex {
  const index = new WorkspaceIndex();
  index.setWorkspaceRoots([root]);
  index.replaceFile(fsPathToUri(path.join(mantleRoot, 'component.xml')), path.join(mantleRoot, 'component.xml'), '<component name="mantle"/>');
  index.replaceFile(fsPathToUri(findPath), findPath, '<screen></screen>');
  index.replaceFile(fsPathToUri(editPath), editPath, editText);
  index.replaceFile(fsPathToUri(templatePath), templatePath, templateText);
  index.replaceFile(fsPathToUri(securityPath), securityPath, '<screen></screen>');
  index.replaceFile(fsPathToUri(path.join(demoRoot, 'component.xml')), path.join(demoRoot, 'component.xml'), '<component name="demo"/>');
  index.replaceFile(fsPathToUri(demoScreen), demoScreen, '<screen></screen>');
  return index;
}

function labelsAt(text: string, index: WorkspaceIndex, from = editPath): string[] {
  const marker = text.includes('location="') ? 'location="' : text.includes('url="') ? 'url="' : 'macro-template-location="';
  const offset = text.indexOf(marker) + marker.length;
  const end = text.indexOf('"', offset);
  const cursor = end > offset ? end : offset;
  return completionAt(text, cursor, index, from)?.map((item) => item.label) ?? [];
}

describe('path locations', () => {
  const index = indexed();

  it('completes the next path segment for component, relative, shorthand, and classpath locations', () => {
    assert.ok(labelsAt('<load-data location=""/>', index).includes('component://mantle/'));

    const component = labelsAt('<link url="component://mantle/"/>', index);
    assert.ok(component.includes('component://mantle/screen/'));
    assert.ok(component.includes('component://mantle/component.xml'));
    assert.equal(component.includes('component://mantle/screen'), false);

    assert.ok(labelsAt('<screen><macro-template type="html" location="./"/></screen>', index).includes('./Find.xml'));
    assert.ok(labelsAt('<default-response url="//"/>', index).includes('//system/'));
    assert.ok(labelsAt('<default-response url="//system/"/>', index).includes('//system/Security.xml'));
    assert.ok(
      labelsAt('<screen-text-output type="html" macro-template-location="classpath://template/"/>', index).includes(
        'classpath://template/Macro.ftl',
      ),
    );

    const names = labelsAt('<widget-template-include location="component://mantle/template/PartyForms.xml#"/>', index);
    assert.ok(names.includes('Party'));
  });

  it('resolves a component stored under runtime/dev-component by name', () => {
    assert.ok(labelsAt('<link url="component://demo/"/>', index).includes('component://demo/screen/'));

    const location = '<load-entity location="component://demo/screen/Home.xml"/>';
    const defs = definitionAt(location, location.indexOf('component://') + 4, editPath, index);
    assert.equal(defs?.length, 1);
    assert.equal(pathKey(uriToFsPath(defs?.[0].uri ?? '')), pathKey(demoScreen));
  });

  it('jumps a written path to the file and a template name to its definition', () => {
    const entity = '<load-entity location="component://mantle/screen/Find.xml"/>';
    const entityDefs = definitionAt(entity, entity.indexOf('component://') + 4, editPath, index);
    assert.equal(entityDefs?.length, 1);
    assert.equal(pathKey(uriToFsPath(entityDefs?.[0].uri ?? '')), pathKey(findPath));
    assert.deepEqual(entityDefs?.[0].range, { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } });

    const image = '<image url="./Find.xml"/>';
    const imageDefs = definitionAt(image, image.indexOf('./') + 1, editPath, index);
    assert.equal(pathKey(uriToFsPath(imageDefs?.[0].uri ?? '')), pathKey(findPath));

    const extend = '<screen-extend menu-image="component://mantle/screen/Find.xml"/>';
    const extendDefs = definitionAt(extend, extend.indexOf('component://') + 4, editPath, index);
    assert.equal(pathKey(uriToFsPath(extendDefs?.[0].uri ?? '')), pathKey(findPath));

    const facade = '<resource-facade xml-actions-template-location="classpath://template/Macro.ftl"/>';
    const facadeDefs = definitionAt(facade, facade.indexOf('classpath://') + 4, editPath, index);
    assert.equal(pathKey(uriToFsPath(facadeDefs?.[0].uri ?? '')), pathKey(macroPath));

    const shorthand = '<default-response url="//system/Security.xml"/>';
    const shorthandDefs = definitionAt(shorthand, shorthand.indexOf('//system') + 4, editPath, index);
    assert.equal(pathKey(uriToFsPath(shorthandDefs?.[0].uri ?? '')), pathKey(securityPath));

    const include = '<widget-template-include location="component://mantle/template/PartyForms.xml#Party"/>';
    const fileDefs = definitionAt(include, include.indexOf('component://') + 4, editPath, index);
    assert.equal(pathKey(uriToFsPath(fileDefs?.[0].uri ?? '')), pathKey(templatePath));
    assert.deepEqual(fileDefs?.[0].range, { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } });

    const template = index.templatesIn(templatePath)[0];
    const nameDefs = definitionAt(include, include.indexOf('#Party') + 2, editPath, index);
    assert.equal(nameDefs?.length, 1);
    assert.equal(nameDefs?.[0].uri, template.uri);
    assert.deepEqual(nameDefs?.[0].range, template.nameRange);

    const current = '<conditional-response url="."/>';
    assert.equal(definitionAt(current, current.indexOf('url="') + 5, editPath, index), null);
    const parent = '<conditional-response url=".."/>';
    assert.equal(definitionAt(parent, parent.indexOf('url="') + 5, editPath, index), null);
  });

  it('reports hardcoded missing files and template names, and skips dynamic or non-path values', () => {
    const text = [
      '<moqui-conf>',
      '  <load-data location="component://mantle/data/Missing.xml"/>',
      '  <load-data location="${foo}"/>',
      '  <link url="https://example.com"/>',
      '  <link url="editParty"/>',
      '  <screen menu-image="component://mantle/data/Missing.xml" menu-image-type="icon"/>',
      '  <error-response url="//not-a-root/Missing.xml"/>',
      '  <conditional-response url="."/>',
      '  <widget-template-include location="component://mantle/template/PartyForms.xml#Missing"/>',
      '</moqui-conf>',
    ].join('\n');
    const diagnostics = collectDiagnostics(text, editPath, index, messages);
    assert.deepEqual(
      diagnostics.map((item) => item.message).sort(),
      ['missing file component://mantle/data/Missing.xml', 'missing template Missing'].sort(),
    );
    const map = new LineMap(text);
    const missingName = 'Missing';
    const nameStart = text.indexOf('#Missing') + 1;
    const nameDiagnostic = diagnostics.find((item) => item.message === 'missing template Missing');
    assert.deepEqual(nameDiagnostic?.range, map.range(nameStart, nameStart + missingName.length));
  });

  it('does not complete paths in service locations', () => {
    const text = '<service verb="get" noun="Party" location="component://mantle/screen/Find.xml"/>';
    const offset = text.indexOf('mantle/') + 'mantle/'.length;
    assert.equal(completionAt(text, offset, index, editPath), null);
  });

  it('resolves a screen url from the current screen name', () => {
    const homePath = path.join(mantleRoot, 'screen', 'Projects', 'Home.xml');
    const mergePath = path.join(mantleRoot, 'screen', 'Projects', 'Code', 'MergeRequests.xml');
    write(homePath, '<screen></screen>');
    write(mergePath, '<screen></screen>');
    index.replaceFile(fsPathToUri(homePath), homePath, '<screen></screen>');
    index.replaceFile(fsPathToUri(mergePath), mergePath, '<screen></screen>');

    const link = '<screen><link url="../Code/MergeRequests"/></screen>';
    const defs = definitionAt(link, link.indexOf('../'), homePath, index);
    assert.equal(pathKey(uriToFsPath(defs?.[0].uri ?? '')), pathKey(mergePath));

    const queried = '<screen><link url="../Code/MergeRequests?list=waiting"/></screen>';
    const queriedDefs = definitionAt(queried, queried.indexOf('../'), homePath, index);
    assert.equal(pathKey(uriToFsPath(queriedDefs?.[0].uri ?? '')), pathKey(mergePath));

    const response = '<transition><default-response url="../Code/MergeRequests"/></transition>';
    const responseDefs = definitionAt(response, response.indexOf('../'), homePath, index);
    assert.equal(pathKey(uriToFsPath(responseDefs?.[0].uri ?? '')), pathKey(mergePath));

    const text = [
      '<screen>',
      '  <link url="../Code/MergeRequests"/>',
      '  <link url="../Code/MergeRequests?list=waiting"/>',
      '  <link url="/qapps/Projects/Code/MergeRequestDetail" url-type="plain"/>',
      '  <default-response url="../Missing/Screen"/>',
      '</screen>',
    ].join('\n');
    assert.deepEqual(
      collectDiagnostics(text, homePath, index, messages).map((item) => item.message),
      ['missing file ../Missing/Screen'],
    );

    assert.ok(labelsAt('<link url="../Code/"/>', index, homePath).includes('../Code/MergeRequests'));
    assert.ok(labelsAt('<image url="./"/>', index, editPath).includes('./Find.xml'));
  });

  it('counts widget-template includes on the template name', () => {
    const template = index.templatesIn(templatePath)[0];
    const lenses = codeLensesFor(templatePath, index, messages);
    const lens = lenses.find(
      (item) =>
        item.range.start.line === template.nameRange.start.line &&
        item.range.start.character === template.nameRange.start.character,
    );
    assert.equal(lens?.command?.title, '2 references');
    const locations = lens?.command?.arguments?.[2] as unknown[];
    assert.equal(locations.length, 2);
  });
});

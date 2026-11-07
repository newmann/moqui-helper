import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { XML_FILE_ASSOCIATIONS } from '../src/xmlAssociations';

describe('xml file associations', () => {
  it('binds each Moqui root element to its schema system id', () => {
    const byPattern = new Map(XML_FILE_ASSOCIATIONS.map((item) => [item.pattern, item.systemId]));
    assert.equal(byPattern.size, 12);
    assert.equal(byPattern.get('entities'), 'http://moqui.org/xsd/entity-definition-3.xsd');
    assert.equal(byPattern.get('services'), 'http://moqui.org/xsd/service-definition-3.xsd');
    assert.equal(byPattern.get('secas'), 'http://moqui.org/xsd/service-eca-3.xsd');
    assert.equal(byPattern.get('eecas'), 'http://moqui.org/xsd/entity-eca-3.xsd');
    assert.equal(byPattern.get('emecas'), 'http://moqui.org/xsd/email-eca-3.xsd');
    assert.equal(byPattern.get('screen'), 'http://moqui.org/xsd/xml-screen-3.xsd');
    assert.equal(byPattern.get('screen-extend'), 'http://moqui.org/xsd/xml-screen-3.xsd');
    assert.equal(byPattern.get('moqui-conf'), 'http://moqui.org/xsd/moqui-conf-3.xsd');
    assert.equal(byPattern.get('component'), 'http://moqui.org/xsd/moqui-conf-3.xsd');
    assert.equal(byPattern.get('resource'), 'http://moqui.org/xsd/rest-api-3.xsd');
    assert.equal(byPattern.get('widget-templates'), 'http://moqui.org/xsd/xml-form-3.xsd');
    assert.equal(byPattern.get('entity-facade-xml'), 'http://moqui.org/xsd/entity-facade-xml-3.xsd');
    for (const item of XML_FILE_ASSOCIATIONS) {
      assert.equal(item.pattern.includes('*'), false);
      assert.equal(item.pattern.includes('/'), false);
      assert.equal(item.pattern.includes('.'), false);
    }
  });
});

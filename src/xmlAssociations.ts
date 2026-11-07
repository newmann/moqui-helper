export interface XmlFileAssociation {
  pattern: string;
  systemId: string;
}

const SCHEMA = 'http://moqui.org/xsd';

export const XML_FILE_ASSOCIATIONS: readonly XmlFileAssociation[] = [
  { pattern: 'entities', systemId: `${SCHEMA}/entity-definition-3.xsd` },
  { pattern: 'services', systemId: `${SCHEMA}/service-definition-3.xsd` },
  { pattern: 'secas', systemId: `${SCHEMA}/service-eca-3.xsd` },
  { pattern: 'eecas', systemId: `${SCHEMA}/entity-eca-3.xsd` },
  { pattern: 'emecas', systemId: `${SCHEMA}/email-eca-3.xsd` },
  { pattern: 'screen', systemId: `${SCHEMA}/xml-screen-3.xsd` },
  { pattern: 'screen-extend', systemId: `${SCHEMA}/xml-screen-3.xsd` },
  { pattern: 'moqui-conf', systemId: `${SCHEMA}/moqui-conf-3.xsd` },
  { pattern: 'component', systemId: `${SCHEMA}/moqui-conf-3.xsd` },
  { pattern: 'resource', systemId: `${SCHEMA}/rest-api-3.xsd` },
  { pattern: 'widget-templates', systemId: `${SCHEMA}/xml-form-3.xsd` },
  { pattern: 'entity-facade-xml', systemId: `${SCHEMA}/entity-facade-xml-3.xsd` },
];

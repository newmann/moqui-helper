import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemasDir = path.join(root, 'schemas');
const catalog = fs.readFileSync(path.join(schemasDir, 'catalog.xml'), 'utf8');

const xsdFiles = fs
  .readdirSync(schemasDir)
  .filter((name) => name.endsWith('-3.xsd'))
  .sort();

function entries(tag, idAttribute) {
  const pattern = new RegExp(`<${tag}\\s+${idAttribute}="([^"]+)"\\s+uri="([^"]+)"\\s*/>`, 'g');
  const found = new Map();
  for (const match of catalog.matchAll(pattern)) {
    found.set(match[1], match[2]);
  }
  return found;
}

const systems = entries('system', 'systemId');
const uris = entries('uri', 'name');
const errors = [];

if (xsdFiles.length !== 13) {
  errors.push(`expected 13 xsd files, found ${xsdFiles.length}`);
}

for (const file of xsdFiles) {
  const id = `http://moqui.org/xsd/${file}`;
  if (systems.get(id) !== file) {
    errors.push(`missing system entry for ${file}`);
  }
  if (uris.get(id) !== file) {
    errors.push(`missing uri entry for ${file}`);
  }
  if (!fs.existsSync(path.join(schemasDir, file))) {
    errors.push(`missing schema file ${file}`);
  }
}

if (systems.size !== xsdFiles.length) {
  errors.push(`system entry count ${systems.size} does not match xsd count ${xsdFiles.length}`);
}
if (uris.size !== xsdFiles.length) {
  errors.push(`uri entry count ${uris.size} does not match xsd count ${xsdFiles.length}`);
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

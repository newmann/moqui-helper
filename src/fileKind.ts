export const ROOT_PREFIX_LENGTH = 32 * 1024;

export interface FileKind {
  root: string;
  badge: string;
  tooltipKey: string;
  colorId: string;
  colorKey: string;
}

const SCREEN_COLOR_ID = 'moquiHelper.fileKind.screen';
const SCREEN_COLOR_KEY = 'fileKindColorScreen';

export const FILE_KINDS: readonly FileKind[] = [
  {
    root: 'entities',
    badge: 'En',
    tooltipKey: 'fileKindEntities',
    colorId: 'moquiHelper.fileKind.entities',
    colorKey: 'fileKindColorEntities',
  },
  {
    root: 'services',
    badge: 'Sv',
    tooltipKey: 'fileKindServices',
    colorId: 'moquiHelper.fileKind.services',
    colorKey: 'fileKindColorServices',
  },
  {
    root: 'secas',
    badge: 'Se',
    tooltipKey: 'fileKindSecas',
    colorId: 'moquiHelper.fileKind.secas',
    colorKey: 'fileKindColorSecas',
  },
  {
    root: 'eecas',
    badge: 'Ee',
    tooltipKey: 'fileKindEecas',
    colorId: 'moquiHelper.fileKind.eecas',
    colorKey: 'fileKindColorEecas',
  },
  {
    root: 'emecas',
    badge: 'Em',
    tooltipKey: 'fileKindEmecas',
    colorId: 'moquiHelper.fileKind.emecas',
    colorKey: 'fileKindColorEmecas',
  },
  {
    root: 'gitecas',
    badge: 'Ge',
    tooltipKey: 'fileKindGitecas',
    colorId: 'moquiHelper.fileKind.gitecas',
    colorKey: 'fileKindColorGitecas',
  },
  {
    root: 'screen',
    badge: 'Sc',
    tooltipKey: 'fileKindScreen',
    colorId: SCREEN_COLOR_ID,
    colorKey: SCREEN_COLOR_KEY,
  },
  {
    root: 'screen-extend',
    badge: 'Sx',
    tooltipKey: 'fileKindScreenExtend',
    colorId: SCREEN_COLOR_ID,
    colorKey: SCREEN_COLOR_KEY,
  },
  {
    root: 'moqui-conf',
    badge: 'Cf',
    tooltipKey: 'fileKindMoquiConf',
    colorId: 'moquiHelper.fileKind.moquiConf',
    colorKey: 'fileKindColorMoquiConf',
  },
  {
    root: 'resource',
    badge: 'Re',
    tooltipKey: 'fileKindResource',
    colorId: 'moquiHelper.fileKind.resource',
    colorKey: 'fileKindColorResource',
  },
  {
    root: 'component',
    badge: 'Co',
    tooltipKey: 'fileKindComponent',
    colorId: 'moquiHelper.fileKind.component',
    colorKey: 'fileKindColorComponent',
  },
  {
    root: 'widget-templates',
    badge: 'Wt',
    tooltipKey: 'fileKindWidgetTemplates',
    colorId: 'moquiHelper.fileKind.widgetTemplates',
    colorKey: 'fileKindColorWidgetTemplates',
  },
  {
    root: 'entity-facade-xml',
    badge: 'Fx',
    tooltipKey: 'fileKindEntityFacadeXml',
    colorId: 'moquiHelper.fileKind.entityFacadeXml',
    colorKey: 'fileKindColorEntityFacadeXml',
  },
];

const KINDS_BY_ROOT = new Map(FILE_KINDS.map((kind) => [kind.root, kind]));

export function fileKindForRoot(root: string | undefined): FileKind | undefined {
  if (!root) {
    return undefined;
  }
  return KINDS_BY_ROOT.get(root);
}

export function readRootTag(text: string): string | undefined {
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (index < text.length) {
    index = skipWhitespace(text, index);
    if (index >= text.length || text[index] !== '<') {
      return undefined;
    }
    if (text.startsWith('<!--', index)) {
      const end = text.indexOf('-->', index + 4);
      if (end < 0) {
        return undefined;
      }
      index = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', index)) {
      const end = text.indexOf(']]>', index + 9);
      if (end < 0) {
        return undefined;
      }
      index = end + 3;
      continue;
    }
    if (text.startsWith('<?', index)) {
      const end = text.indexOf('?>', index + 2);
      if (end < 0) {
        return undefined;
      }
      index = end + 2;
      continue;
    }
    if (text.startsWith('<!', index)) {
      index = skipDeclaration(text, index);
      continue;
    }
    if (text.startsWith('</', index)) {
      return undefined;
    }
    return localName(text, index + 1);
  }
  return undefined;
}

function skipWhitespace(text: string, index: number): number {
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code !== 32 && code !== 9 && code !== 10 && code !== 13) {
      break;
    }
    index++;
  }
  return index;
}

function skipDeclaration(text: string, open: number): number {
  let index = open + 2;
  let depth = 0;
  let quote = '';
  while (index < text.length) {
    const ch = text[index];
    if (quote) {
      if (ch === quote) {
        quote = '';
      }
      index++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      index++;
      continue;
    }
    if (ch === '[') {
      depth++;
      index++;
      continue;
    }
    if (ch === ']') {
      if (depth > 0) {
        depth--;
      }
      index++;
      continue;
    }
    if (ch === '>' && depth === 0) {
      return index + 1;
    }
    index++;
  }
  return text.length;
}

function localName(text: string, start: number): string | undefined {
  if (!isNameStart(text.charCodeAt(start))) {
    return undefined;
  }
  let index = start + 1;
  while (index < text.length && isNameChar(text.charCodeAt(index))) {
    index++;
  }
  const raw = text.slice(start, index);
  const colon = raw.indexOf(':');
  const local = colon >= 0 ? raw.slice(colon + 1) : raw;
  return local.length > 0 ? local : undefined;
}

function isNameStart(code: number): boolean {
  return code === 58 || code === 95 || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isNameChar(code: number): boolean {
  return isNameStart(code) || code === 45 || code === 46 || (code >= 48 && code <= 57);
}

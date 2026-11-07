import * as fs from 'fs';
import * as path from 'path';
import {
  commands,
  ConfigurationTarget,
  env,
  ExtensionContext,
  extensions,
  Location,
  Position,
  Range,
  Uri,
  window,
  workspace,
} from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import { registerFileDecorations } from './fileDecorations';
import { mergeMessages, nlsFileName } from './nls';
import { XML_FILE_ASSOCIATIONS, XmlFileAssociation } from './xmlAssociations';

const XML_EXTENSION_ID = 'redhat.vscode-xml';
const XML_SYMBOLS_STATE_KEY = 'xmlSymbolsDisabled';

interface XmlExtensionApi {
  addXMLCatalogs(catalogs: string[]): void;
  removeXMLCatalogs(catalogs: string[]): void;
  addXMLFileAssociations?(associations: XmlFileAssociation[]): void;
  removeXMLFileAssociations?(associations: XmlFileAssociation[]): void;
}

let client: LanguageClient | undefined;
let extensionContext: ExtensionContext | undefined;
let registeredCatalog: string | undefined;
let registeredAssociations: XmlFileAssociation[] | undefined;

function workspaceHasMoquiMarker(): boolean {
  return moquiWorkspaceFolders().length > 0;
}

function moquiWorkspaceFolders() {
  return (workspace.workspaceFolders ?? []).filter((folder) =>
    fs.existsSync(path.join(folder.uri.fsPath, 'MoquiInit.properties')),
  );
}

async function disableXmlSymbols(context: ExtensionContext): Promise<void> {
  const config = workspace.getConfiguration('xml');
  const inspected = config.inspect<boolean>('symbols.enabled');
  if (inspected?.workspaceValue !== undefined) {
    return;
  }
  try {
    await config.update('symbols.enabled', false, ConfigurationTarget.Workspace);
    await context.workspaceState.update(XML_SYMBOLS_STATE_KEY, true);
  } catch (error) {
    console.error(error);
  }
}

async function restoreXmlSymbols(context: ExtensionContext): Promise<void> {
  if (context.workspaceState.get(XML_SYMBOLS_STATE_KEY) !== true) {
    return;
  }
  const config = workspace.getConfiguration('xml');
  const inspected = config.inspect<boolean>('symbols.enabled');
  if (inspected?.workspaceValue !== false) {
    await context.workspaceState.update(XML_SYMBOLS_STATE_KEY, undefined);
    return;
  }
  try {
    await config.update('symbols.enabled', undefined, ConfigurationTarget.Workspace);
    await context.workspaceState.update(XML_SYMBOLS_STATE_KEY, undefined);
  } catch (error) {
    console.error(error);
  }
}

function readMessages(context: ExtensionContext): Record<string, string> {
  const fallback = readNlsFile(context, 'package.nls.json');
  const localizedName = nlsFileName(env.language);
  if (localizedName === 'package.nls.json') {
    return fallback;
  }
  return mergeMessages(fallback, readNlsFile(context, localizedName));
}

function readNlsFile(context: ExtensionContext, fileName: string): Record<string, string> {
  const nlsPath = context.asAbsolutePath(fileName);
  return JSON.parse(fs.readFileSync(nlsPath, 'utf8')) as Record<string, string>;
}

function nlsMessage(messages: Record<string, string>, key: string): string {
  const message = messages[key];
  if (!message) {
    throw new Error(`Missing nls key: ${key}`);
  }
  return message;
}

async function registerSchemaCatalog(context: ExtensionContext, messages: Record<string, string>): Promise<void> {
  const catalogPath = context.asAbsolutePath(path.join('schemas', 'catalog.xml'));
  const xmlExtension = extensions.getExtension<XmlExtensionApi>(XML_EXTENSION_ID);
  if (!xmlExtension) {
    void window.showWarningMessage(nlsMessage(messages, 'xmlExtensionMissing'));
    return;
  }

  try {
    const api = await xmlExtension.activate();
    api.addXMLCatalogs([catalogPath]);
    registeredCatalog = catalogPath;
    if (typeof api.addXMLFileAssociations !== 'function') {
      console.error(new Error('Missing addXMLFileAssociations'));
      void window.showWarningMessage(nlsMessage(messages, 'xmlCatalogFailed'));
      return;
    }
    const associations = XML_FILE_ASSOCIATIONS.map((item) => ({ ...item }));
    api.addXMLFileAssociations(associations);
    registeredAssociations = associations;
  } catch (error) {
    console.error(error);
    void window.showWarningMessage(nlsMessage(messages, 'xmlCatalogFailed'));
  }
}

export async function activate(context: ExtensionContext): Promise<void> {
  extensionContext = context;
  if (!workspaceHasMoquiMarker()) {
    await restoreXmlSymbols(context);
    return;
  }

  await disableXmlSymbols(context);
  context.subscriptions.push(
    workspace.onDidChangeWorkspaceFolders(() => {
      if (workspaceHasMoquiMarker()) {
        void disableXmlSymbols(context);
      } else {
        void restoreXmlSymbols(context);
      }
    }),
  );

  const messages = readMessages(context);
  context.subscriptions.push(registerFileDecorations(messages));
  await registerSchemaCatalog(context, messages);

  const serverModule = context.asAbsolutePath(path.join('out', 'server', 'index.js'));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'xml' }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/*.xml'),
    },
    initializationOptions: {
      messages,
    },
  };

  client = new LanguageClient('moquiHelper', 'Moqui Helper', serverOptions, clientOptions);
  context.subscriptions.push(
    commands.registerCommand('moquiHelper.foldForm', async (uri: string, line: number) => {
      if (typeof uri !== 'string' || typeof line !== 'number') {
        return;
      }
      const target = Uri.parse(uri);
      const visible = window.visibleTextEditors.find((editor) => editor.document.uri.toString() === uri);
      const editor = visible ?? (await window.showTextDocument(target));
      if (window.activeTextEditor?.document.uri.toString() !== uri) {
        await window.showTextDocument(editor.document, {
          viewColumn: editor.viewColumn,
          selection: new Range(line, 0, line, 0),
        });
      }
      const folded = lineHidden(editor, line + 1);
      await commands.executeCommand(folded ? 'editor.unfold' : 'editor.fold', {
        levels: 1,
        selectionLines: [line],
      });
    }),
    commands.registerCommand(
      'moquiHelper.showReferences',
      (uri: string, position: Position, locations: Array<{ uri: string; range: { start: Position; end: Position } }>) => {
        const converted = (locations ?? []).map(
          (location) =>
            new Location(
              Uri.parse(location.uri),
              new Range(
                new Position(location.range.start.line, location.range.start.character),
                new Position(location.range.end.line, location.range.end.character),
              ),
            ),
        );
        return commands.executeCommand(
          'editor.action.showReferences',
          Uri.parse(uri),
          new Position(position.line, position.character),
          converted,
        );
      },
    ),
  );
  await client.start();
}

function lineHidden(editor: { visibleRanges: readonly Range[] }, line: number): boolean {
  const ranges = editor.visibleRanges;
  if (ranges.length === 0) {
    return false;
  }
  const first = ranges[0].start.line;
  const last = ranges[ranges.length - 1].end.line;
  if (line < first || line > last) {
    return false;
  }
  return ranges.every((range) => line < range.start.line || line > range.end.line);
}

export async function deactivate(): Promise<void> {
  const xmlExtension = extensions.getExtension<XmlExtensionApi>(XML_EXTENSION_ID);
  if (xmlExtension?.isActive) {
    if (registeredCatalog) {
      xmlExtension.exports.removeXMLCatalogs([registeredCatalog]);
      registeredCatalog = undefined;
    }
    if (registeredAssociations && typeof xmlExtension.exports.removeXMLFileAssociations === 'function') {
      xmlExtension.exports.removeXMLFileAssociations(registeredAssociations);
      registeredAssociations = undefined;
    }
  }
  const stopping = client?.stop();
  client = undefined;
  try {
    await stopping;
  } finally {
    if (extensionContext) {
      await restoreXmlSymbols(extensionContext);
    }
  }
}

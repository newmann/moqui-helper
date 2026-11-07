import * as fs from 'fs';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  CodeLensRefreshRequest,
  createConnection,
  ErrorCodes,
  FileChangeType,
  InitializeParams,
  InitializeResult,
  InlayHintRefreshRequest,
  ResponseError,
  TextDocuments,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import { WorkspaceIndex } from './index/workspace';
import { Messages } from './messages';
import { fsPathToUri, isComponentXmlPath, isInside, isSkippedRelative, toPosix, uriToFsPath } from './paths';
import { codeLensesFor, formFoldLenses } from './providers/codeLens';
import { completionAt, completionTriggerCharacters } from './providers/completion';
import { definitionAt } from './providers/definition';
import { collectDiagnostics } from './providers/diagnostics';
import { inlayHintsFor } from './providers/inlayHint';
import { foldingRanges } from './providers/folding';
import { hoverAt } from './providers/hover';
import { documentSymbols } from './providers/symbols';
import { prepareRenameAt, referenceLocations, renameAt } from './refs/rename';

const connection = createConnection();
const documents = new TextDocuments(TextDocument);
const index = new WorkspaceIndex();

let messages: Messages = {};
let workspaceRoots: string[] = [];
let scanGeneration = 0;
let indexReady = false;
let refreshTimer: NodeJS.Timeout | undefined;
let hasWorkspaceFolderCapability = false;
let fileRename = false;
let documentChanges = false;
let codeLensRefresh = false;
let inlayHintRefresh = false;

connection.onInitialize((params: InitializeParams): InitializeResult => {
  messages = readMessages(params.initializationOptions);
  workspaceRoots = rootsWithMarker(params.workspaceFolders?.map((folder) => uriToFsPath(folder.uri)) ?? []);
  index.setWorkspaceRoots(workspaceRoots);
  hasWorkspaceFolderCapability = params.capabilities.workspace?.workspaceFolders === true;
  const workspaceEdit = params.capabilities.workspace?.workspaceEdit;
  documentChanges = workspaceEdit?.documentChanges === true;
  fileRename = documentChanges && (workspaceEdit?.resourceOperations?.includes('rename') ?? false);
  codeLensRefresh = params.capabilities.workspace?.codeLens?.refreshSupport === true;
  inlayHintRefresh = params.capabilities.workspace?.inlayHint?.refreshSupport === true;
  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: completionTriggerCharacters,
        resolveProvider: false,
      },
      definitionProvider: true,
      hoverProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
      foldingRangeProvider: true,
      documentSymbolProvider: true,
      codeLensProvider: { resolveProvider: false },
      inlayHintProvider: { resolveProvider: false },
      workspace: {
        workspaceFolders: { supported: true },
      },
    },
  };
  if (hasWorkspaceFolderCapability && result.capabilities.workspace?.workspaceFolders) {
    result.capabilities.workspace.workspaceFolders.changeNotifications = true;
  }
  return result;
});

connection.onInitialized(() => {
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders(() => {
      void reloadWorkspaceFolders();
    });
  }
  void scanWorkspace();
});

documents.onDidChangeContent((event) => {
  const fsPath = uriToFsPath(event.document.uri);
  if (!isIndexable(fsPath)) {
    scheduleRefresh();
    return;
  }
  const componentChanged = index.replaceFile(event.document.uri, fsPath, event.document.getText());
  if (componentChanged) {
    index.reindexIndexedFiles(readIndexedText, fsPath);
  }
  scheduleRefresh();
});

documents.onDidClose((event) => {
  const fsPath = uriToFsPath(event.document.uri);
  if (!isIndexable(fsPath)) {
    scheduleRefresh();
    return;
  }
  if (!fs.existsSync(fsPath)) {
    const componentChanged = index.removeFile(fsPath);
    if (componentChanged) {
      index.reindexIndexedFiles(readIndexedText, fsPath);
    }
  } else {
    const text = fs.readFileSync(fsPath, 'utf8');
    const componentChanged = index.replaceFile(fsPathToUri(fsPath), fsPath, text);
    if (componentChanged) {
      index.reindexIndexedFiles(readIndexedText, fsPath);
    }
  }
  scheduleRefresh();
});

connection.onDidChangeWatchedFiles((params) => {
  let componentChanged = false;
  let exceptPath: string | undefined;
  for (const change of params.changes) {
    if (!change.uri.startsWith('file:')) {
      continue;
    }
    const fsPath = uriToFsPath(change.uri);
    if (!isIndexable(fsPath) || documentForPath(fsPath)) {
      continue;
    }
    if (change.type === FileChangeType.Deleted) {
      if (index.removeFile(fsPath)) {
        componentChanged = true;
        exceptPath = fsPath;
      }
      continue;
    }
    if (!fs.existsSync(fsPath)) {
      if (index.removeFile(fsPath)) {
        componentChanged = true;
        exceptPath = fsPath;
      }
      continue;
    }
    try {
      const text = fs.readFileSync(fsPath, 'utf8');
      if (index.replaceFile(change.uri, fsPath, text)) {
        componentChanged = true;
        exceptPath = fsPath;
      }
    } catch (error) {
      console.error(error);
    }
  }
  if (componentChanged && exceptPath) {
    index.reindexIndexedFiles(readIndexedText, exceptPath);
  }
  scheduleRefresh();
});

connection.onCompletion((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }
  return completionAt(document.getText(), document.offsetAt(params.position), index, uriToFsPath(document.uri));
});

connection.onDefinition((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }
  return definitionAt(document.getText(), document.offsetAt(params.position), uriToFsPath(document.uri), index);
});

connection.onHover((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }
  return hoverAt(
    document.getText(),
    document.offsetAt(params.position),
    uriToFsPath(document.uri),
    index,
    messages,
  );
});

connection.onReferences((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }
  return referenceLocations(document.getText(), document.offsetAt(params.position), uriToFsPath(document.uri), index);
});

connection.onPrepareRename((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }
  const result = prepareRenameAt(document.getText(), document.offsetAt(params.position), uriToFsPath(document.uri), index, {
    messages,
    fileRename,
    documentChanges,
  });
  if (!result) {
    return null;
  }
  if ('message' in result) {
    throw new ResponseError(ErrorCodes.InvalidRequest, result.message);
  }
  return result;
});

connection.onRenameRequest((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }
  const result = renameAt(
    document.getText(),
    document.offsetAt(params.position),
    uriToFsPath(document.uri),
    index,
    params.newName,
    { messages, fileRename, documentChanges },
  );
  if (!result) {
    return null;
  }
  if ('message' in result) {
    throw new ResponseError(ErrorCodes.InvalidRequest, result.message);
  }
  return result;
});

connection.onFoldingRanges((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }
  return foldingRanges(document.getText(), messages);
});

connection.onDocumentSymbol((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document || !document.uri.startsWith('file:')) {
    return null;
  }
  const fsPath = uriToFsPath(document.uri);
  if (!workspaceRoots.some((root) => isInside(fsPath, root))) {
    return null;
  }
  return documentSymbols(document.getText());
});

connection.onCodeLens((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document || !document.uri.startsWith('file:')) {
    return null;
  }
  return [
    ...codeLensesFor(uriToFsPath(document.uri), index, messages),
    ...formFoldLenses(document.getText(), document.uri, messages),
  ];
});

connection.languages.inlayHint.on((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document || !document.uri.startsWith('file:')) {
    return null;
  }
  return inlayHintsFor(document.getText(), index, messages, params.range);
});

documents.listen(connection);
connection.listen();

function readMessages(options: unknown): Messages {
  if (!options || typeof options !== 'object' || !('messages' in options)) {
    return {};
  }
  const value = (options as { messages?: unknown }).messages;
  if (!value || typeof value !== 'object') {
    return {};
  }
  const messages: Messages = {};
  for (const [key, message] of Object.entries(value)) {
    if (typeof message === 'string') {
      messages[key] = message;
    }
  }
  return messages;
}

function rootsWithMarker(roots: readonly string[]): string[] {
  return roots.filter((root) => fs.existsSync(path.join(root, 'MoquiInit.properties')));
}

function isIndexable(fsPath: string): boolean {
  if (!fsPath.toLowerCase().endsWith('.xml')) {
    return false;
  }
  const root = workspaceRoots.find((candidate) => isInside(fsPath, candidate));
  if (!root) {
    return false;
  }
  return !isSkippedRelative(toPosix(path.relative(root, fsPath)));
}

function documentForPath(fsPath: string): TextDocument | undefined {
  const target = path.normalize(fsPath);
  return documents.all().find((document) => {
    if (!document.uri.startsWith('file:')) {
      return false;
    }
    return pathEquals(uriToFsPath(document.uri), target);
  });
}

function pathEquals(left: string, right: string): boolean {
  if (process.platform === 'win32') {
    return path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();
  }
  return path.normalize(left) === path.normalize(right);
}

function readIndexedText(fsPath: string): string | undefined {
  const open = documentForPath(fsPath);
  if (open) {
    return open.getText();
  }
  try {
    return fs.readFileSync(fsPath, 'utf8');
  } catch {
    return undefined;
  }
}

async function reloadWorkspaceFolders(): Promise<void> {
  if (!connection.workspace) {
    return;
  }
  const folders = await connection.workspace.getWorkspaceFolders();
  workspaceRoots = rootsWithMarker((folders ?? []).map((folder) => uriToFsPath(folder.uri)));
  indexReady = false;
  index.clear();
  index.setWorkspaceRoots(workspaceRoots);
  await scanWorkspace();
}

async function scanWorkspace(): Promise<void> {
  const generation = ++scanGeneration;
  indexReady = false;
  const files: string[] = [];
  for (const root of workspaceRoots) {
    files.push(...(await listXmlFiles(root)));
    if (generation !== scanGeneration) {
      return;
    }
  }
  const componentFirst = [
    ...files.filter((file) => isComponentXmlPath(file)),
    ...files.filter((file) => !isComponentXmlPath(file)),
  ];
  for (let fileIndex = 0; fileIndex < componentFirst.length; fileIndex++) {
    if (generation !== scanGeneration) {
      return;
    }
    const fsPath = componentFirst[fileIndex];
    const open = documentForPath(fsPath);
    try {
      const text = open ? open.getText() : await fs.promises.readFile(fsPath, 'utf8');
      const uri = open ? open.uri : fsPathToUri(fsPath);
      index.replaceFile(uri, fsPath, text);
    } catch (error) {
      console.error(error);
    }
    if (fileIndex % 40 === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  if (generation !== scanGeneration) {
    return;
  }
  for (const document of documents.all()) {
    if (!document.uri.startsWith('file:')) {
      continue;
    }
    const fsPath = uriToFsPath(document.uri);
    if (isIndexable(fsPath)) {
      index.replaceFile(document.uri, fsPath, document.getText());
    }
  }
  if (generation !== scanGeneration) {
    return;
  }
  indexReady = true;
  refreshOpenDocuments();
}

async function listXmlFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await walk(root, '');
  return files;

  async function walk(directory: string, relative: string): Promise<void> {
    if (relative && isSkippedRelative(relative)) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch (error) {
      console.error(error);
      return;
    }
    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (isSkippedRelative(childRelative)) {
        continue;
      }
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(child, childRelative);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.xml')) {
        files.push(child);
      }
    }
  }
}

function scheduleRefresh(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined;
    refreshOpenDocuments();
  }, 200);
}

function refreshOpenDocuments(): void {
  if (!indexReady) {
    return;
  }
  for (const document of documents.all()) {
    if (!document.uri.startsWith('file:')) {
      continue;
    }
    const diagnostics = collectDiagnostics(document.getText(), uriToFsPath(document.uri), index, messages);
    void connection.sendDiagnostics({ uri: document.uri, diagnostics });
  }
  if (codeLensRefresh) {
    void connection.sendRequest(CodeLensRefreshRequest.type);
  }
  if (inlayHintRefresh) {
    void connection.sendRequest(InlayHintRefreshRequest.type);
  }
}

import * as fs from 'fs';
import * as path from 'path';
import {
  CancellationToken,
  Disposable,
  EventEmitter,
  FileDecoration,
  FileDecorationProvider,
  TextDocument,
  ThemeColor,
  Uri,
  window,
  workspace,
} from 'vscode';
import { FileKind, ROOT_PREFIX_LENGTH, fileKindForRoot, readRootTag } from './fileKind';
import { MOQUI_ROOT_MARKERS, hasMoquiRootMarker } from './moquiRoot';

interface DiskCacheEntry {
  mtimeMs: number;
  size: number;
  kind: FileKind | undefined;
}

interface OpenCacheEntry {
  version: number;
  kind: FileKind | undefined;
}

class MoquiFileDecorationProvider implements FileDecorationProvider, Disposable {
  private readonly emitter = new EventEmitter<Uri | Uri[] | undefined>();
  private readonly subscriptions: Disposable[] = [];
  private readonly diskCache = new Map<string, DiskCacheEntry>();
  private readonly openCache = new Map<string, OpenCacheEntry>();
  private cachedRoots: string[] | undefined;

  readonly onDidChangeFileDecorations = this.emitter.event;

  constructor(private readonly messages: Record<string, string>) {
    const xmlWatcher = workspace.createFileSystemWatcher('**/*.xml');
    const markerWatchers = MOQUI_ROOT_MARKERS.map((name) => workspace.createFileSystemWatcher(`**/${name}`));
    this.subscriptions.push(
      this.emitter,
      xmlWatcher,
      ...markerWatchers,
      xmlWatcher.onDidCreate((uri) => this.invalidate(uri)),
      xmlWatcher.onDidChange((uri) => this.invalidate(uri)),
      xmlWatcher.onDidDelete((uri) => this.invalidate(uri)),
      ...markerWatchers.flatMap((markerWatcher) => [
        markerWatcher.onDidCreate(() => this.refreshAll()),
        markerWatcher.onDidChange(() => this.refreshAll()),
        markerWatcher.onDidDelete(() => this.refreshAll()),
      ]),
      workspace.onDidChangeWorkspaceFolders(() => this.refreshAll()),
      workspace.onDidChangeTextDocument((event) => this.onDocumentChange(event.document)),
      workspace.onDidCloseTextDocument((document) => this.onDocumentClose(document)),
    );
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.subscriptions.length = 0;
  }

  async provideFileDecoration(uri: Uri, token: CancellationToken): Promise<FileDecoration | undefined> {
    try {
      if (!this.accepts(uri) || token.isCancellationRequested) {
        return undefined;
      }
      const kind = await this.kindFor(uri, token);
      if (!kind || token.isCancellationRequested) {
        return undefined;
      }
      const decoration = new FileDecoration(
        kind.badge,
        this.messages[kind.tooltipKey] ?? kind.root,
        new ThemeColor(kind.colorId),
      );
      decoration.propagate = false;
      return decoration;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'EISDIR') {
        console.error(error);
      }
      return undefined;
    }
  }

  private accepts(uri: Uri): boolean {
    if (uri.scheme !== 'file' || path.extname(uri.fsPath).toLowerCase() !== '.xml') {
      return false;
    }
    return this.roots().some((root) => isInside(uri.fsPath, root));
  }

  private roots(): string[] {
    if (!this.cachedRoots) {
      this.cachedRoots = (workspace.workspaceFolders ?? [])
        .map((folder) => folder.uri.fsPath)
        .filter((root) => hasMoquiRootMarker(root));
    }
    return this.cachedRoots;
  }

  private async kindFor(uri: Uri, token: CancellationToken): Promise<FileKind | undefined> {
    const document = workspace.textDocuments.find((item) => item.uri.toString() === uri.toString());
    if (document) {
      return this.kindFromDocument(document);
    }
    const key = uri.toString();
    const stat = await fs.promises.stat(uri.fsPath);
    if (token.isCancellationRequested || !stat.isFile()) {
      return undefined;
    }
    const cached = this.diskCache.get(key);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.kind;
    }
    const text = await readPrefix(uri.fsPath, ROOT_PREFIX_LENGTH);
    if (token.isCancellationRequested) {
      return undefined;
    }
    const kind = fileKindForRoot(readRootTag(text));
    this.diskCache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, kind });
    return kind;
  }

  private kindFromDocument(document: TextDocument): FileKind | undefined {
    const key = document.uri.toString();
    const cached = this.openCache.get(key);
    if (cached && cached.version === document.version) {
      return cached.kind;
    }
    const kind = fileKindForRoot(readRootTag(documentPrefix(document)));
    this.openCache.set(key, { version: document.version, kind });
    return kind;
  }

  private onDocumentChange(document: TextDocument): void {
    if (!this.accepts(document.uri)) {
      return;
    }
    const previous = this.openCache.get(document.uri.toString())?.kind;
    const kind = this.kindFromDocument(document);
    if (previous?.root !== kind?.root) {
      this.emitter.fire(document.uri);
    }
  }

  private onDocumentClose(document: TextDocument): void {
    if (!this.accepts(document.uri)) {
      return;
    }
    this.openCache.delete(document.uri.toString());
    this.emitter.fire(document.uri);
  }

  private invalidate(uri: Uri): void {
    this.diskCache.delete(uri.toString());
    this.openCache.delete(uri.toString());
    this.emitter.fire(uri);
  }

  private refreshAll(): void {
    this.cachedRoots = undefined;
    this.diskCache.clear();
    this.openCache.clear();
    this.emitter.fire(undefined);
  }
}

function documentPrefix(document: TextDocument): string {
  let text = '';
  const lineCount = document.lineCount;
  for (let line = 0; line < lineCount && text.length < ROOT_PREFIX_LENGTH; line++) {
    text += document.lineAt(line).text;
    text += '\n';
  }
  return text.length > ROOT_PREFIX_LENGTH ? text.slice(0, ROOT_PREFIX_LENGTH) : text;
}

async function readPrefix(filePath: string, byteLength: number): Promise<string> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(byteLength);
    const { bytesRead } = await handle.read(buffer, 0, byteLength, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

function isInside(filePath: string, root: string): boolean {
  const file = normalizePath(filePath);
  const base = normalizePath(root);
  return file === base || file.startsWith(base.endsWith(path.sep) ? base : `${base}${path.sep}`);
}

function normalizePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function registerFileDecorations(messages: Record<string, string>): Disposable {
  const provider = new MoquiFileDecorationProvider(messages);
  return Disposable.from(window.registerFileDecorationProvider(provider), provider);
}

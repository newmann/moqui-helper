import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const SKIPPED_SEGMENTS = new Set(['.git', 'node_modules', 'out']);

const SKIPPED_PREFIXES = [
  'runtime/lib',
  'runtime/log',
  'runtime/db',
  'runtime/elasticsearch',
  'runtime/sessions',
  'runtime/txlog',
];

export function toPosix(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function pathKey(fsPath: string): string {
  const normalized = path.normalize(fsPath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function fsPathToUri(fsPath: string): string {
  return pathToFileURL(path.normalize(fsPath)).href;
}

export function uriToFsPath(uri: string): string {
  return path.normalize(fileURLToPath(uri));
}

export function directoryUri(uri: string): string {
  const slash = uri.lastIndexOf('/');
  return slash < 0 ? uri : uri.slice(0, slash + 1);
}

export function isInside(filePath: string, directory: string): boolean {
  const relative = path.relative(path.normalize(directory), path.normalize(filePath));
  if (relative === '') {
    return true;
  }
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function isSkippedRelative(relativePosix: string): boolean {
  const segments = relativePosix.split('/');
  if (segments.some((segment) => SKIPPED_SEGMENTS.has(segment))) {
    return true;
  }
  return SKIPPED_PREFIXES.some(
    (prefix) => relativePosix === prefix || relativePosix.startsWith(`${prefix}/`),
  );
}

export function isComponentXmlPath(filePath: string): boolean {
  const posix = toPosix(filePath);
  return (
    /(?:^|\/)framework\/component\.xml$/.test(posix) ||
    /(?:^|\/)runtime\/base-component\/[^/]+\/component\.xml$/.test(posix) ||
    /(?:^|\/)runtime\/component\/[^/]+\/component\.xml$/.test(posix)
  );
}

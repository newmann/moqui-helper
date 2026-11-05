import * as fs from 'fs';
import * as path from 'path';
import { ExtensionContext, workspace } from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

function workspaceHasMoquiMarker(): boolean {
  return (workspace.workspaceFolders ?? []).some((folder) =>
    fs.existsSync(path.join(folder.uri.fsPath, 'MoquiInit.properties')),
  );
}

export function activate(context: ExtensionContext): void {
  if (!workspaceHasMoquiMarker()) {
    return;
  }

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
  };

  client = new LanguageClient('moquiHelper', 'Moqui Helper', serverOptions, clientOptions);
  void client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}

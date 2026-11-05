import { createConnection, InitializeResult, TextDocumentSyncKind } from 'vscode-languageserver/node';

const connection = createConnection();

connection.onInitialize((): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.None,
    },
  };
});

connection.listen();

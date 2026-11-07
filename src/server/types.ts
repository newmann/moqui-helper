export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export type SymbolKind = 'entity' | 'view-entity' | 'service' | 'screen';

export interface SymbolRecord {
  kind: SymbolKind;
  name: string;
  aliases: string[];
  uri: string;
  range: Range;
}

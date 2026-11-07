export type Messages = Record<string, string>;

export function formatMessage(messages: Messages, key: string, ...args: string[]): string {
  const template = messages[key] ?? key;
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? match : value;
  });
}

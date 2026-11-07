export function nlsFileName(language: string): string {
  const id = language.toLowerCase();
  if (id === 'zh-cn' || id === 'zh-hans') {
    return 'package.nls.zh-cn.json';
  }
  return 'package.nls.json';
}

export function mergeMessages(
  fallback: Record<string, string>,
  localized: Record<string, string>,
): Record<string, string> {
  return { ...fallback, ...localized };
}

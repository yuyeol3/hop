export type DocumentFormat = 'hwp' | 'hwpx';

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function documentFormatFor(path: string): DocumentFormat {
  return path.toLowerCase().endsWith('.hwpx') ? 'hwpx' : 'hwp';
}

export function isDocumentPath(path: string): boolean {
  return /\.hwpx?$/i.test(path);
}

/** Suggested file name for a save dialog, keeping the format of the current document. */
export function suggestedName(path: string | null, extension: string): string {
  const name = path ? baseName(path).replace(/\.[^.]+$/, '') : '새 문서';
  return `${name}.${extension}`;
}

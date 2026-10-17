/**
 * File-kind detection for the preview pane.
 *
 * Everything is decided from the file name: skill packages are small and mostly
 * Markdown/YAML, so sniffing every payload would cost more than it buys.
 */

export type FileKind = 'markdown' | 'text' | 'image' | 'binary';

/** Largest file rendered as text; bigger files fall back to a notice. */
export const TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024;
/** Largest image inlined as a blob URL. */
export const IMAGE_PREVIEW_LIMIT = 20 * 1024 * 1024;
/** Largest unknown file whose bytes are inspected for control characters. */
export const SNIFF_LIMIT = 512 * 1024;

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd']);
const IMAGE_MIME_TYPES = new Map<string, string>([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['jfif', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['bmp', 'image/bmp'],
  ['ico', 'image/x-icon'],
  ['svg', 'image/svg+xml'],
  ['avif', 'image/avif'],
]);
const FONT_MIME_TYPES = new Map<string, string>([
  ['ttf', 'font/ttf'],
  ['otf', 'font/otf'],
  ['woff', 'font/woff'],
  ['woff2', 'font/woff2'],
  ['eot', 'application/vnd.ms-fontobject'],
]);
const TEXT_EXTENSIONS = new Set([
  'csv',
  'env',
  'gitignore',
  'htm',
  'html',
  'ini',
  'json',
  'json5',
  'jsonl',
  'log',
  'mjs',
  'ndjson',
  'properties',
  'ps1',
  'py',
  'rb',
  'rs',
  'sh',
  'sql',
  'svg',
  'toml',
  'ts',
  'tsv',
  'tsx',
  'txt',
  'xml',
  'yaml',
  'yml',
  // Programming languages / config formats that show up in agent skills.
  'bat',
  'c',
  'cfg',
  'conf',
  'cpp',
  'cs',
  'css',
  'dockerfile',
  'go',
  'h',
  'java',
  'js',
  'jsx',
  'kt',
  'lua',
  'php',
  'pl',
  'r',
  'rst',
  'scss',
  'swift',
  'vue',
  'zsh',
]);
const BINARY_EXTENSIONS = new Set([
  '7z',
  'avi',
  'bin',
  'class',
  'db',
  'dll',
  'dmg',
  'doc',
  'docx',
  'eot',
  'exe',
  'flac',
  'gz',
  'ico',
  'jar',
  'mov',
  'mp3',
  'mp4',
  'o',
  'otf',
  'pdf',
  'ppt',
  'pptx',
  'so',
  'sqlite',
  'tar',
  'ttf',
  'wav',
  'webm',
  'woff',
  'woff2',
  'xls',
  'xlsx',
  'zip',
]);

/** Lower-case extension without the dot; `''` when the name has none. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Classify a file for preview.
 *
 * `bytes` is optional and only consulted for extensions that are neither known
 * text nor known binary, so extension-less files still preview sensibly.
 */
export function detectFileKind(path: string, bytes?: Uint8Array): FileKind {
  const extension = extensionOf(path);

  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown';
  if (IMAGE_MIME_TYPES.has(extension)) return 'image';
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  if (BINARY_EXTENSIONS.has(extension)) return 'binary';

  if (bytes && bytes.length > 0) return looksLikeText(bytes) ? 'text' : 'binary';
  // Extension-less names such as `LICENSE`, `Makefile` or `Dockerfile`.
  return extension === '' ? 'text' : 'binary';
}

/** Best-effort MIME type for a path, used for blobs and downloads. */
export function mimeForPath(path: string): string {
  const extension = extensionOf(path);
  const image = IMAGE_MIME_TYPES.get(extension);
  if (image) return image;
  const font = FONT_MIME_TYPES.get(extension);
  if (font) return font;
  switch (extension) {
    case 'md':
    case 'markdown':
      return 'text/markdown';
    case 'json':
      return 'application/json';
    case 'yaml':
    case 'yml':
      return 'text/yaml';
    case 'svg':
      return 'image/svg+xml';
    case 'html':
    case 'htm':
      return 'text/html';
    case 'csv':
      return 'text/csv';
    case 'pdf':
      return 'application/pdf';
    case 'zip':
      return 'application/zip';
    default:
      return 'text/plain';
  }
}

/** Heuristic: short sample free of NUL bytes and most control characters. */
export function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, SNIFF_LIMIT));
  if (sample.length === 0) return true;
  let suspicious = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const byte = sample[i];
    if (byte === 0) return false;
    // Allow tab, newline, carriage return and everything printable.
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) suspicious += 1;
  }
  return suspicious / sample.length < 0.02;
}

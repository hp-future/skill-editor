import { describe, expect, it } from 'vitest';
import { detectFileKind, extensionOf, looksLikeText, mimeForPath } from '../lib/fileKind';

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('extensionOf', () => {
  it('extracts a lower-case extension', () => {
    expect(extensionOf('references/api-index.MD')).toBe('md');
    expect(extensionOf('agents/openai.yaml')).toBe('yaml');
  });

  it('returns an empty string for names without a usable extension', () => {
    expect(extensionOf('LICENSE')).toBe('');
    expect(extensionOf('archive.')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('deep/nested/path')).toBe('');
  });
});

describe('detectFileKind', () => {
  it('classifies by extension', () => {
    expect(detectFileKind('SKILL.md')).toBe('markdown');
    expect(detectFileKind('references/readme.markdown')).toBe('markdown');
    expect(detectFileKind('agents/openai.yaml')).toBe('text');
    expect(detectFileKind('scripts/run.ps1')).toBe('text');
    expect(detectFileKind('assets/logo.png')).toBe('image');
    expect(detectFileKind('assets/icon.svg')).toBe('image');
    expect(detectFileKind('bin/tool.exe')).toBe('binary');
    expect(detectFileKind('docs/report.docx')).toBe('binary');
  });

  it('sniffs extension-less files', () => {
    expect(detectFileKind('LICENSE')).toBe('text');
    expect(detectFileKind('Makefile', bytesOf('all:\n\techo hi\n'))).toBe('text');
    expect(detectFileKind('blob', new Uint8Array([0, 1, 2, 3]))).toBe('binary');
  });

  it('treats unknown extensions as binary without a sample', () => {
    expect(detectFileKind('data.xyz')).toBe('binary');
    expect(detectFileKind('data.xyz', bytesOf('plain text'))).toBe('text');
  });
});

describe('looksLikeText', () => {
  it('accepts UTF-8 text and rejects NUL bytes', () => {
    expect(looksLikeText(bytesOf('中文内容\n第二行'))).toBe(true);
    expect(looksLikeText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(false);
  });
});

describe('mimeForPath', () => {
  it('maps common extensions', () => {
    expect(mimeForPath('a/b.md')).toBe('text/markdown');
    expect(mimeForPath('a/b.png')).toBe('image/png');
    expect(mimeForPath('a/b.jpeg')).toBe('image/jpeg');
    expect(mimeForPath('a/b.json')).toBe('application/json');
    expect(mimeForPath('a/b.yaml')).toBe('text/yaml');
    expect(mimeForPath('a/b.unknown')).toBe('text/plain');
  });
});

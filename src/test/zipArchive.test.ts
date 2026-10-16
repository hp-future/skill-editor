import { describe, expect, it } from 'vitest';
import { CompressionMethod, parseZipArchive, ZipFormatError } from '../lib/zip/zipArchive';
import { createZip } from './zipCreator';

const encoder = new TextEncoder();

describe('parseZipArchive', () => {
  it('reads the central directory of deflated entries', async () => {
    const archive = parseZipArchive(
      createZip([
        { name: 'api-call-by-knowledge/SKILL.md', content: '# Title\n\nBody' },
        { name: 'api-call-by-knowledge/references/api-index.md', content: 'index' },
      ]),
    );

    expect(archive.entries.map((entry) => entry.path)).toEqual([
      'api-call-by-knowledge/SKILL.md',
      'api-call-by-knowledge/references/api-index.md',
    ]);
    expect(archive.entries[0].name).toBe('SKILL.md');
    expect(archive.entries[0].compression).toBe(CompressionMethod.Deflated);
    expect(archive.entries[0].isDirectory).toBe(false);
    expect(await archive.readText(archive.entries[0])).toBe('# Title\n\nBody');
  });

  it('reads stored entries byte for byte', async () => {
    const binary = new Uint8Array([0, 1, 2, 250, 251, 252]);
    const archive = parseZipArchive(
      createZip([{ name: 'assets/blob.bin', content: binary, stored: true }]),
    );

    expect(archive.entries[0].compression).toBe(CompressionMethod.Stored);
    expect(Array.from(await archive.readEntry(archive.entries[0]))).toEqual(
      Array.from(binary),
    );
  });

  it('handles streamed entries that use a data descriptor', async () => {
    const archive = parseZipArchive(
      createZip([{ name: 'stream.txt', content: 'streamed payload', dataDescriptor: true }]),
    );

    expect(archive.entries).toHaveLength(1);
    expect(await archive.readText(archive.entries[0])).toBe('streamed payload');
  });

  it('keeps explicit directory records and decodes UTF-8 names', () => {
    const archive = parseZipArchive(
      createZip([
        { name: '技能包/', directory: true },
        { name: '技能包/说明.md', content: '内容' },
      ]),
    );

    expect(archive.entries[0].isDirectory).toBe(true);
    expect(archive.entries[0].path).toBe('技能包/');
    expect(archive.entries[1].path).toBe('技能包/说明.md');
    expect(archive.entries[1].name).toBe('说明.md');
    expect(archive.entries[1].size).toBe(encoder.encode('内容').length);
  });

  it('rejects archives without an end-of-central-directory record', () => {
    expect(() => parseZipArchive(new Uint8Array(64))).toThrow(ZipFormatError);
  });

  it('rejects files that are too small to be archives', () => {
    expect(() => parseZipArchive(new Uint8Array(4))).toThrow(/too small/i);
  });

  it('exposes payloads as blobs', async () => {
    const archive = parseZipArchive(createZip([{ name: 'a.txt', content: 'hello' }]));
    const blob = await archive.readBlob(archive.entries[0], 'text/plain');
    expect(blob.type).toBe('text/plain');
    expect(await blob.text()).toBe('hello');
  });
});

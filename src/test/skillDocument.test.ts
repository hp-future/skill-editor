import { describe, expect, it } from 'vitest';
import { SkillDocument } from '../lib/document/skillDocument';
import { parseZipArchive } from '../lib/zip/zipArchive';
import { createZip } from './zipCreator';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function sourceBytes() {
  return createZip([
    { name: 'api-call-by-knowledge/SKILL.md', content: '# 旧标题\n\n旧内容\n' },
    { name: 'api-call-by-knowledge/references/api-index.md', content: '# 索引\n' },
    { name: 'api-call-by-knowledge/agents/openai.yaml', content: 'interface:\n  display_name: 旧\n' },
  ]);
}

const readText = async (bytes: Uint8Array, path: string): Promise<string> => {
  const archive = parseZipArchive(bytes);
  const entry = archive.entries.find((item) => item.path === path);
  if (!entry) throw new Error(`missing ${path}`);
  return decoder.decode(await archive.readEntry(entry));
};

describe('SkillDocument', () => {
  it('starts clean and reads the archive contents', async () => {
    const document = SkillDocument.fromBytes(sourceBytes(), { fileName: 'demo.zip' });

    expect(document.hasUnsavedChanges).toBe(false);
    expect(document.dirtyCount).toBe(0);
    expect(decoder.decode(await document.read('api-call-by-knowledge/SKILL.md'))).toBe(
      '# 旧标题\n\n旧内容\n',
    );
  });

  it('resolves tree-relative paths to archive paths', () => {
    const document = SkillDocument.fromBytes(sourceBytes());

    expect(document.pathToArchive('SKILL.md')).toBe('api-call-by-knowledge/SKILL.md');
    expect(document.pathToArchive('references/api-index.md')).toBe(
      'api-call-by-knowledge/references/api-index.md',
    );
    expect(document.pathToArchive('api-call-by-knowledge/SKILL.md')).toBe(
      'api-call-by-knowledge/SKILL.md',
    );
    expect(document.pathToArchive('nope.md')).toBeUndefined();
  });

  it('records edits and reverts them', async () => {
    const document = SkillDocument.fromBytes(sourceBytes());

    document.write('SKILL.md', '# 新标题\n');
    expect(document.hasUnsavedChanges).toBe(true);
    expect(document.dirtyCount).toBe(1);
    expect(document.isDirty('api-call-by-knowledge/SKILL.md')).toBe(true);
    expect(document.getEdit('SKILL.md')?.text).toBe('# 新标题\n');
    expect(decoder.decode(await document.read('SKILL.md'))).toBe('# 新标题\n');

    document.revert('SKILL.md');
    expect(document.hasUnsavedChanges).toBe(false);
    expect(decoder.decode(await document.read('SKILL.md'))).toBe('# 旧标题\n\n旧内容\n');
  });

  it('rejects writes to unknown files', () => {
    const document = SkillDocument.fromBytes(sourceBytes());
    expect(() => document.write('missing.md', 'x')).toThrow(/找不到文件/);
  });

  it('exports untouched entries byte-for-byte and edits the changed one', async () => {
    const bytes = sourceBytes();
    const document = SkillDocument.fromBytes(bytes, { fileName: 'api-call-by-knowledge.zip' });
    document.write('SKILL.md', '# 新标题\n\n新内容\n');

    const result = await document.exportArchive();

    expect(result.fileName).toBe('api-call-by-knowledge-edited.zip');
    expect(result.stats.modified).toBe(1);
    expect(result.stats.files).toBe(3);
    expect(result.warnings[0]).toMatch(/extra field/);

    const exported = new Uint8Array(await result.blob.arrayBuffer());
    expect(await readText(exported, 'api-call-by-knowledge/SKILL.md')).toBe('# 新标题\n\n新内容\n');
    expect(await readText(exported, 'api-call-by-knowledge/references/api-index.md')).toBe('# 索引\n');
    expect(await readText(exported, 'api-call-by-knowledge/agents/openai.yaml')).toContain('旧');

    // The untouched entry keeps its original compressed bytes and CRC.
    const before = parseZipArchive(bytes);
    const after = parseZipArchive(exported);
    const untouched = (archive: ReturnType<typeof parseZipArchive>, path: string) =>
      archive.entries.find((entry) => entry.path === path);
    expect(untouched(after, 'api-call-by-knowledge/references/api-index.md')?.crc32).toBe(
      untouched(before, 'api-call-by-knowledge/references/api-index.md')?.crc32,
    );
    expect(untouched(after, 'api-call-by-knowledge/references/api-index.md')?.compressedSize).toBe(
      untouched(before, 'api-call-by-knowledge/references/api-index.md')?.compressedSize,
    );
  });

  it('exports an archive with no edits without losing entries', async () => {
    const document = SkillDocument.fromBytes(sourceBytes(), { fileName: 'demo.zip' });
    const result = await document.exportArchive();

    expect(result.stats.modified).toBe(0);
    expect(result.warnings.some((warning) => warning.includes('没有任何内容改动'))).toBe(true);

    const exported = new Uint8Array(await result.blob.arrayBuffer());
    const archive = parseZipArchive(exported);
    expect(archive.entries.map((entry) => entry.path).sort()).toEqual([
      'api-call-by-knowledge/SKILL.md',
      'api-call-by-knowledge/agents/openai.yaml',
      'api-call-by-knowledge/references/api-index.md',
    ]);
  });

  it('supports a custom export file name and progress reporting', async () => {
    const document = SkillDocument.fromBytes(sourceBytes(), { fileName: 'demo.zip' });
    const seen: number[] = [];

    const result = await document.exportArchive({
      fileName: 'custom.zip',
      onProgress: (written) => seen.push(written),
    });

    expect(result.fileName).toBe('custom.zip');
    expect(seen).toEqual([1, 2, 3]);
  });

  it('exposes entries with a stripped prefix for the collapsed tree', () => {
    const document = SkillDocument.fromBytes(sourceBytes());
    const entries = document.entries({ prefixToStrip: 'api-call-by-knowledge' });

    expect(entries.map((entry) => entry.path)).toEqual([
      'SKILL.md',
      'references/api-index.md',
      'agents/openai.yaml',
    ]);
    // The original record stays reachable for payload reads.
    expect(entries[0].zipEntry?.path).toBe('api-call-by-knowledge/SKILL.md');
  });

  it('round-trips through a File object', async () => {
    const bytes = sourceBytes();
    const file = new File([bytes as BlobPart], 'api-call-by-knowledge.zip', {
      type: 'application/zip',
    });
    const document = await SkillDocument.fromBlob(file);
    expect(document.sourceFileName).toBe('api-call-by-knowledge.zip');

    document.write('SKILL.md', '# 来自 File\n');
    const result = await document.exportArchive();
    const exported = new Uint8Array(await result.blob.arrayBuffer());
    expect(await readText(exported, 'api-call-by-knowledge/SKILL.md')).toBe('# 来自 File\n');
  });

  it('reverts every edit when called without a path', () => {
    const document = SkillDocument.fromBytes(sourceBytes());
    document.write('SKILL.md', 'a');
    document.write('references/api-index.md', 'b');
    expect(document.dirtyCount).toBe(2);

    document.revert();
    expect(document.dirtyCount).toBe(0);
    expect(document.dirtyPaths).toEqual([]);
  });

  it('encodes edits as UTF-8', async () => {
    const document = SkillDocument.fromBytes(sourceBytes());
    document.write('agents/openai.yaml', 'interface:\n  display_name: 新名字 🎯\n');

    const result = await document.exportArchive();
    const exported = new Uint8Array(await result.blob.arrayBuffer());
    const text = await readText(exported, 'api-call-by-knowledge/agents/openai.yaml');
    expect(text).toContain('新名字 🎯');

    const archive = parseZipArchive(exported);
    const entry = archive.entries.find((item) => item.path.endsWith('openai.yaml'));
    expect(entry?.size).toBe(encoder.encode(text).length);
  });
});

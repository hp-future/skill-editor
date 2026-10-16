import { describe, expect, it } from 'vitest';
import { loadSkillArchive } from '../lib/loadSkillArchive';
import { createZipFile } from './zipCreator';

const MANIFEST = [
  '---',
  'name: api-call-by-knowledge',
  'description: "根据用户的自然语言业务请求读取 api-wiki 接口定义。"',
  '---',
  '',
  '# API 知识库调用规划',
  '',
  '把用户的自然语言业务请求转换成可执行的 API 任务配置。',
].join('\n');

describe('loadSkillArchive', () => {
  it('unwraps the single top-level folder and summarises SKILL.md', async () => {
    const file = createZipFile(
      [
        { name: 'api-call-by-knowledge/SKILL.md', content: MANIFEST },
        { name: 'api-call-by-knowledge/references/api-index.md', content: '索引' },
        { name: 'api-call-by-knowledge/agents/openai.yaml', content: 'interface: {}' },
      ],
      'api-call-by-knowledge.zip',
    );

    const result = await loadSkillArchive(file);

    expect(result.tree.rootName).toBe('api-call-by-knowledge');
    expect(result.tree.children.map((node) => node.name)).toEqual([
      'agents',
      'references',
      'SKILL.md',
    ]);
    expect(result.tree.fileCount).toBe(3);
    expect(result.hasManifest).toBe(true);
    expect(result.manifest?.title).toBe('api-call-by-knowledge');
    expect(result.manifest?.path).toBe('SKILL.md');
  });

  it('keeps the real root when the archive has multiple top-level entries', async () => {
    const file = createZipFile(
      [
        { name: 'SKILL.md', content: MANIFEST },
        { name: 'references/api-index.md', content: '索引' },
      ],
      'flat-package.zip',
    );

    const result = await loadSkillArchive(file);

    expect(result.tree.rootName).toBe('flat-package');
    expect(result.tree.children.map((node) => node.name)).toEqual(['references', 'SKILL.md']);
    expect(result.manifest?.path).toBe('SKILL.md');
  });

  it('reports archives without a manifest', async () => {
    const file = createZipFile([{ name: 'notes.txt', content: 'hello' }], 'notes.zip');
    const result = await loadSkillArchive(file);

    expect(result.hasManifest).toBe(false);
    expect(result.manifest).toBeUndefined();
    expect(result.tree.fileCount).toBe(1);
  });

  it('still reads a single wrapper folder without a manifest', async () => {
    const file = createZipFile(
      [{ name: 'pkg/data/records.json', content: '[]' }],
      'pkg.zip',
    );
    const result = await loadSkillArchive(file);

    expect(result.tree.rootName).toBe('pkg');
    expect(result.tree.byPath.has('data/records.json')).toBe(true);
    expect(result.tree.byPath.has('pkg/data/records.json')).toBe(false);
  });
});

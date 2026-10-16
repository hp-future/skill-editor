import { describe, expect, it } from 'vitest';
import { parseZipArchive } from '../lib/zip/zipArchive';
import type { ZipEntry } from '../lib/zip/zipArchive';
import { loadSkillArchive } from '../lib/loadSkillArchive';
import {
  ancestorPaths,
  buildSkillTree,
  defaultExpandedPaths,
  flattenTree,
  type SkillFolderNode,
  type SkillTree,
} from '../lib/skillTree';
import { createZip, createZipFile, type TestZipEntry } from './zipCreator';

/** Parse an archive the way `loadSkillArchive` does, including the wrapper folder. */
async function treeOf(
  entries: readonly TestZipEntry[],
  fileName = 'skill.zip',
): Promise<SkillTree> {
  return (await loadSkillArchive(createZipFile(entries, fileName))).tree;
}

/** Parse without collapsing the wrapper folder, to check raw path handling. */
function rawTreeOf(entries: readonly TestZipEntry[], rootName = 'archive'): SkillTree {
  return buildSkillTree(parseZipArchive(createZip(entries)).entries, { rootName });
}

function folderPaths(tree: SkillTree): string[] {
  return tree.all.filter((node) => node.kind === 'folder').map((node) => node.path);
}

describe('buildSkillTree', () => {
  it('synthesises folders from nested file paths', async () => {
    const tree = await treeOf([
      { name: 'skill/SKILL.md', content: 'x' },
      { name: 'skill/references/api-index.md', content: 'yy' },
    ]);

    expect(tree.rootName).toBe('skill');
    expect(tree.children.map((node) => node.name)).toEqual(['references', 'SKILL.md']);
    expect(folderPaths(tree)).toEqual(['references']);
    expect(tree.fileCount).toBe(2);
    expect(tree.folderCount).toBe(1);
    expect(tree.totalSize).toBe(3);
    // `byPath` indexes every node by its archive-relative path.
    expect([...tree.byPath.keys()].sort()).toEqual([
      'SKILL.md',
      'references',
      'references/api-index.md',
    ]);
    expect(tree.byPath.get('references/api-index.md')?.kind).toBe('file');
  });

  it('merges explicit directory records with implied folders', async () => {
    const tree = await treeOf([
      { name: 'skill/empty/', directory: true },
      { name: 'skill/docs/', directory: true },
      { name: 'skill/docs/readme.md', content: 'hi' },
    ]);

    const docs = tree.byPath.get('docs') as SkillFolderNode;
    expect(docs.kind).toBe('folder');
    expect(docs.explicit).toBe(true);
    expect(docs.children.map((node) => node.name)).toEqual(['readme.md']);

    const empty = tree.byPath.get('empty') as SkillFolderNode;
    expect(empty.children).toHaveLength(0);
    expect(empty.explicit).toBe(true);
  });

  it('sorts folders first, then names naturally', async () => {
    const tree = await treeOf([
      { name: 'skill/b.txt', content: '' },
      { name: 'skill/folder/inner.txt', content: '' },
      { name: 'skill/a.txt', content: '' },
      { name: 'skill/page10.md', content: '' },
      { name: 'skill/page2.md', content: '' },
    ]);

    expect(tree.children.map((node) => node.name)).toEqual([
      'folder',
      'a.txt',
      'b.txt',
      'page2.md',
      'page10.md',
    ]);
  });

  it('keeps the last record when a path repeats', async () => {
    const tree = await treeOf([
      { name: 'skill/dup.txt', content: 'first' },
      { name: 'skill/dup.txt', content: 'second-longer' },
    ]);

    expect(tree.fileCount).toBe(1);
    expect(tree.byPath.get('dup.txt')?.kind).toBe('file');
  });

  it('ignores entries that resolve to the archive root', () => {
    const tree = rawTreeOf([
      { name: 'skill/', directory: true },
      { name: 'skill/file.txt', content: 'x' },
    ]);

    expect(tree.children.map((node) => node.name)).toEqual(['skill']);
    expect(tree.children[0]?.kind).toBe('folder');
    expect((tree.children[0] as SkillFolderNode).children.map((node) => node.name)).toEqual([
      'file.txt',
    ]);
  });

  it('reports an empty archive as an empty tree', () => {
    const tree = rawTreeOf([]);
    expect(tree.children).toEqual([]);
    expect(tree.fileCount).toBe(0);
    expect(tree.folderCount).toBe(0);
  });
});

describe('defaultExpandedPaths', () => {
  it('expands the requested number of levels', async () => {
    const tree = await treeOf([
      { name: 'skill/a/b/deep.txt', content: '' },
      { name: 'skill/c.txt', content: '' },
    ]);

    expect(defaultExpandedPaths(tree, 1)).toEqual(['a']);
    expect(defaultExpandedPaths(tree, 2)).toEqual(['a', 'a/b']);
  });
});

describe('flattenTree', () => {
  it('hides the children of collapsed folders', async () => {
    const tree = await treeOf([
      { name: 'skill/refs/a.md', content: '' },
      { name: 'skill/top.md', content: '' },
    ]);

    const collapsed = flattenTree(tree, () => false);
    expect(collapsed.map((row) => row.node.path)).toEqual(['refs', 'top.md']);
    expect(collapsed[0].expanded).toBe(false);

    const expanded = flattenTree(tree, (path) => path === 'refs');
    expect(expanded.map((row) => row.node.path)).toEqual(['refs', 'refs/a.md', 'top.md']);
    expect(expanded.map((row) => row.depth)).toEqual([0, 1, 0]);
  });
});

describe('ancestorPaths', () => {
  it('lists each parent folder outermost first', () => {
    expect(ancestorPaths('a/b/c/file.md')).toEqual(['a', 'a/b', 'a/b/c']);
    expect(ancestorPaths('file.md')).toEqual([]);
  });
});

describe('manifest helpers', () => {
  const entry = (path: string, size = 100): ZipEntry => ({
    path,
    pathLower: path.toLowerCase(),
    name: path.split('/').pop() ?? path,
    isDirectory: false,
    size,
    compressedSize: size,
    crc32: 0,
    compression: 0,
    dosDateTime: null,
    localHeaderOffset: 0,
    flags: 0,
  });

  it('prefers a root manifest over a nested one', async () => {
    const { findSkillManifest } = await import('../lib/skillManifest');
    expect(findSkillManifest([entry('pkg/SKILL.md'), entry('SKILL.md')])?.path).toBe('SKILL.md');
    expect(findSkillManifest([entry('pkg/nested/SKILL.md'), entry('pkg/SKILL.md')])?.path).toBe(
      'pkg/SKILL.md',
    );
    expect(findSkillManifest([entry('README.md')])).toBeUndefined();
  });

  it('extracts title, description and frontmatter', async () => {
    const { summarizeManifest } = await import('../lib/skillManifest');
    const summary = summarizeManifest(
      entry('SKILL.md'),
      [
        '---',
        'name: api-call-by-knowledge',
        'description: "查询接口"',
        '---',
        '',
        '# 标题',
        '',
        '正文段落。',
      ].join('\n'),
    );

    expect(summary.frontmatter.name).toBe('api-call-by-knowledge');
    expect(summary.title).toBe('api-call-by-knowledge');
    expect(summary.description).toBe('查询接口');
  });

  it('falls back to the body of a manifest without frontmatter', async () => {
    const { summarizeManifest } = await import('../lib/skillManifest');
    const summary = summarizeManifest(
      entry('SKILL.md'),
      '# 无头文档\n\n第一段说明文字。\n\n第二段。',
    );

    expect(summary.frontmatter).toEqual({});
    expect(summary.title).toBe('无头文档');
    expect(summary.description).toBe('第一段说明文字。');
  });
});

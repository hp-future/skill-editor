import { describe, expect, it } from 'vitest';
import { normalizeArchivePath, resolveLinkTarget } from '../lib/linkTarget';

describe('normalizeArchivePath', () => {
  it('resolves relative references against the document directory', () => {
    expect(normalizeArchivePath('references/api-index.md', 'SKILL.md')).toBe(
      'references/api-index.md',
    );
    expect(normalizeArchivePath('api-index.md', 'references/task-mapping.md')).toBe(
      'references/api-index.md',
    );
    expect(normalizeArchivePath('./field-dictionary.md', 'references/task-mapping.md')).toBe(
      'references/field-dictionary.md',
    );
  });

  it('walks up with ../ and never escapes the package root', () => {
    expect(normalizeArchivePath('../SKILL.md', 'references/api-index.md')).toBe('SKILL.md');
    expect(normalizeArchivePath('../../SKILL.md', 'references/api-index.md')).toBe('SKILL.md');
    expect(normalizeArchivePath('../outside.md', 'SKILL.md')).toBe('outside.md');
  });

  it('treats a leading slash as out of scope', () => {
    expect(resolveLinkTarget('/references/api-index.md', 'SKILL.md').kind).toBe('out-of-scope');
  });

  it('normalises backslashes and redundant segments', () => {
    expect(normalizeArchivePath('references\\api-index.md', 'SKILL.md')).toBe(
      'references/api-index.md',
    );
    expect(normalizeArchivePath('a//b/./c.md', 'SKILL.md')).toBe('a/b/c.md');
  });

  it('rejects references that resolve nowhere', () => {
    expect(normalizeArchivePath('', 'SKILL.md')).toBeNull();
    expect(normalizeArchivePath('.', 'SKILL.md')).toBeNull();
    // `./` from a nested file is that file's directory, kept as a folder path.
    expect(normalizeArchivePath('./', 'references/a.md')).toBe('references/');
    expect(normalizeArchivePath('../../..', 'references/a.md')).toBeNull();
  });
});

describe('resolveLinkTarget', () => {
  it('classifies same-document anchors', () => {
    expect(resolveLinkTarget('#核心约束', 'SKILL.md')).toEqual({
      kind: 'anchor',
      path: 'SKILL.md',
      fragment: '核心约束',
    });
    expect(resolveLinkTarget('#', 'SKILL.md')).toEqual({
      kind: 'anchor',
      path: 'SKILL.md',
      fragment: null,
    });
  });

  it('classifies in-package file links', () => {
    expect(resolveLinkTarget('references/api-index.md', 'SKILL.md')).toEqual({
      kind: 'internal',
      path: 'references/api-index.md',
      fragment: null,
    });
    expect(resolveLinkTarget('field-dictionary.md#字段', 'references/api-index.md')).toEqual({
      kind: 'internal',
      path: 'references/field-dictionary.md',
      fragment: '字段',
    });
  });

  it('decodes percent-encoded paths and fragments', () => {
    expect(resolveLinkTarget('references/api%2Dindex.md', 'SKILL.md').path).toBe(
      'references/api-index.md',
    );
    expect(resolveLinkTarget('a.md#%E6%A0%87%E9%A2%98', 'SKILL.md').fragment).toBe('标题');
  });

  it('classifies external links', () => {
    for (const href of [
      'https://example.com/a.md',
      'http://example.com',
      'mailto:someone@example.com',
      '//example.com/a.md',
    ]) {
      expect(resolveLinkTarget(href, 'SKILL.md')).toEqual({
        kind: 'external',
        path: '',
        fragment: null,
      });
    }
  });

  it('reports references it cannot navigate to', () => {
    expect(resolveLinkTarget('', 'SKILL.md').kind).toBe('out-of-scope');
    expect(resolveLinkTarget('?q=1', 'SKILL.md').kind).toBe('out-of-scope');
    expect(resolveLinkTarget('references/', 'SKILL.md').kind).toBe('out-of-scope');
    expect(resolveLinkTarget('%E0%A4%A', 'SKILL.md').kind).toBe('out-of-scope');
  });

  it('flags a leading-slash target as out of scope', () => {
    // It normalises to a plausible package path, which is exactly why it must
    // be marked: the preview would otherwise probe a path outside the package.
    expect(resolveLinkTarget('/etc/passwd', 'SKILL.md')).toEqual({
      kind: 'out-of-scope',
      path: '',
      fragment: null,
    });
  });

  it('drops dangerous schemes at the markdown layer, so they never reach here', () => {
    // `javascript:` is treated as a scheme and therefore "external"; the
    // renderer removes such links before they are rendered at all.
    expect(resolveLinkTarget('javascript:alert(1)', 'SKILL.md').kind).toBe('external');
  });
});

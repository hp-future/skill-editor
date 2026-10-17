import { describe, expect, it, vi } from 'vitest';
import {
  byExtension,
  describePreviewFile,
  findPreviewer,
  type FilePreviewer,
} from '../components/SkillEditor';
import { mimeForPath } from '../lib/fileKind';

const makePreviewer = (id: string, match: FilePreviewer['match']): FilePreviewer => ({
  id,
  match,
  render: () => null,
});

describe('describePreviewFile', () => {
  it('describes a path the way previewers need it', () => {
    expect(describePreviewFile('fonts/SkillDemo.ttf', 2280)).toEqual({
      path: 'fonts/SkillDemo.ttf',
      name: 'SkillDemo.ttf',
      extension: 'ttf',
      kind: 'binary',
      size: 2280,
    });
  });

  it('reports an empty extension for extensionless names', () => {
    expect(describePreviewFile('LICENSE', 12).extension).toBe('');
    expect(describePreviewFile('LICENSE', 12).kind).toBe('text');
  });

  it('classifies formats the built-in previews cannot render', () => {
    expect(describePreviewFile('a/b.pdf', 1).kind).toBe('binary');
    expect(describePreviewFile('a/b.ttf', 1).kind).toBe('binary');
  });
});

describe('mimeForPath', () => {
  it('knows the font MIME types', () => {
    expect(mimeForPath('fonts/SkillDemo.ttf')).toBe('font/ttf');
    expect(mimeForPath('fonts/SkillDemo.otf')).toBe('font/otf');
    expect(mimeForPath('fonts/SkillDemo.woff')).toBe('font/woff');
    expect(mimeForPath('fonts/SkillDemo.woff2')).toBe('font/woff2');
  });
});

describe('byExtension', () => {
  it('matches the listed extensions case-insensitively', () => {
    const match = byExtension('ttf', '.OTF');
    expect(match(describePreviewFile('a/B.ttf', 1))).toBe(true);
    expect(match(describePreviewFile('a/b.otf', 1))).toBe(true);
    expect(match(describePreviewFile('a/b.png', 1))).toBe(false);
    expect(match(describePreviewFile('a/b', 1))).toBe(false);
  });
});

describe('findPreviewer', () => {
  it('returns the first previewer that claims the file', () => {
    const font = makePreviewer('font', byExtension('ttf'));
    const fallback = makePreviewer('all', () => true);
    expect(findPreviewer([font, fallback], describePreviewFile('a.ttf', 1))?.id).toBe('font');
    expect(findPreviewer([font, fallback], describePreviewFile('a.pdf', 1))?.id).toBe('all');
  });

  it('returns undefined when nothing matches or nothing is registered', () => {
    expect(findPreviewer([], describePreviewFile('a.ttf', 1))).toBeUndefined();
    expect(findPreviewer(undefined, describePreviewFile('a.ttf', 1))).toBeUndefined();
    expect(
      findPreviewer([makePreviewer('font', byExtension('ttf'))], describePreviewFile('a.md', 1)),
    ).toBeUndefined();
  });

  it('keeps the editor alive when a matcher throws', () => {
    const throwing = makePreviewer('boom', () => {
      throw new Error('bad matcher');
    });
    const font = makePreviewer('font', byExtension('ttf'));
    // The throwing entry is skipped rather than propagating.
    expect(findPreviewer([throwing, font], describePreviewFile('a.ttf', 1))?.id).toBe('font');
  });

  it('calls matchers in registration order and stops at the first hit', () => {
    const first = vi.fn(() => false);
    const second = vi.fn(() => true);
    const third = vi.fn(() => true);
    findPreviewer([makePreviewer('1', first), makePreviewer('2', second), makePreviewer('3', third)], describePreviewFile('a.ttf', 1));
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(third).not.toHaveBeenCalled();
  });
});

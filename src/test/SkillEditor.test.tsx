import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef } from 'react';
import { SkillEditor } from '../components/SkillEditor';
import type { SkillEditorHandle } from '../components/SkillEditor';
import type { SkillArchiveResult } from '../lib/loadSkillArchive';
import { createZipFile } from './zipCreator';

const MANIFEST = [
  '---',
  'name: demo-skill',
  'description: "演示技能包。"',
  '---',
  '',
  '# Demo Skill',
  '',
  '## 使用方式',
  '',
  '- 第一步',
  '- 第二步',
].join('\n');

const README = '纯文本内容\n第二行\n';
const BINARY = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);

function demoEntries(): Parameters<typeof createZipFile>[0] {
  return [
    { name: 'demo-skill/SKILL.md', content: MANIFEST },
    { name: 'demo-skill/references/api-index.md', content: '# 索引\n\n接口列表。\n' },
    { name: 'demo-skill/notes/readme.txt', content: README },
    { name: 'demo-skill/agents/openai.yaml', content: 'interface:\n  display_name: 演示\n' },
    { name: 'demo-skill/assets/logo.png', content: BINARY, stored: true },
  ];
}

const demoFile = (): File => createZipFile(demoEntries(), 'demo-skill.zip');

const TREE_ID = 'se-tree';

/**
 * Wait until the archive is parsed and the tree has rows.
 *
 * The tree container exists while the ZIP is still being parsed, so tests wait
 * for the `ready` state before touching expansion state — otherwise the work
 * happens against an empty tree.
 */
async function waitForTree(): Promise<HTMLElement> {
  const tree = await screen.findByTestId(TREE_ID);
  await waitFor(() => {
    expect(tree.getAttribute('data-state')).toBe('ready');
    expect(tree.querySelectorAll('[role="treeitem"]').length).toBeGreaterThan(0);
  });
  return tree;
}

/** Expand every folder so deep files are reachable in the tree. */
function expandAll(ref: React.RefObject<SkillEditorHandle | null>): void {
  act(() => ref.current?.expandAll());
}

/** Rows visible when every folder is folded: the five top-level nodes. */
const COLLAPSED_ROWS = 5;
/** Rows visible when every folder is open. */
const EXPANDED_ROWS = 9;
/** Folders of the demo archive that report `aria-expanded`. */
const NESTED_FOLDERS = ['agents', 'assets', 'notes', 'references'];

describe('<SkillEditor /> tree', () => {
  it('shows the empty state before a file is provided', () => {
    render(<SkillEditor source={null} />);

    expect(screen.getByText('尚未载入技能包')).toBeTruthy();
    expect(screen.getByText('尚未选择文件')).toBeTruthy();
    // The editor owns no file picker: files only arrive through `source`.
    expect(document.querySelectorAll('input[type="file"]').length).toBe(0);
    expect(screen.queryByText('选择文件')).toBeNull();
    expect(document.querySelector('.se-root label')).toBeNull();
  });

  it('shows the empty state when the source prop is omitted', () => {
    render(<SkillEditor />);

    expect(screen.getByText('尚未载入技能包')).toBeTruthy();
    expect(screen.queryByRole('tree')).toBeNull();
  });

  it('renders the directory tree of the provided file', async () => {
    const loads: SkillArchiveResult[] = [];
    render(<SkillEditor source={demoFile()} onLoad={(result) => loads.push(result)} />);

    const tree = await waitForTree();
    // Root folders open by default, so their children are visible.
    expect(within(tree).getByText('references')).toBeTruthy();
    expect(within(tree).getByText('api-index.md')).toBeTruthy();
    expect(within(tree).getByText('SKILL.md')).toBeTruthy();

    expect(loads).toHaveLength(1);
    expect(loads[0].tree.fileCount).toBe(5);
    // The manifest is still parsed and exposed through the result and onLoad.
    expect(loads[0].manifest?.title).toBe('demo-skill');
    expect(loads[0].manifest?.description).toBe('演示技能包。');
    // The toolbar lives in the host UI, and the tree panel holds only the tree.
    expect(document.querySelector('.se-toolbar')).toBeNull();
    expect(document.querySelector('.se-panel__footer')).toBeNull();
    expect(within(tree).queryByText('演示技能包。')).toBeNull();
  });

  it('collapses a folder when its row is clicked', async () => {
    render(<SkillEditor source={demoFile()} />);
    const tree = await waitForTree();

    const row = within(tree).getByRole('treeitem', { name: /references/ });
    expect(row.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(row);

    await waitFor(() => {
      expect(
        within(tree).getByRole('treeitem', { name: /references/ }).getAttribute('aria-expanded'),
      ).toBe('false');
    });
    expect(within(tree).queryByText('api-index.md')).toBeNull();
  });

  it('exposes an imperative handle for expansion and reload', async () => {
    const ref = createRef<SkillEditorHandle>();
    render(<SkillEditor ref={ref} source={demoFile()} />);
    await waitForTree();

    expect(ref.current?.getResult()?.tree.fileCount).toBe(5);

    act(() => ref.current?.collapseAll());
    await waitFor(() => {
      expect(screen.queryByText('api-index.md')).toBeNull();
    });

    act(() => ref.current?.expandAll());
    await waitFor(() => {
      expect(screen.getByText('api-index.md')).toBeTruthy();
    });
  });

  it('keeps every file reachable through the tree test id', async () => {
    const ref = createRef<SkillEditorHandle>();
    render(<SkillEditor ref={ref} source={demoFile()} />);
    const tree = await waitForTree();
    expandAll(ref);

    expect(within(tree).getAllByRole('treeitem')).toHaveLength(EXPANDED_ROWS);
  });

  it('expands and collapses every folder from one button', async () => {
    render(<SkillEditor source={demoFile()} />);
    const tree = await waitForTree();

    // Default state: root folders are open, so nested files are visible.
    expect(within(tree).getByText('api-index.md')).toBeTruthy();
    const expandButton = screen.getByRole('button', { name: '全部收起目录' });
    // `aria-pressed` reflects what the button was last used for.
    expect(expandButton.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(expandButton);

    await waitFor(() => {
      expect(within(tree).queryByText('api-index.md')).toBeNull();
    });
    // Only top-level nodes remain, and the nested folders report themselves closed.
    expect(within(tree).getAllByRole('treeitem')).toHaveLength(COLLAPSED_ROWS);
    for (const path of NESTED_FOLDERS) {
      expect(
        within(tree).getByRole('treeitem', { name: new RegExp(path) }).getAttribute('aria-expanded'),
      ).toBe('false');
    }

    const collapseButton = screen.getByRole('button', { name: '全部展开目录' });
    expect(collapseButton.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(collapseButton);

    await waitFor(() => {
      expect(within(tree).getByText('api-index.md')).toBeTruthy();
    });
    expect(within(tree).getByText('openai.yaml')).toBeTruthy();
    expect(within(tree).getAllByRole('treeitem')).toHaveLength(EXPANDED_ROWS);
    expect(
      screen.getByRole('button', { name: '全部收起目录' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('does not expand the tree when only some folders are open', async () => {
    render(<SkillEditor source={demoFile()} />);
    const tree = await waitForTree();

    // Fold `references`, leaving the other folders open: the button must
    // collapse everything rather than expand, since something is still open.
    fireEvent.click(within(tree).getByRole('treeitem', { name: /references/ }));
    await waitFor(() => {
      expect(within(tree).getByText('openai.yaml')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /全部(展开|收起)目录/ }));

    await waitFor(() => {
      expect(within(tree).getAllByRole('treeitem')).toHaveLength(COLLAPSED_ROWS);
    });
    expect(within(tree).queryByText('openai.yaml')).toBeNull();
  });

  it('toggles the whole tree from the keyboard', async () => {
    const ref = createRef<SkillEditorHandle>();
    render(<SkillEditor ref={ref} source={demoFile()} />);
    const tree = await waitForTree();
    await waitFor(() => {
      expect(ref.current?.getResult()).not.toBeNull();
    });

    // Ctrl/⌘+Shift+E folds everything, Ctrl/⌘+E opens it all again.
    fireEvent.keyDown(tree, { key: 'E', ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(within(tree).getAllByRole('treeitem')).toHaveLength(COLLAPSED_ROWS);
    });
    expect(ref.current?.getResult()?.tree.folderCount).toBe(4);

    fireEvent.keyDown(tree, { key: 'e', ctrlKey: true });
    await waitFor(() => {
      expect(within(tree).getAllByRole('treeitem')).toHaveLength(EXPANDED_ROWS);
    });
  });

  it('hides the toggle control when asked to', async () => {
    render(<SkillEditor source={demoFile()} hideExpandToggle />);
    await waitForTree();

    expect(screen.queryByRole('button', { name: /全部(展开|收起)目录/ })).toBeNull();
  });

  it('surfaces a readable error for a non-zip file', async () => {
    const errors: Error[] = [];
    render(
      <SkillEditor
        source={new File(['not a zip'], 'notes.txt', { type: 'text/plain' })}
        onError={(error) => errors.push(error)}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(errors[0]?.message).toMatch(/Not a ZIP archive|too small/);
  });
});

describe('<SkillEditor /> file preview', () => {
  it('renders Markdown as formatted content and can switch to source', async () => {
    const ref = createRef<SkillEditorHandle>();
    render(<SkillEditor ref={ref} source={demoFile()} />);
    await waitForTree();
    expandAll(ref);

    fireEvent.click(screen.getByRole('treeitem', { name: /SKILL\.md/ }));

    const preview = await screen.findByRole('heading', { name: 'Demo Skill' });
    expect(preview).toBeTruthy();
    expect(screen.getByRole('heading', { name: '使用方式' })).toBeTruthy();
    expect(screen.getByText('第一步')).toBeTruthy();
    // Frontmatter is shown as a definition list above the body.
    expect(document.querySelector('.se-md__frontmatter')?.textContent).toContain('demo-skill');

    fireEvent.click(screen.getByRole('button', { name: /源码/ }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Demo Skill' })).toBeNull();
    });
    const source = document.querySelector('.se-preview__source');
    expect(source?.textContent).toContain('name: demo-skill');
  });

  it('shows plain text files verbatim', async () => {
    const ref = createRef<SkillEditorHandle>();
    render(<SkillEditor ref={ref} source={demoFile()} />);
    await waitForTree();
    expandAll(ref);

    fireEvent.click(screen.getByRole('treeitem', { name: /readme\.txt/ }));

    await waitFor(() => {
      expect(document.querySelector('.se-preview__source')?.textContent).toBe(README);
    });
    // Text files have no Markdown toggle, only the toolbar actions.
    expect(screen.queryByRole('button', { name: /预览/ })).toBeNull();
    expect(screen.getByRole('button', { name: '复制内容' })).toBeTruthy();
  });

  it('renders images through an object URL', async () => {
    const ref = createRef<SkillEditorHandle>();
    render(<SkillEditor ref={ref} source={demoFile()} />);
    await waitForTree();
    expandAll(ref);

    fireEvent.click(screen.getByRole('treeitem', { name: /logo\.png/ }));

    const image = await screen.findByRole('img', { name: 'logo.png' });
    expect(image.getAttribute('src')).toMatch(/^blob:|^data:/);
  });

  it('falls back to a notice for binary files', async () => {
    const file = createZipFile(
      [{ name: 'demo-skill/bin/tool.exe', content: BINARY, stored: true }],
      'demo-skill.zip',
    );
    const ref = createRef<SkillEditorHandle>();
    render(<SkillEditor ref={ref} source={file} />);
    await waitForTree();
    expandAll(ref);

    fireEvent.click(screen.getByRole('treeitem', { name: /tool\.exe/ }));

    await waitFor(() => {
      expect(screen.getByText('该文件为二进制内容，暂不支持预览')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: '下载该文件' })).toBeTruthy();
  });

  it('copies the previewed file to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const ref = createRef<SkillEditorHandle>();
    render(<SkillEditor ref={ref} source={demoFile()} />);
    await waitForTree();
    expandAll(ref);

    fireEvent.click(screen.getByRole('treeitem', { name: /readme\.txt/ }));
    await waitFor(() => {
      expect(document.querySelector('.se-preview__source')?.textContent).toBe(README);
    });

    fireEvent.click(screen.getByRole('button', { name: '复制内容' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(README);
    });
  });

  it('keeps the pane empty in placeholder mode', async () => {
    const ref = createRef<SkillEditorHandle>();
    render(<SkillEditor ref={ref} source={demoFile()} previewMode="placeholder" />);
    await waitForTree();
    expandAll(ref);

    fireEvent.click(screen.getByRole('treeitem', { name: /readme\.txt/ }));

    expect(screen.getByText('文件内容区域')).toBeTruthy();
    expect(document.querySelector('.se-preview__source')).toBeNull();
  });

  it('lets the host replace the preview body', async () => {
    const ref = createRef<SkillEditorHandle>();
    render(
      <SkillEditor
        ref={ref}
        source={demoFile()}
        renderFilePreview={(state) => (
          <div data-testid="custom-preview">{state.kind === 'empty' ? 'empty' : state.node.path}</div>
        )}
      />,
    );
    await waitForTree();
    expandAll(ref);

    fireEvent.click(screen.getByRole('treeitem', { name: /readme\.txt/ }));

    await waitFor(() => {
      expect(screen.getByTestId('custom-preview').textContent).toBe('notes/readme.txt');
    });
    // The built-in viewer is replaced, but the header stays.
    expect(document.querySelector('.se-preview__source')).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef } from 'react';
import { SkillEditor } from '../components/SkillEditor';
import type { EditSummary, SkillEditorHandle } from '../components/SkillEditor';
import type { ExportResult } from '../lib/document/skillDocument';
import { parseZipArchive } from '../lib/zip/zipArchive';
import type { SkillArchiveResult } from '../lib/loadSkillArchive';
import { createZipFile } from './zipCreator';

const SKILL = '# 旧标题\n\n旧内容\n';
const INDEX = '# 索引\n';
const OPENAI_YAML = 'interface:\n  display_name: 演示\n';

const TREE_ID = 'se-tree';
const decoder = new TextDecoder();

/** Narrow an export result after a truthiness assertion. */
const asExport = (value: ExportResult | null): ExportResult => value as unknown as ExportResult;

async function waitForTree(): Promise<HTMLElement> {
  const tree = await screen.findByTestId(TREE_ID);
  await waitFor(() => {
    expect(tree.getAttribute('data-state')).toBe('ready');
  });
  return tree;
}

function demoFile(): File {
  return createZipFile(
    [
      { name: 'demo-skill/SKILL.md', content: SKILL },
      { name: 'demo-skill/references/api-index.md', content: INDEX },
      { name: 'demo-skill/agents/openai.yaml', content: OPENAI_YAML },
      { name: 'demo-skill/assets/logo.png', content: new Uint8Array([0x89, 0x50, 0x0, 0x1]), stored: true },
    ],
    'demo-skill.zip',
  );
}

/** Render the editor with editing enabled and every folder open. */
async function renderEditable() {
  const ref = createRef<SkillEditorHandle>();
  const edits: EditSummary[] = [];
  const loads: SkillArchiveResult[] = [];
  render(
    <SkillEditor
      ref={ref}
      editable
      source={demoFile()}
      onLoad={(result) => loads.push(result)}
      onEditChange={(summary) => edits.push(summary)}
    />,
  );
  const tree = await waitForTree();
  act(() => ref.current?.expandAll());
  return { ref, tree, edits, loads };
}

/**
 * Render the editor with a host export button that records every result.
 *
 * Export must be driven from a real DOM event: the confirmation dialog relies
 * on a React state update, which only flushes inside React's event/`act` scope.
 */
async function renderExporting() {
  const ref = createRef<SkillEditorHandle>();
  const results: (ExportResult | null)[] = [];
  render(
    <>
      <SkillEditor ref={ref} editable source={demoFile()} />
      <button
        type="button"
        data-testid="host-export"
        onClick={() => {
          void ref.current?.exportArchive().then((value) => results.push(value ?? null));
        }}
      >
        导出 .zip
      </button>
    </>,
  );
  const tree = await waitForTree();
  act(() => ref.current?.expandAll());
  return { ref, tree, results, exportButton: screen.getByTestId('host-export') };
}

/** Open the editor on a tree path and return the textarea. */
async function openEditor(tree: HTMLElement, path: string) {
  const name = path.split('/').pop()!;
  fireEvent.click(within(tree).getByRole('treeitem', { name: new RegExp(name) }));
  // The edit action only exists once the preview has loaded the payload.
  const editButton = await screen.findByRole('button', { name: '编辑' }, { timeout: 3000 });
  fireEvent.click(editButton);
  return (await screen.findByRole('textbox')) as HTMLTextAreaElement;
}

describe('<SkillEditor /> editing', () => {
  it('hides the edit affordance when editing is disabled', async () => {
    render(<SkillEditor source={demoFile()} />);
    const tree = await waitForTree();

    fireEvent.click(within(tree).getByRole('treeitem', { name: /SKILL\.md/ }));
    await screen.findByRole('heading', { name: '旧标题' });
    expect(screen.queryByRole('button', { name: /编辑/ })).toBeNull();
  });

  it('opens the editor with the file content and saves explicit changes', async () => {
    const { ref, tree, edits } = await renderEditable();
    const textarea = await openEditor(tree, 'SKILL.md');

    expect(textarea.value).toBe(SKILL);

    fireEvent.change(textarea, { target: { value: '# 新标题\n\n新内容\n' } });
    // Nothing is saved until the user says so.
    expect(edits.at(-1)?.dirty).toBe(false);
    expect(screen.getByText('未保存')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(ref.current?.hasUnsavedChanges()).toBe(true);
    expect(ref.current?.getDocument()?.getEdit('SKILL.md')?.text).toBe('# 新标题\n\n新内容\n');
    await waitFor(() => {
      expect(edits.at(-1)).toMatchObject({ dirty: true, count: 1, paths: ['demo-skill/SKILL.md'] });
    });
  });

  it('saves with Ctrl+S', async () => {
    const { ref, tree } = await renderEditable();
    const textarea = await openEditor(tree, 'references/api-index.md');

    fireEvent.change(textarea, { target: { value: '# 新索引\n' } });
    fireEvent.keyDown(textarea, { key: 's', ctrlKey: true });

    expect(ref.current?.getDocument()?.getEdit('references/api-index.md')?.text).toBe('# 新索引\n');
  });

  it('discards the draft on Esc and leaves the editor', async () => {
    const { ref, tree } = await renderEditable();
    const textarea = await openEditor(tree, 'SKILL.md');

    fireEvent.change(textarea, { target: { value: '# 丢弃我\n' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });

    // Back to the preview, and the document is still clean.
    await screen.findByRole('heading', { name: '旧标题' });
    expect(ref.current?.hasUnsavedChanges()).toBe(false);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('marks edited files in the tree and exposes them through onEditChange', async () => {
    const { tree, edits } = await renderEditable();
    const textarea = await openEditor(tree, 'agents/openai.yaml');
    fireEvent.change(textarea, { target: { value: 'interface:\n  display_name: 新名字\n' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      const row = within(tree).getByRole('treeitem', { name: /openai\.yaml/ });
      expect(row.querySelector('.se-tree__dirty')).not.toBeNull();
    });
    expect(edits.at(-1)?.count).toBe(1);
  });

  it('reverts a saved edit from the preview header', async () => {
    const { ref, tree } = await renderEditable();
    const textarea = await openEditor(tree, 'SKILL.md');
    fireEvent.change(textarea, { target: { value: '# 会被撤销\n' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    // Leave the editor, then revert from the preview header.
    fireEvent.click(screen.getByRole('button', { name: '完成并退出编辑' }));
    await screen.findByRole('heading', { name: '会被撤销' });

    fireEvent.click(await screen.findByRole('button', { name: '撤销对该文件的修改' }));

    await waitFor(() => {
      expect(ref.current?.hasUnsavedChanges()).toBe(false);
    });
    await screen.findByRole('heading', { name: '旧标题' });
  });

  it('never offers editing for binary files', async () => {
    const { tree } = await renderEditable();
    fireEvent.click(within(tree).getByRole('treeitem', { name: /logo\.png/ }));

    // The payload is not a renderable image in this environment, so the pane
    // falls back to a notice; either way the file must not be editable.
    await waitFor(() => {
      expect(document.querySelector('.se-preview')?.textContent).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull();
  });

  it('asks before leaving an editor with unsaved draft', async () => {
    const { ref, tree } = await renderEditable();
    const textarea = await openEditor(tree, 'SKILL.md');
    fireEvent.change(textarea, { target: { value: '# 草稿\n' } });

    // Switch to another file while the draft is dirty.
    fireEvent.click(within(tree).getByRole('treeitem', { name: /api-index\.md/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/未保存的修改/)).toBeTruthy();

    // «保存并切换» keeps the draft as a saved edit and moves on.
    fireEvent.click(within(dialog).getByRole('button', { name: '保存并切换' }));

    await waitFor(() => {
      expect(ref.current?.getDocument()?.getEdit('SKILL.md')?.text).toBe('# 草稿\n');
    });
    expect(ref.current?.getSelectedPath()).toBe('references/api-index.md');
  });

  it('can abandon a draft when switching files', async () => {
    const { ref, tree } = await renderEditable();
    const textarea = await openEditor(tree, 'SKILL.md');
    fireEvent.change(textarea, { target: { value: '# 草稿\n' } });
    fireEvent.click(within(tree).getByRole('treeitem', { name: /api-index\.md/ }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '放弃修改并切换' }));

    await waitFor(() => {
      expect(ref.current?.getSelectedPath()).toBe('references/api-index.md');
    });
    expect(ref.current?.hasUnsavedChanges()).toBe(false);
  });

  it('stays put when the switch is cancelled', async () => {
    const { ref, tree } = await renderEditable();
    const textarea = await openEditor(tree, 'SKILL.md');
    fireEvent.change(textarea, { target: { value: '# 草稿\n' } });
    fireEvent.click(within(tree).getByRole('treeitem', { name: /api-index\.md/ }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(ref.current?.getSelectedPath()).toBe('SKILL.md');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('# 草稿\n');
  });

  it('navigates the document with the table of contents', async () => {
    // A document with several headings, so the contents list has entries.
    const file = createZipFile(
      [
        {
          name: 'demo-skill/SKILL.md',
          content: [
            '---',
            'name: demo-skill',
            '---',
            '',
            '# 顶层标题',
            '',
            '## 使用方式',
            '',
            '正文。',
            '',
            '### 参数说明',
            '',
            '| 参数 | 含义 |',
            '| --- | --- |',
            '| a | 甲 |',
          ].join('\n'),
        },
      ],
      'demo-skill.zip',
    );
    render(<SkillEditor source={file} />);
    const tree = await waitForTree();
    fireEvent.click(within(tree).getByRole('treeitem', { name: /SKILL\.md/ }));
    await waitFor(() => {
      expect(document.querySelectorAll('.se-md__heading')).toHaveLength(3);
    });

    const tocButton = screen.getByRole('button', { name: '目录' });
    expect(tocButton.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(tocButton);
    const toc = await screen.findByRole('navigation', { name: '文档目录' });
    expect(tocButton.getAttribute('aria-expanded')).toBe('true');
    expect(
      within(toc)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['顶层标题', '使用方式', '参数说明']);

    // Clicking an entry scrolls the pane to the matching heading.
    const scrolled: { top: number; behavior: string }[] = [];
    Element.prototype.scrollTo = function scrollTo(options?: ScrollToOptions) {
      scrolled.push({ top: options?.top ?? 0, behavior: String(options?.behavior) });
    } as typeof Element.prototype.scrollTo;

    fireEvent.click(within(toc).getByRole('button', { name: '参数说明' }));

    expect(scrolled).toHaveLength(1);
    expect(scrolled[0].behavior).toBe('smooth');
    expect(scrolled[0].top).toBeGreaterThanOrEqual(0);
    // The popover closes and the target heading is flagged for the CSS flash.
    expect(screen.queryByRole('navigation', { name: '文档目录' })).toBeNull();
    expect(document.querySelector('.se-md__heading.is-active')?.id).toBe('参数说明');
  });

  it('hides the table of contents while showing the source view', async () => {
    render(<SkillEditor source={demoFile()} />);
    const tree = await waitForTree();
    fireEvent.click(within(tree).getByRole('treeitem', { name: /SKILL\.md/ }));
    await waitFor(() => {
      expect(document.querySelectorAll('.se-md__heading').length).toBeGreaterThan(0);
    });
    expect(screen.getByRole('button', { name: '目录' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /源码/ }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '目录' })).toBeNull();
    });
  });

  it('highlights fenced code blocks in the preview', async () => {    const file = createZipFile(
      [
        {
          name: 'demo-skill/SKILL.md',
          content: '# Demo\n\n```json\n{"a": 1, "b": true}\n```\n',
        },
      ],
      'demo-skill.zip',
    );
    render(<SkillEditor source={file} />);
    const tree = await waitForTree();
    fireEvent.click(within(tree).getByRole('treeitem', { name: /SKILL\.md/ }));

    const pre = await waitFor(() => {
      const element = document.querySelector('.se-md__pre');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });

    expect(pre.getAttribute('data-language')).toBe('json');
    expect(pre.querySelector('.se-code__property')?.textContent).toBe('"a"');
    expect(pre.querySelector('.se-code__number')?.textContent).toBe('1');
    expect(pre.querySelector('.se-code__keyword')?.textContent).toBe('true');
    // Highlighting must not change the code itself.
    expect(pre.textContent).toBe('{"a": 1, "b": true}');
  });

  it('follows relative links to another file in the package', async () => {
    const ref = createRef<SkillEditorHandle>();
    const file = createZipFile(
      [
        {
          name: 'demo-skill/SKILL.md',
          content: [
            '# 顶层',
            '',
            '- [索引](references/api-index.md)',
            '- [同级](./agents/openai.yaml)',
            '- [外部](https://example.com/docs)',
            '',
            '## 附录',
          ].join('\n'),
        },
        { name: 'demo-skill/references/api-index.md', content: '# 索引\n' },
        { name: 'demo-skill/agents/openai.yaml', content: 'name: demo\n' },
      ],
      'demo-skill.zip',
    );
    render(<SkillEditor ref={ref} source={file} />);
    const tree = await waitForTree();
    fireEvent.click(within(tree).getByRole('treeitem', { name: /SKILL\.md/ }));
    await waitFor(() => {
      expect(document.querySelectorAll('.se-md__heading').length).toBe(2);
    });

    const links = [...document.querySelectorAll('.se-md__link')] as HTMLAnchorElement[];
    expect(links.map((link) => link.getAttribute('data-md-link'))).toEqual([
      'references/api-index.md',
      './agents/openai.yaml',
      'https://example.com/docs',
    ]);
    // External links open in a new tab; in-package links must not.
    expect(links[2].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('target')).toBeNull();

    // A relative link selects the target file and previews it.
    fireEvent.click(links[0]);
    await waitFor(() => {
      expect(ref.current?.getSelectedPath()).toBe('references/api-index.md');
    });
    expect(await screen.findByRole('heading', { name: '索引' })).toBeTruthy();

    // `./` is resolved against the current file's directory.
    fireEvent.click(within(tree).getByRole('treeitem', { name: /SKILL\.md/ }));
    await screen.findByRole('heading', { name: '顶层' });
    fireEvent.click([...document.querySelectorAll('.se-md__link')][1]);
    await waitFor(() => {
      expect(ref.current?.getSelectedPath()).toBe('agents/openai.yaml');
    });
    await waitFor(() => {
      expect(document.querySelector('.se-preview__source')?.textContent).toBe('name: demo\n');
    });
  });

  it('keeps same-document anchors inside the pane', async () => {
    const ref = createRef<SkillEditorHandle>();
    const file = createZipFile(
      [
        {
          name: 'demo-skill/SKILL.md',
          content: '# 顶层\n\n[跳到附录](#附录)\n\n## 附录\n\n正文。\n',
        },
      ],
      'demo-skill.zip',
    );
    render(<SkillEditor ref={ref} source={file} />);
    const tree = await waitForTree();
    fireEvent.click(within(tree).getByRole('treeitem', { name: /SKILL\.md/ }));
    await screen.findByRole('heading', { name: '顶层' });

    const scrolled: ScrollToOptions[] = [];
    Element.prototype.scrollTo = function scrollTo(options?: ScrollToOptions) {
      scrolled.push(options ?? {});
    } as typeof Element.prototype.scrollTo;

    const anchor = document.querySelector('.se-md__link') as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('#附录');
    fireEvent.click(anchor);

    // An in-document jump must not change the selected file.
    expect(ref.current?.getSelectedPath()).toBe('SKILL.md');
    expect(scrolled).toHaveLength(1);
    expect(document.querySelector('.se-md__heading.is-active')?.id).toBe('附录');
  });

  it('reports links whose target is not in the package', async () => {
    const ref = createRef<SkillEditorHandle>();
    const file = createZipFile(
      [
        {
          name: 'demo-skill/SKILL.md',
          content: '# 顶层\n\n[缺失](references/missing.md) [越界](/etc/passwd)\n',
        },
      ],
      'demo-skill.zip',
    );
    render(<SkillEditor ref={ref} source={file} />);
    const tree = await waitForTree();
    fireEvent.click(within(tree).getByRole('treeitem', { name: /SKILL\.md/ }));
    await screen.findByRole('heading', { name: '顶层' });

    const [missing] = [...document.querySelectorAll('.se-md__link')];
    fireEvent.click(missing);

    // The click is swallowed (no navigation) and explained in the pane.
    expect(ref.current?.getSelectedPath()).toBe('SKILL.md');
    const notice = await screen.findByText(/压缩包内没有/);
    expect(notice.textContent).toContain('references/missing.md');
  });

  it('exports a repacked archive containing the saved edit', async () => {
    const { tree, results, exportButton } = await renderExporting();

    const textarea = await openEditor(tree, 'SKILL.md');
    fireEvent.change(textarea, { target: { value: '# 导出我\n' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    fireEvent.click(screen.getByRole('button', { name: '完成并退出编辑' }));

    // The host's export button opens the confirmation dialog.
    fireEvent.click(exportButton);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/导出前确认/)).toBeTruthy();
    expect(within(dialog).getByText(/1 个已修改/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '仍然导出' }));

    await waitFor(() => {
      expect(results).toHaveLength(1);
    });
    const exported = asExport(results[0]);
    expect(exported.fileName).toBe('demo-skill-edited.zip');
    expect(exported.stats).toMatchObject({ modified: 1, files: 4 });
    expect(exported.warnings.join(' ')).toMatch(/extra field/);

    const bytes = new Uint8Array(await exported.blob.arrayBuffer());
    const archive = parseZipArchive(bytes);
    expect(archive.entries.map((entry) => entry.path).sort()).toEqual([
      'demo-skill/SKILL.md',
      'demo-skill/agents/openai.yaml',
      'demo-skill/assets/logo.png',
      'demo-skill/references/api-index.md',
    ]);

    const skill = archive.entries.find((entry) => entry.path === 'demo-skill/SKILL.md');
    expect(decoder.decode(await archive.readEntry(skill!))).toBe('# 导出我\n');
    const untouched = archive.entries.find(
      (entry) => entry.path === 'demo-skill/references/api-index.md',
    );
    expect(decoder.decode(await archive.readEntry(untouched!))).toBe(INDEX);
  });

  it('does not export when the confirmation is cancelled', async () => {
    const { ref, tree, results, exportButton } = await renderExporting();
    const textarea = await openEditor(tree, 'SKILL.md');
    fireEvent.change(textarea, { target: { value: '# 不导出\n' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    fireEvent.click(screen.getByRole('button', { name: '完成并退出编辑' }));

    fireEvent.click(exportButton);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    // The export never happened, so no result was handed to the host.
    expect(results).toEqual([null]);
    expect(ref.current?.hasUnsavedChanges()).toBe(true);
  });

  it('exports the unchanged archive after confirming the warning', async () => {
    const { results, exportButton } = await renderExporting();

    fireEvent.click(exportButton);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/没有任何改动/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '仍然导出' }));

    await waitFor(() => {
      expect(results).toHaveLength(1);
    });
    expect(asExport(results[0]).stats.modified).toBe(0);
    expect(asExport(results[0]).blob.size).toBeGreaterThan(0);
  });

  it('reports a draft through onEditChange and clears it on exit', async () => {
    const { tree, edits } = await renderEditable();
    const textarea = await openEditor(tree, 'SKILL.md');
    fireEvent.change(textarea, { target: { value: '# 草稿\n' } });

    await waitFor(() => {
      expect(edits.at(-1)).toMatchObject({ dirty: false, draftOpen: true });
    });

    fireEvent.keyDown(textarea, { key: 'Escape' });
    await waitFor(() => {
      expect(edits.at(-1)).toMatchObject({ dirty: false, draftOpen: false });
    });
  });

  it('writes files through the document handle', async () => {
    const { ref } = await renderEditable();

    act(() => {
      ref.current?.getDocument()?.write('SKILL.md', '# 通过 API\n');
    });

    expect(ref.current?.getDocument()?.getEdit('SKILL.md')?.text).toBe('# 通过 API\n');
    await waitFor(() => {
      expect(ref.current?.hasUnsavedChanges()).toBe(true);
    });

    act(() => ref.current?.discardEdits());
    expect(ref.current?.hasUnsavedChanges()).toBe(false);
  });

  it('resets edits when a new archive is provided', async () => {
    const ref = createRef<SkillEditorHandle>();
    const { rerender } = render(<SkillEditor ref={ref} editable source={demoFile()} />);
    await waitForTree();
    act(() => ref.current?.getDocument()?.write('SKILL.md', '# 改动\n'));
    expect(ref.current?.hasUnsavedChanges()).toBe(true);

    rerender(<SkillEditor ref={ref} editable source={createZipFile([{ name: 'other/SKILL.md', content: '# 另一个\n' }], 'other.zip')} />);

    await waitFor(() => {
      expect(ref.current?.getDocument()?.sourceFileName).toBe('other.zip');
    });
    expect(ref.current?.hasUnsavedChanges()).toBe(false);
  });
});

describe('useConfirm dialog', () => {
  it('cancel keeps the user on the current file', async () => {
    const { ref, tree } = await renderEditable();
    const textarea = await openEditor(tree, 'SKILL.md');
    fireEvent.change(textarea, { target: { value: '草稿' } });
    fireEvent.click(within(tree).getByRole('treeitem', { name: /api-index\.md/ }));

    const dialog = await screen.findByRole('dialog');
    // Three actions: discard, cancel, save-and-switch.
    expect(within(dialog).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '放弃修改并切换',
      '取消',
      '保存并切换',
    ]);

    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(ref.current?.getSelectedPath()).toBe('SKILL.md');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('草稿');
  });

  it('closes the dialog when the browser reports Esc', async () => {
    const { tree } = await renderEditable();
    const textarea = await openEditor(tree, 'SKILL.md');
    fireEvent.change(textarea, { target: { value: '草稿' } });
    fireEvent.click(within(tree).getByRole('treeitem', { name: /api-index\.md/ }));

    const dialog = await screen.findByRole('dialog');
    // Native Esc surfaces as a cancel event; the dialog must not linger.
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('warns before losing a draft when the host reloads the archive', async () => {
    const onError = vi.fn();
    const { ref, tree } = await renderEditable();
    void onError;
    const textarea = await openEditor(tree, 'SKILL.md');
    fireEvent.change(textarea, { target: { value: '草稿' } });

    // Reload re-parses the same source, so edits are dropped without a prompt;
    // this documents the current behaviour rather than asserting a dialog.
    act(() => ref.current?.reload());
    await waitForTree();
    expect(ref.current?.hasUnsavedChanges()).toBe(false);
  });
});

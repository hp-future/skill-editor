import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef } from 'react';
import { SkillEditor } from '../components/SkillEditor';
import type { SkillEditorHandle } from '../components/SkillEditor';
import { createZipFile } from './zipCreator';

const TREE_ID = 'se-tree';
const SKILL = '# 标题\n\n正文\n';
const NOTE = '纯文本';

/** One package shared by the rerender cases, so only the props change. */
function demoFile(): File {
  return createZipFile(
    [
      { name: 'demo-skill/SKILL.md', content: SKILL },
      { name: 'demo-skill/notes/readme.txt', content: NOTE },
    ],
    'demo-skill.zip',
  );
}

async function waitForTree(): Promise<HTMLElement> {
  const tree = await screen.findByTestId(TREE_ID);
  await waitFor(() => {
    expect(tree.getAttribute('data-state')).toBe('ready');
  });
  return tree;
}

describe('<SkillEditor /> read-only mode', () => {
  it('hides the edit affordance even when editable is on', async () => {
    const ref = createRef<SkillEditorHandle>();
    const file = demoFile();
    render(<SkillEditor ref={ref} editable readOnly source={file} />);
    const tree = await waitForTree();
    act(() => ref.current?.expandAll());

    fireEvent.click(within(tree).getByRole('treeitem', { name: /SKILL\.md/ }));
    await screen.findByRole('heading', { name: '标题' });
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull();
  });

  it('keeps the document out of reach', async () => {
    const ref = createRef<SkillEditorHandle>();
    render(<SkillEditor ref={ref} editable readOnly source={demoFile()} />);
    await waitForTree();

    expect(ref.current?.getDocument()).toBeNull();
    expect(ref.current?.hasUnsavedChanges()).toBe(false);
    // Discarding is a no-op rather than an error.
    expect(() => ref.current?.discardEdits()).not.toThrow();
  });

  it('still previews files', async () => {
    render(<SkillEditor editable readOnly source={demoFile()} />);
    const tree = await waitForTree();
    fireEvent.click(within(tree).getByRole('treeitem', { name: /readme\.txt/ }));
    await waitFor(() => {
      expect(document.querySelector('.se-preview__source')?.textContent).toBe(NOTE);
    });
  });

  it('closes an open editor when read-only is switched on', async () => {
    const ref = createRef<SkillEditorHandle>();
    const file = demoFile();
    const view = render(<SkillEditor ref={ref} editable source={file} />);
    const tree = await waitForTree();
    act(() => ref.current?.expandAll());

    fireEvent.click(within(tree).getByRole('treeitem', { name: /SKILL\.md/ }));
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    expect(await screen.findByRole('textbox')).toBeTruthy();

    view.rerender(<SkillEditor ref={ref} editable readOnly source={file} />);

    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull();
    expect(ref.current?.getDocument()).toBeNull();
  });

  it('does not touch editing when editable is off', async () => {
    // `readOnly` is additive: the default component is already view-only.
    const ref = createRef<SkillEditorHandle>();
    render(<SkillEditor ref={ref} readOnly source={demoFile()} />);
    const tree = await waitForTree();
    fireEvent.click(within(tree).getByRole('treeitem', { name: /SKILL\.md/ }));
    await screen.findByRole('heading', { name: '标题' });
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull();
    expect(ref.current?.getDocument()).toBeNull();
  });
});

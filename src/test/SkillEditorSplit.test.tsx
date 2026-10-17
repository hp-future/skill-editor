import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SkillEditor } from '../components/SkillEditor';
import { createZipFile } from './zipCreator';

const TREE_ID = 'se-tree';

function demoFile(): File {
  return createZipFile(
    [
      { name: 'demo-skill/SKILL.md', content: '# 标题\n\n正文。\n' },
      { name: 'demo-skill/references/api-index.md', content: '# 索引\n' },
    ],
    'demo-skill.zip',
  );
}

async function waitForTree(): Promise<void> {
  const tree = await screen.findByTestId(TREE_ID);
  await waitFor(() => {
    expect(tree.getAttribute('data-state')).toBe('ready');
  });
}

const splitter = (): HTMLElement => screen.getByRole('separator', { name: '调整目录树宽度' });

/** Width column the component wrote onto `.se-body`. */
const treeColumn = (): string => {
  const body = splitter().parentElement as HTMLElement;
  return body.style.getPropertyValue('--se-tree-column');
};

/**
 * 1000px-wide body: the default 30% ratio gives a 300px tree, the clamp leaves
 * the detail pane at least 360px (so the tree may grow to 640px).
 */
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function bounds(
    this: HTMLElement,
  ): DOMRect {
    const width = this.classList.contains('se-body') ? 1000 : 300;
    return {
      width,
      height: 600,
      top: 0,
      left: 0,
      bottom: 600,
      right: width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resizable split', () => {
  it('starts at the default ratio and exposes a separator', async () => {
    render(<SkillEditor source={demoFile()} />);
    await waitForTree();

    await waitFor(() => expect(treeColumn()).toBe('280px'));
    const handle = splitter();
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuemin')).toBe('200');
    expect(handle.getAttribute('aria-valuemax')).toBe('640');
    expect(handle.getAttribute('aria-valuenow')).toBe('280');
  });

  it('resizes while dragging and reports the final width', async () => {
    const onTreeWidthChange = vi.fn();
    render(<SkillEditor source={demoFile()} onTreeWidthChange={onTreeWidthChange} />);
    await waitForTree();
    await waitFor(() => expect(treeColumn()).toBe('280px'));

    const handle = splitter();
    fireEvent.pointerDown(handle, { button: 0, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 420, pointerId: 1 });
    expect(treeColumn()).toBe('400px');

    fireEvent.pointerUp(handle, { clientX: 420, pointerId: 1 });
    expect(onTreeWidthChange).toHaveBeenLastCalledWith(400);
    expect(splitter().getAttribute('aria-valuenow')).toBe('400');
    expect(splitter().classList.contains('is-active')).toBe(false);
  });

  it('clamps the drag to both panes', async () => {
    render(<SkillEditor source={demoFile()} />);
    await waitForTree();
    await waitFor(() => expect(treeColumn()).toBe('280px'));

    const handle = splitter();
    fireEvent.pointerDown(handle, { button: 0, clientX: 300, pointerId: 1 });

    // Far left: never below the 200px minimum.
    fireEvent.pointerMove(handle, { clientX: -400, pointerId: 1 });
    expect(treeColumn()).toBe('200px');

    // Far right: the detail pane keeps at least 360px.
    fireEvent.pointerMove(handle, { clientX: 2000, pointerId: 1 });
    expect(treeColumn()).toBe('640px');

    fireEvent.pointerUp(handle, { clientX: 2000, pointerId: 1 });
  });

  it('resizes with the keyboard', async () => {
    const onTreeWidthChange = vi.fn();
    render(<SkillEditor source={demoFile()} onTreeWidthChange={onTreeWidthChange} />);
    await waitForTree();
    await waitFor(() => expect(treeColumn()).toBe('280px'));

    const handle = splitter();
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(treeColumn()).toBe('304px');

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(treeColumn()).toBe('256px');

    fireEvent.keyDown(handle, { key: 'Home' });
    expect(treeColumn()).toBe('200px');

    fireEvent.keyDown(handle, { key: 'End' });
    expect(treeColumn()).toBe('640px');

    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(treeColumn()).toBe('280px');
    expect(onTreeWidthChange).toHaveBeenLastCalledWith(280);
  });

  it('restores the default width on double click', async () => {
    render(<SkillEditor source={demoFile()} />);
    await waitForTree();
    await waitFor(() => expect(treeColumn()).toBe('280px'));

    fireEvent.pointerDown(splitter(), { button: 0, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(splitter(), { clientX: 500, pointerId: 1 });
    fireEvent.pointerUp(splitter(), { clientX: 500, pointerId: 1 });
    expect(treeColumn()).toBe('480px');

    fireEvent.doubleClick(splitter());
    expect(treeColumn()).toBe('280px');
  });

  it('honours an explicit defaultTreeWidth', async () => {
    render(<SkillEditor source={demoFile()} defaultTreeWidth={420} />);
    await waitForTree();
    await waitFor(() => expect(treeColumn()).toBe('420px'));
  });

  it('ignores keys it does not handle', async () => {
    render(<SkillEditor source={demoFile()} />);
    await waitForTree();
    await waitFor(() => expect(treeColumn()).toBe('280px'));

    fireEvent.keyDown(splitter(), { key: 'a' });
    expect(treeColumn()).toBe('280px');
  });
});

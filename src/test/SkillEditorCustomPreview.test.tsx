import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SkillEditor, byExtension } from '../components/SkillEditor';
import type { CustomPreviewProps, FilePreviewer } from '../components/SkillEditor';
import { createZipFile } from './zipCreator';

const TREE_ID = 'se-tree';

/** Minimal stand-in for a font: the preview plumbing only needs bytes. */
const FONT_BYTES = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x53, 0x6b, 0x69, 0x6c, 0x6c]);

function fontFile(): File {
  return createZipFile(
    [
      { name: 'font-demo/SKILL.md', content: '# 字体示例\n\n正文。\n' },
      { name: 'font-demo/fonts/SkillDemo.ttf', content: FONT_BYTES, stored: true },
      { name: 'font-demo/fonts/readme.txt', content: '纯文本' },
    ],
    'font-demo.zip',
  );
}

async function waitForTree(): Promise<HTMLElement> {
  const tree = await screen.findByTestId(TREE_ID);
  await waitFor(() => {
    expect(tree.getAttribute('data-state')).toBe('ready');
  });
  return tree;
}

/** A previewer that renders whatever it was handed, so tests can inspect it. */
function probePreviewer(captured: { props?: CustomPreviewProps }): FilePreviewer {
  return {
    id: 'probe-font',
    match: byExtension('ttf'),
    render: (props) => {
      captured.props = props;
      return (
        <div data-testid="probe-body">
          <span>{props.info.name}</span>
          <span>{props.bytes.length}</span>
          <span>{props.blob.type}</span>
          <span>{props.objectUrl.startsWith('blob:') ? 'blob-url' : 'no-blob-url'}</span>
        </div>
      );
    },
  };
}

describe('custom file previewers', () => {
  it('renders the registered previewer for a .ttf file', async () => {
    const captured: { props?: CustomPreviewProps } = {};
    render(<SkillEditor source={fontFile()} previewers={[probePreviewer(captured)]} />);
    const tree = await waitForTree();

    // The built-in preview refuses binary files…
    fireEvent.click(screen.getByRole('treeitem', { name: /SkillDemo\.ttf/ }));
    const body = await screen.findByTestId('probe-body');
    expect(body.textContent).toContain('SkillDemo.ttf');
    expect(body.textContent).toContain(String(FONT_BYTES.length));
    // …while the host previewer receives the real payload.
    expect(captured.props?.bytes).toEqual(FONT_BYTES);
    expect(captured.props?.blob.type).toBe('font/ttf');
    expect(captured.props?.objectUrl.startsWith('blob:')).toBe(true);
    expect(captured.props?.info).toMatchObject({
      path: 'fonts/SkillDemo.ttf',
      name: 'SkillDemo.ttf',
      extension: 'ttf',
      kind: 'binary',
      size: FONT_BYTES.length,
    });
    expect(withinTree(tree, 'fonts')).toBeTruthy();
  });

  it('falls back to the built-in binary notice without a previewer', async () => {
    render(<SkillEditor source={fontFile()} />);
    await waitForTree();
    fireEvent.click(screen.getByRole('treeitem', { name: /SkillDemo\.ttf/ }));
    expect(await screen.findByText('该文件为二进制内容，暂不支持预览')).toBeTruthy();
  });

  it('only claims files its matcher accepts', async () => {
    const renderer = vi.fn(() => <div data-testid="probe-body">claimed</div>);
    render(
      <SkillEditor
        source={fontFile()}
        previewers={[{ id: 'only-png', match: byExtension('png'), render: renderer }]}
      />,
    );
    await waitForTree();
    fireEvent.click(screen.getByRole('treeitem', { name: /SkillDemo\.ttf/ }));
    expect(await screen.findByText('该文件为二进制内容，暂不支持预览')).toBeTruthy();
    expect(renderer).not.toHaveBeenCalled();
    expect(screen.queryByTestId('probe-body')).toBeNull();
  });

  it('keeps the built-in preview for files no previewer claims', async () => {
    render(<SkillEditor source={fontFile()} previewers={[probePreviewer({})]} />);
    await waitForTree();
    fireEvent.click(screen.getByRole('treeitem', { name: /readme\.txt/ }));
    await waitFor(() => {
      expect(document.querySelector('.se-preview__source')?.textContent).toBe('纯文本');
    });
  });

  it('lets a matched previewer win over the generic renderFilePreview hook', async () => {
    const caught: string[] = [];
    render(
      <SkillEditor
        source={fontFile()}
        previewers={[probePreviewer({})]}
        renderFilePreview={(state) => {
          caught.push(state.kind);
          return <div data-testid="generic-body">generic</div>;
        }}
      />,
    );
    await waitForTree();
    fireEvent.click(screen.getByRole('treeitem', { name: /SkillDemo\.ttf/ }));
    expect(await screen.findByTestId('probe-body')).toBeTruthy();
    expect(screen.queryByTestId('generic-body')).toBeNull();

    // The generic hook still handles everything else.
    fireEvent.click(screen.getByRole('treeitem', { name: /readme\.txt/ }));
    expect(await screen.findByTestId('generic-body')).toBeTruthy();
    await waitFor(() => expect(caught).toContain('text'));
  });

  it('shows the loading state before handing over the payload', async () => {
    const seen: string[] = [];
    render(
      <SkillEditor
        source={fontFile()}
        previewers={[
          {
            id: 'status-probe',
            match: byExtension('ttf'),
            render: () => <div data-testid="probe-body">ready</div>,
          },
        ]}
      />,
    );
    await waitForTree();
    fireEvent.click(screen.getByRole('treeitem', { name: /SkillDemo\.ttf/ }));
    await screen.findByTestId('probe-body');
    seen.push('rendered');
    expect(seen).toEqual(['rendered']);
  });
});

/** Guard helper: the folder row exists, which means the tree accepted the entries. */
function withinTree(tree: HTMLElement, name: string): boolean {
  return tree.textContent?.includes(name) ?? false;
}

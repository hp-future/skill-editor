import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { formatBytes } from '../../lib/format';
import type { FileKind } from '../../lib/fileKind';
import { useFileEditor } from './useFileEditor';
import type { FileEditorState } from './useFileEditor';
import { useConfirm } from './useConfirm';
import { CheckIcon, CodeIcon, EyeIcon, FilesIcon, UndoIcon } from './icons';
import './FileEditor.css';

export interface FileEditorProps {
  /** Display name (last path segment). */
  readonly name: string;
  /** Path inside the archive, shown as the breadcrumb. */
  readonly path: string;
  /** Uncompressed size of the saved content. */
  readonly size?: number;
  /** Classified content kind, used for the mode toggle. */
  readonly kind: FileKind;
  /** Saved content from the document. */
  readonly initialText: string;
  /** Called by «保存» and `Ctrl/⌘ + S`. */
  readonly onSave: (text: string) => void;
  /**
   * Called by «完成 / 预览» and `Esc`; the draft is discarded first. The 完成
   * button prompts to save or discard when the draft is unsaved, while `Esc`
   * always abandons the draft and leaves right away.
   */
  readonly onExit: () => void;
  /** Reports the draft so the parent can guard against switching files. */
  readonly onDraftChange?: (draft: { text: string; saved: string }) => void;
  /** Extra class name for the root element. */
  readonly className?: string;
  /** Replaces the editing surface entirely. */
  readonly renderBody?: (state: FileEditorState) => ReactNode;
}

/**
 * Source editor for one text file.
 *
 * Saving is explicit: the textarea holds a *draft*, `Ctrl/⌘ + S` commits it,
 * and `Esc` leaves the editor — the draft is discarded, unconditionally, as
 * the escape hatch. The 完成 button guards unsaved drafts with a confirmation.
 */
export function FileEditor(props: FileEditorProps) {
  const { name, path, size, kind, initialText, onSave, onExit, onDraftChange, className, renderBody } = props;
  const editor = useFileEditor({ path, initialText }, onSave);
  const { draft, saved, dirty } = editor;
  const confirmController = useConfirm();
  // Latest editor state for the async exit flow, so its callbacks stay stable.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // Keep the parent's copy of the draft current; it guards file switching.
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  useEffect(() => {
    onDraftChangeRef.current?.({ text: draft, saved });
  }, [draft, saved]);

  /** Leave right away, dropping the draft: the `Esc` escape hatch. */
  const forceExit = useCallback((): void => {
    editorRef.current.discard();
    onExitRef.current();
  }, []);

  /** Leave the editor via 完成; confirm first when the draft is unsaved. */
  const exit = useCallback((): void => {
    const current = editorRef.current;
    if (current.draft === current.saved) {
      current.discard();
      onExitRef.current();
      return;
    }
    void (async () => {
      const answer = await confirmController.confirm({
        title: '有未保存的修改',
        message: (
          <>
            <code>{path}</code> 还有未保存的内容，退出编辑前要保存吗？
          </>
        ),
        confirmLabel: '保存并退出',
        discardLabel: '放弃修改并退出',
        cancelLabel: '取消',
      });
      if (answer === 'cancel') return;
      if (answer === 'confirm') editorRef.current.save();
      else editorRef.current.discard();
      onExitRef.current();
    })();
  }, [confirmController, path]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      editor.save();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      forceExit();
    }
  };

  return (
    <>
      <div className={['se-editor', className].filter(Boolean).join(' ')}>
        <header className="se-editor__header">
          <FilesIcon className="se-icon se-icon--file" />
          <div className="se-editor__titles">
            <span className="se-editor__name" title={path}>
              {name}
              {dirty && (
                <span className="se-editor__badge" role="status">
                  未保存
                </span>
              )}
            </span>
            <span className="se-editor__meta">
              <span className="se-editor__path">{path}</span>
              {typeof size === 'number' && <span className="se-editor__stat">{formatBytes(size)}</span>}
              <span className="se-editor__stat">{editor.lineCount} 行</span>
              <span className="se-editor__stat">{editor.charCount} 字符</span>
            </span>
          </div>

          <div className="se-editor__actions">
            <button
              type="button"
              className="se-button se-button--primary se-button--small"
              onClick={editor.save}
              disabled={!editor.dirty}
              title="保存（Ctrl/⌘ + S）"
            >
              <CheckIcon className="se-icon" />
              <span>保存</span>
            </button>
            <button
              type="button"
              className="se-icon-button"
              onClick={editor.discard}
              disabled={!editor.dirty}
              title="撤销未保存的修改"
              aria-label="撤销未保存的修改"
            >
              <UndoIcon className="se-icon" />
            </button>
            <button
              type="button"
              className="se-icon-button"
              onClick={exit}
              title={kind === 'markdown' ? '完成并返回预览' : '完成'}
              aria-label="完成并退出编辑"
            >
              {kind === 'markdown' ? <EyeIcon className="se-icon" /> : <CodeIcon className="se-icon" />}
            </button>
          </div>
        </header>

        {renderBody ? (
          renderBody(editor)
        ) : (
          <div className="se-editor__body">
            <textarea
              className="se-editor__textarea"
              value={editor.draft}
              spellCheck={false}
              aria-label={`编辑 ${name}`}
              onChange={(event) => editor.setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
        )}
      </div>

      {confirmController.dialog}
    </>
  );
}

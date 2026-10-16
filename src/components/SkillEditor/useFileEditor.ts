import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface UseFileEditorOptions {
  /** Path of the file being edited; changing it resets the editor. */
  readonly path: string;
  /** Saved content from the document (the edit target). */
  readonly initialText: string;
}

export interface FileEditorState {
  /** Text currently in the editor, including unsaved changes. */
  readonly draft: string;
  /** Text as saved in the document. */
  readonly saved: string;
  /** `true` when the draft differs from the saved text. */
  readonly dirty: boolean;
  /** Characters in the draft. */
  readonly charCount: number;
  /** Lines in the draft. */
  readonly lineCount: number;
  setDraft: (value: string) => void;
  /** Commit the draft as a saved edit. */
  save: () => void;
  /** Throw the draft away and reload the saved text. */
  discard: () => void;
}

/**
 * Draft state for one file.
 *
 * The hook is deliberately dumb: it knows about the text in the textarea and
 * whether it differs from what is saved, and nothing about archives or the
 * overlay. Saving is *explicit* — `save()` hands the text back to the caller
 * through `onSave`, and `discard()` restores the saved text.
 */
export function useFileEditor(
  options: UseFileEditorOptions,
  onSave: (text: string) => void,
): FileEditorState {
  const { path, initialText } = options;
  const [draft, setDraft] = useState(initialText);

  // Reset only when the edited file changes, never when the saved text updates
  // (that happens right after this editor saved it).
  const editedPath = useRef(path);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (editedPath.current === path) return;
    editedPath.current = path;
    setDraft(initialText);
  }, [path, initialText]);

  const save = useCallback(() => {
    onSaveRef.current(draft);
  }, [draft]);

  const discard = useCallback(() => {
    setDraft(initialText);
  }, [initialText]);

  const counts = useMemo(() => {
    const lines = draft.length === 0 ? 1 : draft.split('\n').length;
    return { charCount: draft.length, lineCount: lines };
  }, [draft]);

  return {
    draft,
    saved: initialText,
    dirty: draft !== initialText,
    charCount: counts.charCount,
    lineCount: counts.lineCount,
    setDraft,
    save,
    discard,
  };
}

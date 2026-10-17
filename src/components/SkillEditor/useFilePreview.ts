import { useCallback, useEffect, useRef, useState } from 'react';
import type { ZipArchive, ZipEntry } from '../../lib/zip/zipArchive';
import type { SkillFileNode, SkillTree } from '../../lib/skillTree';
import {
  IMAGE_PREVIEW_LIMIT,
  TEXT_PREVIEW_LIMIT,
  detectFileKind,
  mimeForPath,
  type FileKind,
} from '../../lib/fileKind';
import { formatBytes } from '../../lib/format';

/** Which pane the editor renders on the right. */
export type PreviewMode = 'preview' | 'placeholder';

/** State machine for the right-hand pane. */
export type PreviewState =
  | { readonly kind: 'empty' }
  | { readonly kind: 'loading'; readonly node: SkillFileNode; readonly fileKind: FileKind }
  | {
      readonly kind: 'markdown' | 'text';
      readonly node: SkillFileNode;
      readonly fileKind: FileKind;
      readonly text: string;
      readonly notice: string | null;
    }
  | {
      readonly kind: 'image';
      readonly node: SkillFileNode;
      readonly fileKind: FileKind;
      readonly objectUrl: string;
    }
  | {
      /** A custom previewer claimed the file, so the raw bytes are available. */
      readonly kind: 'custom';
      readonly node: SkillFileNode;
      readonly fileKind: FileKind;
      readonly bytes: Uint8Array;
      readonly blob: Blob;
      readonly objectUrl: string;
    }
  | { readonly kind: 'binary' | 'unsupported'; readonly node: SkillFileNode; readonly fileKind: FileKind }
  | { readonly kind: 'error'; readonly node: SkillFileNode; readonly fileKind: FileKind; readonly message: string };

export interface UseFilePreviewOptions {
  /** Parsed archive, or `null` before the first successful load. */
  readonly archive: ZipArchive | null;
  /** Tree-relative lookup used to resolve the selected node. */
  readonly tree: SkillTree | null;
  /** Path of the highlighted node, relative to the tree root. */
  readonly selectedPath: string | null;
  /** Text size limit before the preview is truncated. */
  readonly textLimit?: number;
  /**
   * Returns `true` when a custom previewer owns this file. Its bytes are then
   * read (up to `customLimit`) even for files the built-in previews skip.
   */
  readonly isCustomPreview?: (node: SkillFileNode) => boolean;
  /** Size limit for files read on behalf of a custom previewer. */
  readonly customLimit?: number;
}

/**
 * Load the payload of the selected file and publish it as a `PreviewState`.
 *
 * Text decoding is capped (the first `textLimit` bytes are shown with a notice)
 * so a large file cannot lock up the pane; images become object URLs that are
 * revoked when the selection changes or the editor unmounts. Reads are keyed by
 * path, so a stale response can never overwrite a newer selection.
 */
export function useFilePreview({
  archive,
  tree,
  selectedPath,
  textLimit = TEXT_PREVIEW_LIMIT,
  isCustomPreview,
  customLimit = IMAGE_PREVIEW_LIMIT,
}: UseFilePreviewOptions): PreviewState {
  const [state, setState] = useState<PreviewState>({ kind: 'empty' });
  const objectUrlRef = useRef<string | null>(null);
  // Incremented for every load; an in-flight load whose id no longer matches is dropped.
  const loadIdRef = useRef(0);

  const releaseObjectUrl = useCallback(() => {
    if (objectUrlRef.current !== null) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    const node = selectedPath ? tree?.byPath.get(selectedPath) : undefined;

    if (!archive || !node || node.kind !== 'file' || node.zipEntry === undefined) {
      loadIdRef.current += 1;
      releaseObjectUrl();
      setState({ kind: 'empty' });
      return;
    }

    const entry: ZipEntry = node.zipEntry;
    const id = (loadIdRef.current += 1);
    const fileKind = detectFileKind(node.path);
    const fresh = (): boolean => loadIdRef.current === id;

    releaseObjectUrl();
    setState({ kind: 'loading', node, fileKind });

    void (async () => {
      try {
        // A custom previewer wins over the built-in handling, so its bytes are
        // read even for files the built-in preview would never touch.
        if (isCustomPreview?.(node)) {
          if (entry.size > customLimit) {
            if (fresh()) setState({ kind: 'unsupported', node, fileKind });
            return;
          }
          const bytes = await archive.readEntry(entry);
          if (!fresh()) return;
          const blob = new Blob([bytes.slice() as BlobPart], { type: mimeForPath(node.path) });
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          setState({ kind: 'custom', node, fileKind, bytes, blob, objectUrl: url });
          return;
        }

        if (fileKind === 'image') {
          if (entry.size > IMAGE_PREVIEW_LIMIT) {
            if (fresh()) setState({ kind: 'unsupported', node, fileKind });
            return;
          }
          const bytes = await archive.readEntry(entry);
          if (!fresh()) return;
          const url = URL.createObjectURL(new Blob([bytes.slice() as BlobPart], { type: mimeForPath(node.path) }));
          objectUrlRef.current = url;
          setState({ kind: 'image', node, fileKind, objectUrl: url });
          return;
        }

        if (entry.size > textLimit) {
          if (fresh()) setState({ kind: 'unsupported', node, fileKind });
          return;
        }

        const bytes = await archive.readEntry(entry);
        if (!fresh()) return;
        const text = new TextDecoder('utf-8').decode(bytes);
        const notice =
          fileKind === 'text' && text.includes('\uFFFD')
            ? '该文件不是有效的 UTF-8 文本，部分字符可能显示异常。'
            : null;
        setState({
          kind: fileKind === 'markdown' ? 'markdown' : 'text',
          node,
          fileKind,
          text,
          notice,
        });
      } catch (caught) {
        if (!fresh()) return;
        setState({
          kind: 'error',
          node,
          fileKind,
          message: caught instanceof Error ? caught.message : '读取文件失败。',
        });
      }
    })();

    return () => {
      // A newer selection or an unmount invalidates this load.
      loadIdRef.current += 1;
    };
  }, [archive, tree, selectedPath, textLimit, isCustomPreview, customLimit, releaseObjectUrl]);

  // Revoke the last object URL when the editor goes away.
  useEffect(() => releaseObjectUrl, [releaseObjectUrl]);

  return state;
}

/** Human-readable label for a preview state, used by status text. */
export function describePreviewState(state: PreviewState): string | null {
  if (state.kind === 'empty') return null;
  if (state.kind === 'loading') return `正在读取 ${state.node.name}…`;
  if (state.kind === 'unsupported') {
    return state.fileKind === 'image'
      ? `图片过大，未生成预览（${formatBytes(state.node.size)}）。`
      : `文件过大，未生成预览（${formatBytes(state.node.size)}）。`;
  }
  if (state.kind === 'error') return state.message;
  return null;
}

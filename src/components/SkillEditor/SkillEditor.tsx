import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, DragEvent, KeyboardEvent, ReactNode } from 'react';
import { loadSkillArchive } from '../../lib/loadSkillArchive';
import type { SkillArchiveResult } from '../../lib/loadSkillArchive';
import { SkillDocument } from '../../lib/document/skillDocument';
import type { ExportOptions, ExportResult } from '../../lib/document/skillDocument';
import {
  ancestorPaths,
  defaultExpandedPaths,
  flattenTree,
} from '../../lib/skillTree';
import type { SkillFileNode, SkillTreeNode } from '../../lib/skillTree';
import { detectFileKind } from '../../lib/fileKind';
import type { FileKind } from '../../lib/fileKind';
import { formatBytes } from '../../lib/format';
import { FileTree } from './FileTree';
import type { FileTreeRowContext } from './FileTree';
import { FilePreview } from './FilePreview';
import type { FilePreviewProps, PreviewView } from './FilePreview';
import {
  describePreviewFile,
  findPreviewer,
  type FilePreviewer,
} from './filePreviewer';
import { FileEditor } from './FileEditor';
import { renderMarkdown } from '../../lib/markdown.tsx';
import { useConfirm } from './useConfirm';
import { useFilePreview, type PreviewMode, type PreviewState } from './useFilePreview';
import {
  AlertIcon,
  ChevronRightIcon,
  CollapseAllIcon,
  ExpandAllIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  MarkdownIcon,
  SpinnerIcon,
  UploadIcon,
} from './icons';
import './SkillEditor.css';

export type SkillEditorStatus = 'idle' | 'parsing' | 'ready' | 'error';

/** Pending edits, reported through `onEditChange`. */
export interface EditSummary {
  /** `true` when at least one file has saved content changes. */
  readonly dirty: boolean;
  /** Number of files with saved changes. */
  readonly count: number;
  /** Paths of the changed files, in the order they were saved. */
  readonly paths: readonly string[];
  /** `true` while the unsaved draft cannot be recovered by leaving the editor. */
  readonly draftOpen: boolean;
}

/** Imperative API, reachable through a `ref`. */
export interface SkillEditorHandle {
  /** Re-parse the current file. */
  reload: () => void;
  /** The parsed archive, or `null` before the first successful load. */
  getResult: () => SkillArchiveResult | null;
  /** The editable document view, or `null` before the first successful load. */
  getDocument: () => SkillDocument | null;
  /** Expand or collapse a folder by path. */
  setExpanded: (path: string, expanded: boolean) => void;
  /** Expand every folder. */
  expandAll: () => void;
  /** Collapse every folder. */
  collapseAll: () => void;
  /** Path of the currently highlighted node, or `null`. */
  getSelectedPath: () => string | null;
  /** `true` when the document holds saved edits. */
  hasUnsavedChanges: () => boolean;
  /** Drop every saved edit (draft included) without prompting. */
  discardEdits: () => void;
  /**
   * Repack the archive with the saved edits applied. Prompts through the
   * built-in dialog when there are unsaved drafts or edits to confirm.
   * Resolves with `null` when the user cancels.
   */
  exportArchive: (options?: ExportOptions) => Promise<ExportResult | null>;
}

export interface SkillEditorProps {
  /**
   * The `.zip` file to display, owned by the host UI. Pass `null` (or omit the
   * prop) to show the empty state. The editor never picks files itself.
   */
  source?: Blob | ArrayBuffer | null;
  /** Extra class name for the root element. */
  className?: string;
  /** Inline styles for the root element. */
  style?: CSSProperties;
  /**
   * Replaces the whole right-hand pane. When omitted, the pane shows the file
   * preview (`previewMode="preview"`, the default) or a placeholder.
   */
  children?: ReactNode;
  /**
   * `preview` (default) renders the selected file's content on the right;
   * `placeholder` keeps the pane empty for hosts that supply their own view.
   */
  previewMode?: PreviewMode;
  /** Replaces the built-in preview body, keeping its header and actions. */
  renderFilePreview?: (state: PreviewState, props: FilePreviewProps) => ReactNode;
  /**
   * Custom previews for specific file types, e.g. fonts, PDFs or a JSON viewer.
   *
   * The first previewer whose `match` returns `true` wins, its bytes are read
   * (up to `maxSizeBytes`-independent 20 MB) and `render` is called with the raw
   * payload once it is available. A matched previewer takes precedence over
   * `renderFilePreview`.
   */
  previewers?: readonly FilePreviewer[];
  /**
   * Allow editing text files. When `false` (the default) the pane is read-only
   * and no edit affordance is rendered.
   */
  editable?: boolean;
  /** Called after a file is parsed successfully. */
  onLoad?: (result: SkillArchiveResult) => void;
  /** Called when a file cannot be read as a ZIP archive. */
  onError?: (error: Error) => void;
  /** Called when the highlighted node changes. */
  onSelectChange?: (node: SkillTreeNode | null) => void;
  /** Called when saved edits change, so the host can gate its export button. */
  onEditChange?: (summary: EditSummary) => void;
  /** Reject files larger than this; defaults to 100 MB. */
  maxSizeBytes?: number;
  /** Initial expansion depth for folder nodes; defaults to 1. */
  defaultExpandedDepth?: number;
  /**
   * Hide the expand/collapse-all control in the tree panel header. The
   * `expandAll` / `collapseAll` handle methods stay available either way.
   */
  hideExpandToggle?: boolean;
  /** Rendered when no archive has been loaded. */
  emptyState?: ReactNode;
}

const DEFAULT_MAX_SIZE = 100 * 1024 * 1024;

function isZipLikeFile(file: File): boolean {
  if (/\.zip$/i.test(file.name)) return true;
  return (
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed' ||
    file.type === 'multipart/x-zip'
  );
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : '读取压缩包时发生未知错误。');
}

function iconForFile(name: string): ReactNode {
  return /\.(md|markdown)$/i.test(name) ? (
    <MarkdownIcon className="se-icon se-icon--md" />
  ) : (
    <FileIcon className="se-icon se-icon--file" />
  );
}

/** Map the preview state machine onto `FilePreview` props. */
function toPreviewProps(
  state: Exclude<PreviewState, { kind: 'empty' }>,
  view: PreviewView | undefined,
  onViewChange: (view: PreviewView) => void,
): FilePreviewProps {
  const base: Pick<FilePreviewProps, 'path' | 'name' | 'size' | 'kind' | 'view' | 'onViewChange'> = {
    path: state.node.path,
    name: state.node.name,
    size: state.node.size,
    kind: state.fileKind,
    view,
    onViewChange,
  };

  switch (state.kind) {
    case 'loading':
      return { ...base, status: 'loading' };
    case 'error':
      return { ...base, status: 'error', error: state.message };
    case 'markdown':
    case 'text':
      return { ...base, status: 'ready', text: state.text, notice: state.notice };
    case 'image':
      return { ...base, status: 'ready', objectUrl: state.objectUrl };
    case 'custom':
      // The custom previewer renders through the `readyBody` prop.
      return { ...base, status: 'ready' };
    case 'unsupported':
      return {
        ...base,
        status: 'ready',
        notice:
          state.fileKind === 'image'
            ? `图片过大，未生成预览（${formatBytes(state.node.size)}）。`
            : `文件过大，未生成预览（${formatBytes(state.node.size)}）。`,
      };
    case 'binary':
    default:
      return { ...base, status: 'ready' };
  }
}

/**
 * `SkillEditor` — left pane: directory tree of an uploaded skill package;
 * right pane: content preview of the selected file.
 */
export const SkillEditor = forwardRef<SkillEditorHandle, SkillEditorProps>(
  function SkillEditor(props, ref) {
    const {
      source: sourceProp,
      className,
      style,
      children,
      previewMode = 'preview',
      renderFilePreview,
      previewers,
      editable = false,
      onLoad,
      onError,
      onSelectChange,
      onEditChange,
      maxSizeBytes = DEFAULT_MAX_SIZE,
      defaultExpandedDepth = 1,
      hideExpandToggle = false,
      emptyState,
    } = props;

    // The host owns the file; the editor only ever reads `source`.
    const source = sourceProp ?? null;

    const [result, setResult] = useState<SkillArchiveResult | null>(null);
    const [status, setStatus] = useState<SkillEditorStatus>('idle');
    const [error, setError] = useState<Error | null>(null);
    const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(new Set());
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [previewView, setPreviewView] = useState<PreviewView | undefined>(undefined);
    const [document, setDocument] = useState<SkillDocument | null>(null);
    const [editing, setEditing] = useState(false);
    const [dirtyCount, setDirtyCount] = useState(0);
    const [exporting, setExporting] = useState(false);

    const latestSource = useRef<Blob | ArrayBuffer | null>(null);
    const loadId = useRef(0);
    const onLoadRef = useRef(onLoad);
    const onErrorRef = useRef(onError);
    const onSelectChangeRef = useRef(onSelectChange);
    const onEditChangeRef = useRef(onEditChange);
    const documentRef = useRef<SkillDocument | null>(null);
    const editorDraftRef = useRef<{ text: string; saved: string } | undefined>(undefined);
    const defaultDepthRef = useRef(defaultExpandedDepth);

    onLoadRef.current = onLoad;
    onErrorRef.current = onError;
    onSelectChangeRef.current = onSelectChange;
    onEditChangeRef.current = onEditChange;
    documentRef.current = document;
    defaultDepthRef.current = defaultExpandedDepth;

    const confirmController = useConfirm();

    const parse = useCallback((next: Blob | ArrayBuffer | null) => {
      const id = loadId.current + 1;
      loadId.current = id;

      if (!next || (next instanceof Blob && next.size === 0)) {
        setResult(null);
        setError(null);
        setStatus('idle');
        setExpandedPaths(new Set());
        setSelectedPath(null);
        setEditing(false);
        setDocument(null);
        setDirtyCount(0);
        return;
      }

      setStatus('parsing');
      setError(null);

      void (async () => {
        try {
          const fileName =
            next instanceof Blob && typeof (next as File).name === 'string'
              ? (next as File).name
              : 'archive.zip';
          const file = new File([next as Blob], fileName, { type: 'application/zip' });
          const parsed = await loadSkillArchive(file);
          if (loadId.current !== id) return;
          setResult(parsed);
          setExpandedPaths(new Set(defaultExpandedPaths(parsed.tree, defaultDepthRef.current)));
          setSelectedPath(null);
          setPreviewView(undefined);
          setEditing(false);
          setDirtyCount(0);
          setDocument(await SkillDocument.fromBlob(file, { fileName }));
          if (loadId.current !== id) return;
          setStatus('ready');
          onLoadRef.current?.(parsed);
        } catch (caught) {
          if (loadId.current !== id) return;
          const failure = toError(caught);
          setResult(null);
          setDocument(null);
          setError(failure);
          setStatus('error');
          onErrorRef.current?.(failure);
        }
      })();
    }, []);

    // Load whenever the resolved source changes.
    useEffect(() => {
      latestSource.current = source;
      parse(source);
      return () => {
        // Invalidate any in-flight parse from this source.
        loadId.current += 1;
      };
    }, [source, parse]);

    const tree = result?.tree ?? null;
    const isExpanded = useCallback((path: string) => expandedPaths.has(path), [expandedPaths]);

    const rows = useMemo(
      () => (tree ? flattenTree(tree, isExpanded) : []),
      [tree, isExpanded],
    );

    const handleExpandAll = useCallback(() => {
      if (!tree) return;
      setExpandedPaths(
        new Set(tree.all.filter((node) => node.kind === 'folder').map((node) => node.path)),
      );
    }, [tree]);

    const handleCollapseAll = useCallback(() => setExpandedPaths(new Set()), []);

    /* ----------------------------- editing ------------------------------ */

    const dirtyPaths = useMemo(
      () => (document ? document.dirtyPaths : []),
      // `dirtyCount` is the signal that the document changed.
      [document, dirtyCount],
    );

    /** Tree paths of the saved edits, so rows can show an unsaved marker. */
    const dirtyTreePaths = useMemo(() => {
      if (!tree || dirtyPaths.length === 0) return new Set<string>();
      const files = tree.all.filter(
        (node): node is SkillFileNode => node.kind === 'file',
      );
      const paths = new Set<string>();
      for (const editPath of dirtyPaths) {
        const suffix = `/${editPath}`;
        const matches = files.filter((node) => suffix.endsWith(`/${node.path}`));
        if (matches.length === 1) paths.add(matches[0].path);
      }
      return paths;
    }, [tree, dirtyPaths]);

    const notifyEditChange = useCallback((doc: SkillDocument | null, draftOpen: boolean) => {
      onEditChangeRef.current?.({
        dirty: (doc?.dirtyCount ?? 0) > 0,
        count: doc?.dirtyCount ?? 0,
        paths: doc?.dirtyPaths ?? [],
        draftOpen,
      });
    }, []);

    useEffect(() => {
      setDirtyCount(document?.dirtyCount ?? 0);
      notifyEditChange(document, editing);
    }, [document, dirtyCount, editing, notifyEditChange]);


    /**
     * Open a package-internal link in the preview pane.
     *
     * Returns `false` when the link points at nothing, so the preview can show a
     * notice instead of a dead click. Lookup is case-insensitive and falls back
     * to a unique path suffix, because Markdown in the wild writes `SKILL.md`
     * and `./references/api-index.md` for the same records the tree stores
     * verbatim.
     */
    const navigateToPath = useCallback(
      (target: { path: string; fragment: string | null }): boolean => {
        if (!tree || !target.path) return false;
        const wanted = target.path.replace(/\/+$/, '').toLowerCase();

        let node = tree.byPath.get(target.path);
        if (!node) node = tree.byPath.get(target.path.replace(/\/+$/, ''));
        if (!node) {
          const matches = tree.all.filter(
            (candidate) =>
              candidate.kind === 'file' &&
              (candidate.pathLower === wanted ||
                candidate.pathLower.endsWith(`/${wanted}`) ||
                candidate.name.toLowerCase() === wanted),
          );
          node = matches.length === 1 ? matches[0] : undefined;
        }
        if (!node || node.kind !== 'file') return false;

        setSelectedPath(node.path);
        setPreviewView(undefined);
        setEditing(false);
        setExpandedPaths((current) => {
          const ancestors = ancestorPaths(node.path);
          if (ancestors.every((path) => current.has(path))) return current;
          const next = new Set(current);
          for (const path of ancestors) next.add(path);
          return next;
        });
        onSelectChangeRef.current?.(node);
        return true;
      },
      [tree],
    );

    const handleToggle = useCallback((node: SkillTreeNode) => {
      if (node.kind !== 'folder') return;
      setExpandedPaths((current) => {
        const next = new Set(current);
        if (next.has(node.path)) next.delete(node.path);
        else {
          next.add(node.path);
          // Reveal newly expanded folders by opening their direct children.
          for (const child of node.children) {
            if (child.kind === 'folder') next.add(child.path);
          }
        }
        return next;
      });
    }, []);

    /**
     * One-click toggle for the whole tree: collapse everything when at least one
     * folder is open, otherwise open every folder. An empty tree has nothing to
     * toggle, so the state stays put.
     */
    const handleToggleAll = useCallback(() => {
      if (!tree || tree.folderCount === 0) return;
      const allFolded = tree.all.every(
        (node) => node.kind !== 'folder' || !expandedPaths.has(node.path),
      );
      if (allFolded) handleExpandAll();
      else handleCollapseAll();
    }, [tree, expandedPaths, handleExpandAll, handleCollapseAll]);

    // ⌘/Ctrl+E expands everything, ⌘/Ctrl+Shift+E folds it back up.
    const handleRootKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>) => {
        if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
        if (event.key.toLowerCase() !== 'e') return;
        if (tree?.folderCount === 0) return;
        event.preventDefault();
        if (event.shiftKey) handleCollapseAll();
        else handleExpandAll();
      },
      [tree, handleExpandAll, handleCollapseAll],
    );

    const allFoldersExpanded =
      tree !== null &&
      tree.folderCount > 0 &&
      tree.all.every((node) => node.kind !== 'folder' || expandedPaths.has(node.path));

    /** Kinds of the files that may be edited, keyed by tree path. */
    const editableKinds = useMemo(() => {
      const kinds = new Map<string, FileKind>();
      if (!editable || !tree) return kinds;
      for (const node of tree.all) {
        if (node.kind !== 'file') continue;
        const kind = detectFileKind(node.path);
        if (kind === 'markdown' || kind === 'text') kinds.set(node.path, kind);
      }
      return kinds;
    }, [editable, tree]);

    /**
     * The file the right pane edits: simply the selected file while the editor
     * is open. Keeping it derived means the editor always shows the current
     * selection and follows it without extra state to keep in sync.
     */
    const selectedNode = useMemo(() => {
      if (!tree || !selectedPath) return null;
      const node = tree.byPath.get(selectedPath);
      return node && node.kind === 'file' ? node : null;
    }, [tree, selectedPath]);

    /** Description of the selected file, as handed to custom previewers. */
    const selectedFileInfo = useMemo(
      () => (selectedNode ? describePreviewFile(selectedNode.path, selectedNode.size) : null),
      [selectedNode],
    );

    /** Host previewer registered for the selected file, if any. */
    const activePreviewer = useMemo(
      () => (selectedFileInfo ? findPreviewer(previewers, selectedFileInfo) : undefined),
      [previewers, selectedFileInfo],
    );

    /**
     * Tells the preview machine to read the payload even for files the built-in
     * previews skip (fonts, PDFs, archives …), because a previewer needs bytes.
     */
    const isCustomPreview = useCallback(
      (node: SkillFileNode) => activePreviewer?.match(describePreviewFile(node.path, node.size)) ?? false,
      [activePreviewer],
    );

    const previewState = useFilePreview({
      archive: result?.archive ?? null,
      tree,
      selectedPath,
      isCustomPreview,
    });

    /** `true` when the selected file can be edited at all. */
    const canEditCurrent = selectedNode !== null && editableKinds.has(selectedNode.path);
    const editorNode = editing && canEditCurrent ? selectedNode : null;

    /**
     * Text the editor starts from. The document is the source of truth once an
     * edit exists; before that the loaded preview supplies the archive content.
     */
    const editorText = useMemo(() => {
      if (!editorNode || !document) return null;
      const edit = document.getEdit(editorNode.path);
      if (edit) return edit.text;
      const state = previewState;
      if (
        (state.kind === 'markdown' || state.kind === 'text') &&
        state.node.path === editorNode.path
      ) {
        return state.text;
      }
      // Still loading (or the payload could not be read): don't open an empty
      // editor, wait until the content is available.
      return null;
    }, [editorNode, document, previewState]);

    const saveDraft = useCallback(
      (path: string, text: string) => {
        const doc = documentRef.current;
        if (!doc) return;
        doc.write(path, text);
        setDirtyCount(doc.dirtyCount);
        notifyEditChange(doc, true);
      },
      [notifyEditChange],
    );

    const exitEditor = useCallback(() => {
      setEditing(false);
      setPreviewView('rendered');
      notifyEditChange(documentRef.current, false);
    }, [notifyEditChange]);

    const discardAllEdits = useCallback(() => {
      const doc = documentRef.current;
      doc?.revert();
      setEditing(false);
      setDirtyCount(doc?.dirtyCount ?? 0);
      notifyEditChange(doc, false);
    }, [notifyEditChange]);

    const exportArchive = useCallback(
      async (options: ExportOptions = {}): Promise<ExportResult | null> => {
        const doc = documentRef.current;
        if (!doc) return null;
        const internal = { ...options };

        if (dirtyCount === 0) {
          const proceed = await confirmController.confirm({
            title: '导出压缩包',
            message: '当前没有任何改动，仍要重新打包并导出吗？',
            confirmLabel: '仍然导出',
            cancelLabel: '取消',
          });
          if (proceed !== 'confirm') return null;
        } else {
          const proceed = await confirmController.confirm({
            title: '导出前确认',
            message: `将生成新的 .zip，包含 ${doc.entries().filter((entry) => !entry.isDirectory).length} 个文件，其中 ${dirtyCount} 个已修改。`,
            details: [
              '重打包会丢失源压缩包的 extra field、压缩包注释与文件属性等元数据。',
              '未修改文件的内容、路径与压缩数据保持不变。',
            ],
            confirmLabel: '仍然导出',
            cancelLabel: '取消',
          });
          if (proceed !== 'confirm') return null;
        }

        setExporting(true);
        try {
          return await doc.exportArchive(internal);
        } finally {
          setExporting(false);
        }
      },
      [confirmController, dirtyCount],
    );

    const handleSelect = useCallback(
      (node: SkillTreeNode) => {
        // Same row: nothing to do, and nothing to guard.
        if (node.path === selectedPath) return;

        const commitSelection = (): void => {
          setSelectedPath(node.path);
          // A different file resets the Markdown view toggle to its default.
          setPreviewView(undefined);
          setEditing(false);
          // Expanding a collapsed branch should reveal the selected node.
          setExpandedPaths((current) => {
            const ancestors = ancestorPaths(node.path);
            if (ancestors.every((path) => current.has(path))) return current;
            const next = new Set(current);
            for (const path of ancestors) next.add(path);
            return next;
          });
          onSelectChangeRef.current?.(node);
        };

        const draft = editorDraftRef.current;
        if (!editing || draft === undefined || draft.text === draft.saved) {
          commitSelection();
          return;
        }

        const path = editorNode!.path;
        void (async () => {
          const answer = await confirmController.confirm({
            title: '有未保存的修改',
            message: (
              <>
                <code>{path}</code> 在编辑器里还有未保存的内容，切换文件前要保存吗？
              </>
            ),
            confirmLabel: '保存并切换',
            discardLabel: '放弃修改并切换',
            cancelLabel: '取消',
          });
          if (answer === 'cancel') return;
          if (answer === 'confirm') saveDraft(path, draft.text);
          setEditing(false);
          commitSelection();
        })();
      },
      [confirmController, editing, editorNode, saveDraft, selectedPath],
    );

    useImperativeHandle(
      ref,
      (): SkillEditorHandle => ({
        reload: () => parse(latestSource.current),
        getResult: () => result,
        getDocument: () => documentRef.current,
        setExpanded: (path, expanded) =>
          setExpandedPaths((current) => {
            const next = new Set(current);
            if (expanded) next.add(path);
            else next.delete(path);
            return next;
          }),
        expandAll: () => handleExpandAll(),
        collapseAll: () => handleCollapseAll(),
        getSelectedPath: () => selectedPath,
        hasUnsavedChanges: () => (documentRef.current?.dirtyCount ?? 0) > 0,
        discardEdits: discardAllEdits,
        exportArchive,
      }),
      [
        parse,
        result,
        selectedPath,
        handleExpandAll,
        handleCollapseAll,
        discardAllEdits,
        exportArchive,
      ],
    );

    /**
     * Guard a file that the user dropped onto the editor. Files normally arrive
     * through `source`; a drop is an opt-in shortcut handled entirely here.
     */
    const acceptDroppedFile = useCallback(
      (file: File | undefined | null) => {
        if (!file) return;
        if (!isZipLikeFile(file)) {
          const failure = new Error(`仅支持 .zip 文件，当前文件类型为“${file.type || '未知'}”。`);
          setStatus('error');
          setError(failure);
          onErrorRef.current?.(failure);
          return;
        }
        if (file.size > maxSizeBytes) {
          const failure = new Error(
            `文件过大（${formatBytes(file.size)}），上限为 ${formatBytes(maxSizeBytes)}。`,
          );
          setStatus('error');
          setError(failure);
          onErrorRef.current?.(failure);
          return;
        }
        parse(file);
      },
      [maxSizeBytes, parse],
    );

    const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setIsDragging(true);
    };

    const handleDragLeave = (event: DragEvent<HTMLDivElement>): void => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setIsDragging(false);
    };

    const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      setIsDragging(false);
      acceptDroppedFile(event.dataTransfer.files?.[0]);
    };

    const rootClassName = ['se-root', isDragging ? 'se-root--dragging' : '', className]
      .filter(Boolean)
      .join(' ');
    const renderRow = ({ row, depth, expanded }: FileTreeRowContext): ReactNode => {
      const { node } = row;
      const isFolder = node.kind === 'folder';
      return (
        <div
          className={`se-tree__content${row.node.path === selectedPath ? ' is-selected' : ''}`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          title={node.path}
        >
          <span className={`se-tree__chevron${isFolder ? '' : ' is-hidden'}${expanded ? ' is-open' : ''}`}>
            {isFolder ? <ChevronRightIcon /> : null}
          </span>
          {isFolder ? (
            expanded ? (
              <FolderOpenIcon className="se-icon se-icon--folder" />
            ) : (
              <FolderIcon className="se-icon se-icon--folder" />
            )
          ) : (
            iconForFile(node.name)
          )}
          <span className="se-tree__name">{node.name}</span>
          {node.kind === 'file' && dirtyTreePaths.has(node.path) && (
            <span className="se-tree__dirty" title="有未导出的修改" aria-label="有未导出的修改" />
          )}
          {node.kind === 'file' && (
            <span className="se-tree__meta">
              <span className="se-tree__size">{formatBytes(node.size)}</span>
            </span>
          )}
        </div>
      );
    };

    /**
     * Overlay the document's saved edits on the preview. `useFilePreview` reads
     * the immutable archive, so a saved edit would otherwise keep showing the
     * original text until the archive is re-parsed.
     */
    const resolvedPreviewState: PreviewState = useMemo(() => {
      if (!document) return previewState;
      if (previewState.kind !== 'markdown' && previewState.kind !== 'text') return previewState;
      const edit = document.getEdit(previewState.node.path);
      if (!edit || edit.text === previewState.text) return previewState;
      return { ...previewState, text: edit.text };
    }, [document, previewState, dirtyCount]);

    /**
     * Markdown is parsed once here and shared with preview and editor, so a
     * large document is not rendered twice while the pane is open.
     */
    const renderedMarkdown = useMemo(() => {
      if (resolvedPreviewState.kind !== 'markdown') return null;
      return renderMarkdown(resolvedPreviewState.text);
    }, [resolvedPreviewState]);

    const previewProps: FilePreviewProps | null =
      resolvedPreviewState.kind === 'empty'
        ? null
        : {
            ...toPreviewProps(resolvedPreviewState, previewView, setPreviewView),
            rendered: renderedMarkdown,
            // Defensive call: a navigation problem must never blank the pane.
            onNavigate: (target) => navigateToPath?.(target) ?? false,
          };

    /**
     * Body supplied by the matched custom previewer. Built only once the
     * payload is ready, so the pane still shows its loading state meanwhile.
     */
    const customReadyBody: ReactNode =
      resolvedPreviewState.kind === 'custom' && activePreviewer
        ? activePreviewer.render({
            info: describePreviewFile(resolvedPreviewState.node.path, resolvedPreviewState.node.size),
            bytes: resolvedPreviewState.bytes,
            blob: resolvedPreviewState.blob,
            objectUrl: resolvedPreviewState.objectUrl,
          })
        : null;

    const showEditor = editorNode !== null;
    const selectedIsDirty = selectedNode !== null && (document?.isDirty(selectedNode.path) ?? false);
    const editProps: FilePreviewProps | null = previewProps
      ? {
          ...previewProps,
          // The header's edit button switches the pane into the source editor.
          onEdit: canEditCurrent ? () => setEditing(true) : undefined,
          onRevertEdit:
            selectedNode && selectedIsDirty
              ? () => {
                  document?.revert(selectedNode.path);
                  setDirtyCount(document?.dirtyCount ?? 0);
                  notifyEditChange(document, editing);
                }
              : undefined,
          dirty: canEditCurrent && selectedIsDirty,
        }
      : null;

    const detailPane = children ?? (
      previewMode === 'placeholder' ? (
        <div className="se-detail-placeholder se-detail-placeholder--centered">
          <p>文件内容区域</p>
          <span>已切换为占位模式</span>
        </div>
      ) : showEditor && editorNode && editorText !== null ? (
        <FileEditor
          key={editorNode.path}
          name={editorNode.name}
          path={editorNode.path}
          size={editorNode.size}
          kind={editableKinds.get(editorNode.path) ?? 'text'}
          initialText={editorText}
          onSave={(text) => saveDraft(editorNode.path, text)}
          onExit={exitEditor}
          onDraftChange={(draft) => {
            editorDraftRef.current = draft;
          }}
        />
      ) : showEditor ? (
        <div className="se-preview__placeholder">
          <SpinnerIcon className="se-icon se-spin" />
          <p>正在读取文件…</p>
        </div>
      ) : editProps ? (
        <FilePreview
          {...editProps}
          readyBody={customReadyBody ?? undefined}
          renderBody={
            // A matched previewer is more specific than the catch-all override.
            customReadyBody || !renderFilePreview
              ? undefined
              : (props) => renderFilePreview(resolvedPreviewState, props)
          }
        />
      ) : (
        <div className="se-detail-placeholder se-detail-placeholder--centered">
          <p>尚未选择文件</p>
          <span>在左侧目录树中选择文件即可预览内容</span>
        </div>
      )
    );

    return (
      <div
        className={rootClassName}
        style={style}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onKeyDown={handleRootKeyDown}
      >
        <div className="se-body">
          <section className="se-panel se-panel--tree" aria-label="目录结构">
            <div className="se-panel__header">
              <span className="se-panel__title">目录结构</span>
              <div className="se-panel__header-actions">
                {tree && !hideExpandToggle && tree.folderCount > 0 && (
                  <button
                    type="button"
                    className="se-icon-button se-icon-button--small"
                    onClick={handleToggleAll}
                    aria-pressed={allFoldersExpanded}
                    title={`${allFoldersExpanded ? '全部收起' : '全部展开'}（Ctrl/⌘ + E）`}
                    aria-label={allFoldersExpanded ? '全部收起目录' : '全部展开目录'}
                  >
                    {allFoldersExpanded ? (
                      <CollapseAllIcon className="se-icon" />
                    ) : (
                      <ExpandAllIcon className="se-icon" />
                    )}
                  </button>
                )}
              </div>
            </div>

            <div className="se-tree-scroll">
              {tree ? (
                <FileTree
                  aria-label="技能包目录树"
                  testId="se-tree"
                  dataState={status}
                  className="se-tree"
                  rows={rows}
                  selectedPath={selectedPath}
                  isExpanded={isExpanded}
                  onToggle={handleToggle}
                  onSelect={handleSelect}
                  renderRow={renderRow}
                  emptyState={<div className="se-empty se-empty--inline">压缩包是空的。</div>}
                />
              ) : (
                <EmptyState status={status} error={error} custom={emptyState} />
              )}
            </div>
          </section>

          <section className="se-panel se-panel--detail" aria-label="文件详情">
            {detailPane}
          </section>
        </div>

        {status === 'parsing' && (
          <div className="se-status" role="status">
            <SpinnerIcon className="se-icon se-spin" />
            <span>正在解析压缩包…</span>
          </div>
        )}

        {exporting && (
          <div className="se-status" role="status">
            <SpinnerIcon className="se-icon se-spin" />
            <span>正在重新打包…</span>
          </div>
        )}

        {isDragging && <div className="se-drop-hint">松开以载入 .zip 文件</div>}

        {confirmController.dialog}
      </div>
    );
  },
);

interface EmptyStateProps {
  status: SkillEditorStatus;
  error: Error | null;
  custom?: ReactNode;
}

function EmptyState({ status, error, custom }: EmptyStateProps) {
  if (status === 'parsing') {
    return (
      <div className="se-empty">
        <SpinnerIcon className="se-icon se-spin" />
        <p>正在解析压缩包…</p>
      </div>
    );
  }

  if (status === 'error' && error) {
    return (
      <div className="se-empty se-empty--error" role="alert">
        <AlertIcon className="se-icon" />
        <p>无法解析该文件</p>
        <span>{error.message}</span>
      </div>
    );
  }

  if (custom) return <>{custom}</>;

  return (
    <div className="se-empty">
      <UploadIcon className="se-icon" />
      <p>尚未载入技能包</p>
    </div>
  );
}

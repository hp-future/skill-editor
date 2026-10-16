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
import {
  ancestorPaths,
  defaultExpandedPaths,
  flattenTree,
} from '../../lib/skillTree';
import type { SkillTreeNode } from '../../lib/skillTree';
import { formatBytes } from '../../lib/format';
import { FileTree } from './FileTree';
import type { FileTreeRowContext } from './FileTree';
import { FilePreview } from './FilePreview';
import type { FilePreviewProps, PreviewView } from './FilePreview';
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

/** Imperative API, reachable through a `ref`. */
export interface SkillEditorHandle {
  /** Re-parse the current file. */
  reload: () => void;
  /** The parsed archive, or `null` before the first successful load. */
  getResult: () => SkillArchiveResult | null;
  /** Expand or collapse a folder by path. */
  setExpanded: (path: string, expanded: boolean) => void;
  /** Expand every folder. */
  expandAll: () => void;
  /** Collapse every folder. */
  collapseAll: () => void;
  /** Path of the currently highlighted node, or `null`. */
  getSelectedPath: () => string | null;
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
  /** Called after a file is parsed successfully. */
  onLoad?: (result: SkillArchiveResult) => void;
  /** Called when a file cannot be read as a ZIP archive. */
  onError?: (error: Error) => void;
  /** Called when the highlighted node changes. */
  onSelectChange?: (node: SkillTreeNode | null) => void;
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
      onLoad,
      onError,
      onSelectChange,
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

    const latestSource = useRef<Blob | ArrayBuffer | null>(null);
    const loadId = useRef(0);
    const onLoadRef = useRef(onLoad);
    const onErrorRef = useRef(onError);
    const onSelectChangeRef = useRef(onSelectChange);
    const defaultDepthRef = useRef(defaultExpandedDepth);

    onLoadRef.current = onLoad;
    onErrorRef.current = onError;
    onSelectChangeRef.current = onSelectChange;
    defaultDepthRef.current = defaultExpandedDepth;

    const parse = useCallback((next: Blob | ArrayBuffer | null) => {
      const id = loadId.current + 1;
      loadId.current = id;

      if (!next || (next instanceof Blob && next.size === 0)) {
        setResult(null);
        setError(null);
        setStatus('idle');
        setExpandedPaths(new Set());
        setSelectedPath(null);
        return;
      }

      setStatus('parsing');
      setError(null);

      void (async () => {
        try {
          const file =
            next instanceof Blob && typeof (next as File).name === 'string'
              ? (next as File)
              : new File([next as Blob], 'archive.zip', { type: 'application/zip' });
          const parsed = await loadSkillArchive(file);
          if (loadId.current !== id) return;
          setResult(parsed);
          setExpandedPaths(new Set(defaultExpandedPaths(parsed.tree, defaultDepthRef.current)));
          setSelectedPath(null);
          setPreviewView(undefined);
          setStatus('ready');
          onLoadRef.current?.(parsed);
        } catch (caught) {
          if (loadId.current !== id) return;
          const failure = toError(caught);
          setResult(null);
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

    useImperativeHandle(
      ref,
      (): SkillEditorHandle => ({
        reload: () => parse(latestSource.current),
        getResult: () => result,
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
      }),
      [parse, result, selectedPath, handleExpandAll, handleCollapseAll],
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

    const handleSelect = useCallback(
      (node: SkillTreeNode) => {
        setSelectedPath(node.path);
        // A different file resets the Markdown view toggle to its default.
        setPreviewView(undefined);
        // Expanding a collapsed branch should reveal the selected node.
        setExpandedPaths((current) => {
          const ancestors = ancestorPaths(node.path);
          if (ancestors.every((path) => current.has(path))) return current;
          const next = new Set(current);
          for (const path of ancestors) next.add(path);
          return next;
        });
        onSelectChangeRef.current?.(node);
      },
      [],
    );

    const previewState = useFilePreview({
      archive: result?.archive ?? null,
      tree,
      selectedPath,
    });

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
          {node.kind === 'file' && (
            <span className="se-tree__meta">
              <span className="se-tree__size">{formatBytes(node.size)}</span>
            </span>
          )}
        </div>
      );
    };

    const previewProps: FilePreviewProps | null =
      previewState.kind === 'empty' ? null : toPreviewProps(previewState, previewView, setPreviewView);

    const detailPane = children ?? (
      previewMode === 'placeholder' ? (
        <div className="se-detail-placeholder se-detail-placeholder--centered">
          <p>文件内容区域</p>
          <span>已切换为占位模式</span>
        </div>
      ) : previewProps ? (
        <FilePreview
          {...previewProps}
          renderBody={
            renderFilePreview ? (props) => renderFilePreview(previewState, props) : undefined
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

        {isDragging && <div className="se-drop-hint">松开以载入 .zip 文件</div>}
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

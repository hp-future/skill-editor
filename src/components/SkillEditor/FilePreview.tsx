import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatBytes } from '../../lib/format';
import { mimeForPath, type FileKind } from '../../lib/fileKind';
import { renderMarkdown } from '../../lib/markdown.tsx';
import {
  AlertIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FileQuestionIcon,
  FilesIcon,
  ImageIcon,
  SpinnerIcon,
} from './icons';
import './FilePreview.css';

export type PreviewView = 'source' | 'rendered';

export interface FilePreviewProps {
  /** Path of the file inside the archive, used as the display title. */
  readonly path: string;
  /** File name (last path segment) shown in the breadcrumb. */
  readonly name?: string;
  /** Uncompressed size in bytes, when known. */
  readonly size?: number;
  /** Classified content kind. */
  readonly kind: FileKind;
  /** Current state of the payload. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  /** Decoded text for markdown / text files. */
  readonly text?: string;
  /** Object URL for image files. */
  readonly objectUrl?: string;
  /** Message shown when `status` is `error`. */
  readonly error?: string | null;
  /** Non-fatal warning, e.g. a truncated preview. */
  readonly notice?: string | null;
  /** Extra class name for the root element. */
  readonly className?: string;
  /** View override; Markdown defaults to `rendered`, everything else `source`. */
  readonly view?: PreviewView;
  /** Called when the user switches between source and rendered views. */
  readonly onViewChange?: (view: PreviewView) => void;
  /** Replaces the built-in body entirely. */
  readonly renderBody?: (props: FilePreviewProps) => React.ReactNode;
}

/** Save bytes to disk, using the File System Access API when available. */
async function saveBlob(blob: Blob, fileName: string): Promise<void> {
  const picker = (
    globalThis as typeof globalThis & {
      showSaveFilePicker?: (options: unknown) => Promise<{
        createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
      }>;
    }
  ).showSaveFilePicker;

  if (typeof picker === 'function') {
    try {
      const handle = await picker({ suggestedName: fileName });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (error) {
      // User cancelled, or the picker is blocked: fall back to a download.
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function kindLabel(kind: FileKind): string {
  switch (kind) {
    case 'markdown':
      return 'Markdown';
    case 'image':
      return '图片';
    case 'text':
      return '文本';
    default:
      return '二进制';
  }
}

/**
 * Right-hand pane content: header with file metadata plus a body that adapts to
 * the payload — rendered Markdown, source text, an inline image, or a fallback
 * notice for anything that cannot be shown as text.
 */
export function FilePreview(props: FilePreviewProps) {
  const {
    path,
    name,
    size,
    kind,
    status,
    text,
    objectUrl,
    error,
    notice,
    className,
    view,
    onViewChange,
    renderBody,
  } = props;

  const fileName = name ?? path.slice(path.lastIndexOf('/') + 1);
  const defaultView: PreviewView = kind === 'markdown' ? 'rendered' : 'source';
  const activeView = view ?? defaultView;
  const [copied, setCopied] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);

  // A new file means the previous copy confirmation is stale.
  useEffect(() => {
    setCopied(false);
    setImageFailed(false);
    return () => window.clearTimeout(copyTimer.current);
  }, [path, objectUrl]);

  /**
   * The scroll container is recreated when the view switches between rendered
   * Markdown and source, so reset its position as it mounts: a new file (and a
   * new view of it) should start at the top.
   */
  const setScrollElement = useCallback((element: HTMLDivElement | null) => {
    if (element) element.scrollTop = 0;
  }, []);

  const markdown = useMemo(
    () => (kind === 'markdown' && status === 'ready' && typeof text === 'string' ? renderMarkdown(text) : null),
    [kind, status, text],
  );

  const lines = useMemo(() => (typeof text === 'string' ? text.split('\n').length : 0), [text]);
  const canCopy = status === 'ready' && typeof text === 'string';

  const handleCopy = async (): Promise<void> => {
    if (!canCopy || typeof text !== 'string') return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const handleDownload = (): void => {
    // Images already expose an object URL; reuse it so no re-encode happens.
    if (kind === 'image' && objectUrl !== undefined) {
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return;
    }
    if (typeof text !== 'string') return;
    void saveBlob(new Blob([text], { type: mimeForPath(path) }), fileName);
  };

  const sourceText = typeof text === 'string' ? text : '';

  return (
    <div className={['se-preview', className].filter(Boolean).join(' ')}>
      <header className="se-preview__header">
        <FilesIcon className="se-icon se-icon--file" />
        <div className="se-preview__titles">
          <span className="se-preview__name" title={path}>
            {fileName}
          </span>
          <span className="se-preview__meta">
            <span className="se-preview__path">{path}</span>
            {typeof size === 'number' && <span className="se-preview__size">{formatBytes(size)}</span>}
            <span className="se-preview__kind">{kindLabel(kind)}</span>
            {lines > 0 && status === 'ready' && <span className="se-preview__size">{lines} 行</span>}
          </span>
        </div>

        <div className="se-preview__actions">
          {kind === 'markdown' && status === 'ready' && (
            <div className="se-toggle" role="group" aria-label="Markdown 视图">
              <button
                type="button"
                className={`se-toggle__button${activeView === 'rendered' ? ' is-active' : ''}`}
                aria-pressed={activeView === 'rendered'}
                onClick={() => onViewChange?.('rendered')}
              >
                <EyeIcon className="se-icon" />
                <span>预览</span>
              </button>
              <button
                type="button"
                className={`se-toggle__button${activeView === 'source' ? ' is-active' : ''}`}
                aria-pressed={activeView === 'source'}
                onClick={() => onViewChange?.('source')}
              >
                <CodeIcon className="se-icon" />
                <span>源码</span>
              </button>
            </div>
          )}

          <button
            type="button"
            className="se-icon-button"
            onClick={() => void handleCopy()}
            disabled={!canCopy}
            title={copied ? '已复制' : '复制内容'}
            aria-label={copied ? '已复制' : '复制内容'}
          >
            {copied ? <CheckIcon className="se-icon" /> : <CopyIcon className="se-icon" />}
          </button>
          <button
            type="button"
            className="se-icon-button"
            onClick={handleDownload}
            disabled={status === 'loading' || status === 'error'}
            title="下载该文件"
            aria-label="下载该文件"
          >
            <DownloadIcon className="se-icon" />
          </button>
        </div>
      </header>

      {notice && (
        <div className="se-preview__notice" role="status">
          <AlertIcon className="se-icon" />
          <span>{notice}</span>
        </div>
      )}

      {renderBody ? (
        renderBody(props)
      ) : (
        <div className="se-preview__body">
          {status === 'loading' && (
            <div className="se-preview__placeholder">
              <SpinnerIcon className="se-icon se-spin" />
              <p>正在读取文件…</p>
            </div>
          )}

          {status === 'error' && (
            <div className="se-preview__placeholder se-preview__placeholder--error" role="alert">
              <AlertIcon className="se-icon" />
              <p>无法读取该文件</p>
              <span>{error ?? '压缩包中的该条目已损坏。'}</span>
            </div>
          )}

          {status === 'ready' && kind === 'image' && objectUrl !== undefined && !imageFailed && (
            <figure className="se-preview__figure">
              <img
                className="se-preview__image"
                src={objectUrl}
                alt={fileName}
                loading="lazy"
                decoding="async"
                onError={() => setImageFailed(true)}
              />
              <figcaption>
                <ImageIcon className="se-icon" />
                <span>{fileName}</span>
              </figcaption>
            </figure>
          )}

          {status === 'ready' &&
            (kind === 'binary' || (kind === 'image' && (imageFailed || objectUrl === undefined))) && (
              <div className="se-preview__placeholder">
                <FileQuestionIcon className="se-icon" />
                <p>{kind === 'image' ? '图片无法显示' : '该文件为二进制内容，暂不支持预览'}</p>
                <span>
                  {typeof size === 'number' ? `${formatBytes(size)} · ` : ''}
                  使用右上角按钮下载后查看
                </span>
              </div>
            )}

          {status === 'ready' && kind !== 'image' && kind !== 'binary' && (
            // Keying by view guarantees a fresh scroll container per view, so
            // switching between rendered Markdown and source starts at the top.
            <div className="se-preview__scroll" key={activeView} ref={setScrollElement}>
              {kind === 'markdown' && activeView === 'rendered' && markdown ? (
                <article className="se-md">{markdown.nodes}</article>
              ) : (
                <pre className="se-preview__source" tabIndex={0}>
                  <code>{sourceText}</code>
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { formatBytes } from '../../lib/format';
import { mimeForPath, type FileKind } from '../../lib/fileKind';
import { renderMarkdown } from '../../lib/markdown.tsx';
import type { MarkdownHeading, MarkdownLink, RenderedMarkdown } from '../../lib/markdown.tsx';
import { isExternalHref } from '../../lib/markdown.tsx';
import { highlight, languageForPath, languageLabel } from '../../lib/highlight';
import type { Token } from '../../lib/highlight';
import { resolveLinkTarget } from '../../lib/linkTarget';
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
  ListIcon,
  PencilIcon,
  SpinnerIcon,
  UndoIcon,
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
  /** Shows an «编辑» action in the header; omitted for read-only files. */
  readonly onEdit?: () => void;
  /** Shows a «撤销修改» action when the file has a saved edit. */
  readonly onRevertEdit?: () => void;
  /** `true` when the file has a saved edit that is not exported yet. */
  readonly dirty?: boolean;
  /**
   * Pre-rendered Markdown, shared with the editor so the parse only happens
   * once. Omitted for non-Markdown files.
   */
  readonly rendered?: RenderedMarkdown | null;
  /** Headings of the rendered Markdown, used by the table of contents. */
  readonly headings?: readonly MarkdownHeading[];
  /**
   * Links found while rendering; used to map a clicked `href` back to its raw
   * Markdown target. Defaults to `rendered.links`.
   */
  readonly links?: readonly MarkdownLink[];
  /**
   * Opens another file of the package when the user activates a relative link.
   * Return `false` when the target does not exist, so the preview can say so
   * instead of leaving the click silently dead.
   */
  readonly onNavigate?: (target: { path: string; fragment: string | null }) => boolean;
  /**
   * Language of the file itself, used to highlight the source view. Defaults to
   * a guess from the file name, so a `.ts` or `.sh` preview is coloured without
   * the host doing anything.
   */
  readonly language?: string | null;
  /** Replaces the built-in body entirely. */
  readonly renderBody?: (props: FilePreviewProps) => React.ReactNode;
  /**
   * Replaces the body once the payload is ready, keeping the loading/error
   * states. This is how matched custom previewers render.
   */
  readonly readyBody?: React.ReactNode;
}

/** How long a table-of-contents jump stays highlighted. */
const FLASH_MS = 900;
/** Grace period before jumping to a heading in a freshly opened file. */
const LINK_JUMP_DELAY_MS = 160;

/** Render highlighted code: plain runs stay text, everything else gets a span. */
function renderTokens(tokens: readonly Token[], keyPrefix: string): React.ReactNode[] {
  return tokens.map((token, index) =>
    token.type === 'plain' ? (
      <Fragment key={`${keyPrefix}-${index}`}>{token.value}</Fragment>
    ) : (
      <span key={`${keyPrefix}-${index}`} className={`se-code__${token.type}`}>
        {token.value}
      </span>
    ),
  );
}

/** Save bytes to disk, using the File System Access API when available. */
async function saveBlob(blob: Blob, fileName: string): Promise<void> {
  const picker = (
    globalThis as typeof globalThis & {
      showSaveFilePicker?: (options: unknown) => Promise<{
        createWritable: () => Promise<{
          write: (data: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
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
    onEdit,
    onRevertEdit,
    dirty = false,
    rendered,
    links: linksProp,
    headings: headingsProp,
    onNavigate,
    language,
    renderBody,
    readyBody,
  } = props;

  const fileName = name ?? path.slice(path.lastIndexOf('/') + 1);
  const defaultView: PreviewView = kind === 'markdown' ? 'rendered' : 'source';
  const activeView = view ?? defaultView;
  const [copied, setCopied] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const copyTimer = useRef<number | undefined>(undefined);
  const flashTimer = useRef<number | undefined>(undefined);
  const noticeTimer = useRef<number | undefined>(undefined);
  const scrollElementRef = useRef<HTMLDivElement | null>(null);

  // A new file means the previous copy confirmation is stale.
  useEffect(() => {
    setCopied(false);
    setImageFailed(false);
    setTocOpen(false);
    setLinkNotice(null);
  }, [path, objectUrl]);

  useEffect(
    () => () => {
      window.clearTimeout(copyTimer.current);
      window.clearTimeout(flashTimer.current);
      window.clearTimeout(noticeTimer.current);
    },
    [],
  );

  /**
   * The scroll container is recreated when the view switches between rendered
   * Markdown and source, so reset its position as it mounts: a new file (and a
   * new view of it) should start at the top.
   */
  const setScrollElement = useCallback((element: HTMLDivElement | null) => {
    scrollElementRef.current = element;
    if (element) element.scrollTop = 0;
  }, []);

  const markdown = useMemo(() => {
    if (rendered !== undefined) return rendered;
    return kind === 'markdown' && status === 'ready' && typeof text === 'string'
      ? renderMarkdown(text)
      : null;
  }, [rendered, kind, status, text]);

  const headings = headingsProp ?? markdown?.headings ?? [];

  const links = useMemo<readonly MarkdownLink[]>(
    () => linksProp ?? markdown?.links ?? [],
    [linksProp, markdown],
  );

  /**
   * Scroll a heading into view inside the preview pane. Long documents need the
   * target to be reachable without hunting, and a brief highlight makes it
   * obvious which section was jumped to.
   *
   * The flash is applied to the DOM directly: the rendered Markdown is produced
   * by the parent (shared with the editor), so there is nothing to re-render
   * here — and re-parsing the document just to move a highlight would be worse.
   */
  const scrollToHeading = useCallback((id: string) => {
    const container = scrollElementRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
    if (!target) return;

    const offset = target.offsetTop - container.offsetTop - 8;
    container.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });

    target.classList.add('is-active');
    setActiveHeadingId(id);
    if (flashTimer.current !== undefined) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => {
      target.classList.remove('is-active');
      setActiveHeadingId((current) => (current === id ? null : current));
    }, FLASH_MS);
  }, []);

  /** Tell the user why a link did not open anything, without leaving the pane. */
  const notifyLinkProblem = useCallback((message: string) => {
    setLinkNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setLinkNotice(null), 4000);
  }, []);

  /**
   * Markdown links point inside the package, so a click has to be intercepted:
   * the browser would otherwise navigate away from the editor, and the document
   * hash would be polluted by hashes that only mean something inside the pane.
   */
  const handleLinkClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const element = (event.target as HTMLElement | null)?.closest('a');
    if (!element) return;
    const target =
      element.getAttribute('data-md-link') ??
      links.find((link) => link.href !== null && link.href === element.getAttribute('href'))?.target;
    if (target === undefined || target === null) return;
    // External and unsafe links keep their default behaviour.
    if (isExternalHref(target)) return;

    event.preventDefault();
    const resolved = resolveLinkTarget(target, path);

    if (resolved.kind === 'anchor') {
      if (resolved.fragment) scrollToHeading(resolved.fragment);
      return;
    }

    if (resolved.kind === 'internal') {
      const opened = onNavigate?.({ path: resolved.path, fragment: resolved.fragment }) ?? false;
      if (opened) {
        if (resolved.fragment) {
          // The target file renders asynchronously; jump once it is there.
          const fragment = resolved.fragment;
          window.setTimeout(() => scrollToHeading(fragment), LINK_JUMP_DELAY_MS);
        }
        return;
      }
      notifyLinkProblem(`压缩包内没有「${resolved.path}」`);
      return;
    }

    if (resolved.kind === 'out-of-scope') {
      notifyLinkProblem(`无法预览该链接：${target}`);
    }
  };

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

  /**
   * Syntax for the source view: the host wins, then the file name decides.
   * A `.ts` or `.sh` file gets the same palette its fenced block would get.
   */
  const sourceLanguage = language !== undefined ? language : languageForPath(path);
  const sourceTokens = useMemo(() => highlight(sourceText, sourceLanguage), [sourceText, sourceLanguage]);
  const hasHighlight = sourceTokens.language !== null && sourceTokens.language !== 'text';

  return (
    <div className={['se-preview', className].filter(Boolean).join(' ')}>
      <header className="se-preview__header">
        <FilesIcon className="se-icon se-icon--file" />
        <div className="se-preview__titles">
          <span className="se-preview__name" title={path}>
            {fileName}
            {dirty && (
              <span className="se-preview__badge" title="有未导出的修改">
                已修改
              </span>
            )}
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

          {kind === 'markdown' && status === 'ready' && activeView === 'rendered' && headings.length > 0 && (
            <div className="se-toc">
              <button
                type="button"
                className={`se-icon-button${tocOpen ? ' is-active' : ''}`}
                onClick={() => setTocOpen((open) => !open)}
                aria-expanded={tocOpen}
                aria-haspopup="true"
                title="目录"
                aria-label="目录"
              >
                <ListIcon className="se-icon" />
              </button>
              {tocOpen && (
                <>
                  {/* Click-away layer keeps the popover from lingering. */}
                  <div className="se-toc__backdrop" onClick={() => setTocOpen(false)} />
                  <nav className="se-toc__panel" aria-label="文档目录">
                    <span className="se-toc__title">目录</span>
                    <ul className="se-toc__list">
                      {headings.map((heading) => (
                        <li key={heading.id}>
                          <button
                            type="button"
                            className={`se-toc__item se-toc__item--h${heading.level}`}
                            onClick={() => {
                              scrollToHeading(heading.id);
                              setTocOpen(false);
                            }}
                          >
                            {heading.text}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </nav>
                </>
              )}
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
          {onRevertEdit && (
            <button
              type="button"
              className="se-icon-button"
              onClick={onRevertEdit}
              title="撤销对该文件的修改"
              aria-label="撤销对该文件的修改"
            >
              <UndoIcon className="se-icon" />
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              className="se-button se-button--primary se-button--small"
              onClick={onEdit}
              title="编辑该文件"
            >
              <PencilIcon className="se-icon" />
              <span>编辑</span>
            </button>
          )}
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

      {linkNotice && (
        <div className="se-preview__link-notice" role="status">
          <AlertIcon className="se-icon" />
          <span>{linkNotice}</span>
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

          {status === 'ready' && readyBody && <div className="se-preview__custom">{readyBody}</div>}

          {status === 'ready' &&
            !readyBody &&
            kind === 'image' &&
            objectUrl !== undefined &&
            !imageFailed && (
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
            !readyBody &&
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

          {status === 'ready' && !readyBody && kind !== 'image' && kind !== 'binary' && (
            // Keying by view guarantees a fresh scroll container per view, so
            // switching between rendered Markdown and source starts at the top.
            <div
              className="se-preview__scroll"
              key={activeView}
              ref={setScrollElement}
              onClick={handleLinkClick}
            >
              {kind === 'markdown' && activeView === 'rendered' && markdown ? (
                <article
                  className={`se-md${activeHeadingId ? ' has-heading-target' : ''}`}
                  data-active-heading={activeHeadingId ?? undefined}
                >
                  {markdown.nodes}
                </article>
              ) : (
                <pre
                  className="se-preview__source"
                  data-language={
                    hasHighlight ? (languageLabel(sourceTokens.language) ?? undefined) : undefined
                  }
                  tabIndex={0}
                >
                  <code>{hasHighlight ? renderTokens(sourceTokens.tokens, 'src') : sourceText}</code>
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

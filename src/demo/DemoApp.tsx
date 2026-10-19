import { useCallback, useEffect, useRef, useState } from 'react';
import { SkillEditor } from '../index';
import type { EditSummary, SkillEditorHandle } from '../components/SkillEditor';
import type { SkillArchiveResult } from '../lib/loadSkillArchive';
import type { SkillTreeNode } from '../lib/skillTree';
import { formatBytes } from '../lib/format';
import { fontPreviewer } from './FontPreview';
import { ArchiveIcon } from './icons';
import sampleZipUrl from './sample/api-call-by-knowledge.zip?url';
import './styles.css';

/** Reject obviously wrong files before handing them to the editor. */
function isZipLike(file: File): boolean {
  return /\.zip$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
}

/** Save a blob through the File System Access API, falling back to a download. */
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
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
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
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Demo harness. It owns the `.zip` file and the toolbar that used to live inside
 * the editor: the component now just receives a file through `source`.
 */
export function DemoApp() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<SkillArchiveResult | null>(null);
  const [selected, setSelected] = useState<SkillTreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<EditSummary>({
    dirty: false,
    count: 0,
    paths: [],
    draftOpen: false,
  });
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const editorRef = useRef<SkillEditorHandle>(null);
  const inputId = 'demo-zip-input';
  // React StrictMode mounts effects twice; only run the sample fetch once.
  const requestedSample = useRef(false);

  /** Export the (possibly edited) package and hand the blob to the browser. */
  const exportArchive = async (): Promise<void> => {
    setExporting(true);
    setExportNotice(null);
    try {
      const exported = await editorRef.current?.exportArchive();
      if (!exported) return;
      await saveBlob(exported.blob, exported.fileName);
      setExportNotice(
        `已导出 ${exported.fileName}：${exported.stats.files} 个文件，其中 ${exported.stats.modified} 个已修改。`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '导出失败。');
    } finally {
      setExporting(false);
    }
  };

  const loadSample = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(sampleZipUrl);
      if (!response.ok) throw new Error(`示例文件请求失败（HTTP ${response.status}）。`);
      const blob = await response.blob();
      setFile(new File([blob], 'api-call-by-knowledge.zip', { type: 'application/zip' }));
      setResult(null);
      setSelected(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '示例文件加载失败。');
    }
  }, []);

  useEffect(() => {
    if (requestedSample.current) return;
    requestedSample.current = true;
    void loadSample();
  }, [loadSample]);

  const pickFile = (picked: File | undefined | null): void => {
    if (!picked) return;
    if (!isZipLike(picked)) {
      setError(`仅支持 .zip 文件，当前为“${picked.name}”。`);
      return;
    }
    setError(null);
    setResult(null);
    setSelected(null);
    setFile(picked);
  };

  const clear = (): void => {
    setFile(null);
    setResult(null);
    setSelected(null);
    setError(null);
  };

  return (
    <div className="demo">
      <div className="demo__toolbar">
        <div className="demo__toolbar-identity">
          <ArchiveIcon className="demo__icon" />
          <div className="demo__toolbar-titles">
            <span className="demo__toolbar-title">{file?.name ?? 'SkillEditor'}</span>
            <span className="demo__toolbar-subtitle">
              {result
                ? `${result.tree.folderCount} 个目录 · ${result.tree.fileCount} 个文件 · ${formatBytes(result.tree.totalSize)}`
                : '未载入技能包'}
            </span>
          </div>
        </div>
        <div className="demo__toolbar-actions">
          <label className="demo__button" htmlFor={inputId}>
            选择 .zip
          </label>
          <input
            id={inputId}
            className="demo__visually-hidden"
            type="file"
            accept=".zip,application/zip"
            onChange={(event) => {
              pickFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className={`demo__button${edits.dirty ? '' : ' demo__button--ghost'}`}
            data-testid="demo-export"
            disabled={!file || exporting}
            title={edits.dirty ? `导出包含 ${edits.count} 个已修改文件的新压缩包` : '导出当前压缩包'}
            onClick={() => void exportArchive()}
          >
            {exporting ? '正在打包…' : '导出'}
          </button>
          {file && (
            <button type="button" className="demo__button demo__button--ghost" onClick={clear}>
              清除
            </button>
          )}
        </div>
      </div>

      <main className="demo__stage">
        <SkillEditor
          ref={editorRef}
          source={file}
          editable
          readOnly
          previewers={[fontPreviewer]}
          onLoad={(loaded) => {
            setResult(loaded);
            setError(null);
          }}
          onError={(failure) => setError(failure.message)}
          onSelectChange={setSelected}
          onEditChange={(summary) => {
            setEdits(summary);
            setExportNotice(null);
          }}
        />
      </main>

      {(selected || error || exportNotice || edits.count > 0) && (
        <footer className="demo__status">
          <span className="demo__status-path">{selected?.path ?? ''}</span>
          <span className="demo__status-right">
            {error ? (
              <span className="demo__status-error">{error}</span>
            ) : exportNotice ? (
              <span>{exportNotice}</span>
            ) : edits.count > 0 ? (
              <span>{edits.count} 个文件未导出</span>
            ) : null}
          </span>
        </footer>
      )}
    </div>
  );
}

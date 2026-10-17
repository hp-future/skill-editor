import { useCallback, useEffect, useRef, useState } from 'react';
import { SkillEditor, writeZipArchive } from '../index';
import type { EditSummary, SkillEditorHandle } from '../components/SkillEditor';
import type { SkillArchiveResult } from '../lib/loadSkillArchive';
import type { SkillTreeNode } from '../lib/skillTree';
import { formatBytes } from '../lib/format';
import { fontPreviewer } from './FontPreview';
import { ArchiveIcon, CloseIcon, DownloadIcon, UploadIcon } from './icons';
import sampleZipUrl from './sample/api-call-by-knowledge.zip?url';
import fontUrl from './fixtures/SkillDemo.ttf?url';
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
  const [loading, setLoading] = useState(false);
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
    setLoading(true);
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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (requestedSample.current) return;
    requestedSample.current = true;
    void loadSample();
  }, [loadSample]);

  /**
   * Build a package in the browser that contains a `.ttf`, so the demo can show
   * the host-registered font previewer. The zip is produced with the library's
   * own writer — no server round-trip.
   */
  const loadFontSample = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(fontUrl);
      if (!response.ok) throw new Error(`字体文件请求失败（HTTP ${response.status}）。`);
      const fontBytes = new Uint8Array(await response.arrayBuffer());
      const encoder = new TextEncoder();
      const manifest = [
        '---',
        'name: font-demo',
        'description: "自定义文件预览组件演示：字体文件"',
        '---',
        '',
        '# 字体预览演示',
        '',
        '本包中的 `fonts/SkillDemo.ttf` 由**宿主注册的自定义预览器**渲染，',
        '而不是内置的「二进制内容暂不支持预览」提示。',
        '',
        '```tsx',
        "previewers={[{ match: byExtension('ttf', 'otf'), render: FontPreview }]}",
        '```',
        '',
        'SkillEditor 只负责读出字节、生成 Blob URL，并把控制权交给预览组件；',
        '字体、PDF、Excel 等格式都可以用同样的方式接入。',
      ].join('\n');
      const zip = await writeZipArchive([
        { path: 'font-demo/SKILL.md', data: encoder.encode(manifest) },
        { path: 'font-demo/fonts/SkillDemo.ttf', data: fontBytes },
      ]);
      setFile(new File([zip.slice() as BlobPart], 'font-demo.zip', { type: 'application/zip' }));
      setResult(null);
      setSelected(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '字体示例加载失败。');
    } finally {
      setLoading(false);
    }
  }, []);

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
      <header className="demo__header">
        <div>
          <h1>SkillEditor 组件演示</h1>
          <p>
            工具栏由宿主提供：文件从外部传入，组件负责目录树、文件预览与编辑；导出由宿主持有 Blob 后自行下载。
          </p>
        </div>
      </header>

      <div className="demo__toolbar">
        <div className="demo__toolbar-identity">
          <ArchiveIcon className="demo__icon demo__icon--brand" />
          <div className="demo__toolbar-titles">
            <span className="demo__toolbar-title">{file?.name ?? 'Skill Editor'}</span>
            <span className="demo__toolbar-subtitle">
              {result
                ? `${result.tree.rootName} · ${result.tree.folderCount} 个目录 / ${result.tree.fileCount} 个文件 · ${formatBytes(result.tree.totalSize)}${edits.count > 0 ? ` · 已修改 ${edits.count} 个文件` : ''}`
                : '上传 .zip 技能包以查看目录结构'}
            </span>
          </div>
        </div>
        <div className="demo__toolbar-actions">
          <label className="demo__button" htmlFor={inputId}>
            <UploadIcon className="demo__icon" />
            <span>选择 .zip 文件</span>
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
          <button type="button" className="demo__button demo__button--ghost" onClick={() => void loadSample()} disabled={loading}>
            {loading ? '加载示例…' : '载入示例包'}
          </button>
          <button
            type="button"
            className="demo__button demo__button--ghost"
            data-testid="demo-font-sample"
            onClick={() => void loadFontSample()}
            disabled={loading}
            title="演示宿主自定义的文件预览组件：.ttf 字体"
          >
            载入字体示例
          </button>
          <button
            type="button"
            className={`demo__button${edits.dirty ? '' : ' demo__button--ghost'}`}
            data-testid="demo-export"
            disabled={!file || exporting}
            title={edits.dirty ? `导出包含 ${edits.count} 个已修改文件的新压缩包` : '导出当前压缩包'}
            onClick={() => void exportArchive()}
          >
            <DownloadIcon className="demo__icon" />
            <span>{exporting ? '正在打包…' : '导出 .zip'}</span>
          </button>
          {file && (
            <button type="button" className="demo__button demo__button--ghost" onClick={clear}>
              <CloseIcon className="demo__icon" />
              <span>清除</span>
            </button>
          )}
        </div>
      </div>

      <main className="demo__stage">
        <SkillEditor
          ref={editorRef}
          source={file}
          editable
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

      <footer className="demo__meta">
        <div className="demo__meta-item">
          <span className="demo__meta-label">文件</span>
          <span className="demo__meta-value">{file?.name ?? '—'}</span>
        </div>
        <div className="demo__meta-item">
          <span className="demo__meta-label">文件数</span>
          <span className="demo__meta-value">{result?.tree.fileCount ?? '—'}</span>
        </div>
        <div className="demo__meta-item">
          <span className="demo__meta-label">目录数</span>
          <span className="demo__meta-value">{result?.tree.folderCount ?? '—'}</span>
        </div>
        <div className="demo__meta-item demo__meta-item--wide">
          <span className="demo__meta-label">SKILL.md</span>
          <span className="demo__meta-value">
            {result ? (result.hasManifest ? result.manifest?.path : '未找到') : '—'}
          </span>
        </div>
        <div className="demo__meta-item demo__meta-item--wide">
          <span className="demo__meta-label">选中节点</span>
          <span className="demo__meta-value">{selected?.path ?? '—'}</span>
        </div>
        <div className="demo__meta-item demo__meta-item--wide">
          <span className="demo__meta-label">未导出的修改</span>
          <span className="demo__meta-value">
            {edits.count === 0 ? '无' : `${edits.count} 个：${edits.paths.join('、')}`}
          </span>
        </div>
        {exportNotice && (
          <div className="demo__meta-item demo__meta-item--wide">
            <span className="demo__meta-label">导出</span>
            <span className="demo__meta-value">{exportNotice}</span>
          </div>
        )}
        {error && (
          <div className="demo__meta-item demo__meta-item--error">
            <span className="demo__meta-label">错误</span>
            <span className="demo__meta-value">{error}</span>
          </div>
        )}
      </footer>
    </div>
  );
}

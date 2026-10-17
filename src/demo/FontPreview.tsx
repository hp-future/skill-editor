import { useEffect, useMemo, useState } from 'react';
import { byExtension, type CustomPreviewProps, type FilePreviewer } from '../components/SkillEditor';
import { formatBytes } from '../lib/format';
import './fontPreview.css';

/** Sizes shown in the specimen, in pixels. */
const SIZES = [12, 16, 24, 40] as const;
/** Text that the demo font actually has glyphs for (5x7 block letterforms). */
const SAMPLE = 'A B E S 0 1';
const FALLBACK_SAMPLE = 'Skill Editor 字体预览';

/**
 * Preview for font files, driven entirely by the host.
 *
 * The editor reads the bytes and hands over a Blob URL; this component only
 * loads it with the CSS Font Loading API and draws a specimen. Nothing about
 * fonts exists inside `SkillEditor` — swap this component for a PDF viewer or a
 * JSON tree and the editor does not change.
 */
export function FontPreview({ info, objectUrl }: CustomPreviewProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  /** A per-file family name so two open fonts never collide. */
  const family = useMemo(
    () => `se-demo-font-${info.path.replace(/[^a-z0-9]+/gi, '-')}`,
    [info.path],
  );

  useEffect(() => {
    if (typeof FontFace === 'undefined') {
      setStatus('error');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    const face = new FontFace(family, `url(${objectUrl})`);
    face
      .load()
      .then((loaded) => {
        if (cancelled) return;
        document.fonts.add(loaded);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
      // Removing the face keeps a stale family from matching a later file.
      try {
        document.fonts.delete(face);
      } catch {
        // Ignore: some engines throw when deleting a face that never loaded.
      }
    };
  }, [family, objectUrl]);

  return (
    <div className="demo-font" data-testid="demo-font-preview">
      <header className="demo-font__head">
        <span className="demo-font__badge">自定义预览 · 字体</span>
        <span className="demo-font__meta">
          {info.name} · {formatBytes(info.size)} · .{info.extension}
        </span>
      </header>

      {status === 'loading' && <p className="demo-font__hint">正在加载字体…</p>}
      {status === 'error' && (
        <p className="demo-font__hint demo-font__hint--error">
          字体无法加载：文件可能已损坏，或当前浏览器不支持 FontFace。
        </p>
      )}

      {status === 'ready' && (
        <div className="demo-font__specimen" style={{ fontFamily: `"${family}", system-ui, sans-serif` }}>
          {SIZES.map((size) => (
            <div key={size} className="demo-font__row">
              <span className="demo-font__size">{size}px</span>
              <span className="demo-font__sample" style={{ fontSize: size }}>
                {SAMPLE}
                <span className="demo-font__fallback">{FALLBACK_SAMPLE}</span>
              </span>
            </div>
          ))}
          <p className="demo-font__note">
            该演示字体只包含 A B E S 0 1 等字形，其余字符由系统字体回退显示。
          </p>
        </div>
      )}
    </div>
  );
}

/** Registration entry the demo hands to `SkillEditor`. */
export const fontPreviewer: FilePreviewer = {
  id: 'demo-font',
  match: byExtension('ttf', 'otf', 'woff', 'woff2'),
  render: (props) => <FontPreview {...props} />,
};

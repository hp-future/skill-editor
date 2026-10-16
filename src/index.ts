export { SkillEditor } from './components/SkillEditor';
export type {
  SkillEditorHandle,
  SkillEditorProps,
  SkillEditorStatus,
} from './components/SkillEditor';
export { FileTree } from './components/SkillEditor';
export type { FileTreeProps, FileTreeRowContext } from './components/SkillEditor';
export { FilePreview, useFilePreview, describePreviewState } from './components/SkillEditor';
export type {
  FilePreviewProps,
  PreviewMode,
  PreviewState,
  PreviewView,
  UseFilePreviewOptions,
} from './components/SkillEditor';

export { loadSkillArchive, detectWrapperFolder } from './lib/loadSkillArchive';
export type { SkillArchiveResult } from './lib/loadSkillArchive';
export { buildSkillTree, flattenTree, defaultExpandedPaths, ancestorPaths } from './lib/skillTree';
export type {
  SkillFileNode,
  SkillFolderNode,
  SkillTreeNode,
  SkillTree,
  FlatNode,
} from './lib/skillTree';
export {
  findSkillManifest,
  readSkillManifest,
  summarizeManifest,
} from './lib/skillManifest';
export type { SkillManifestSummary } from './lib/skillManifest';
export { parseFrontmatter } from './lib/frontmatter';
export type { ParsedFrontmatter } from './lib/frontmatter';
export { renderMarkdown } from './lib/markdown.tsx';
export type { MarkdownHeading, MarkdownOptions, RenderedMarkdown } from './lib/markdown.tsx';
export {
  detectFileKind,
  extensionOf,
  mimeForPath,
  looksLikeText,
  TEXT_PREVIEW_LIMIT,
  IMAGE_PREVIEW_LIMIT,
} from './lib/fileKind';
export type { FileKind } from './lib/fileKind';
export {
  parseZipArchive,
  parseZipArchiveFromBlob,
  looksLikeZip,
  CompressionMethod,
  ZipFormatError,
} from './lib/zip/zipArchive';
export type { ZipArchive, ZipEntry } from './lib/zip/zipArchive';
export { formatBytes } from './lib/format';

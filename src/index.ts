export { SkillEditor } from './components/SkillEditor';
export type {
  EditSummary,
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
export { FileEditor, useFileEditor, useConfirm } from './components/SkillEditor';
export type {
  ConfirmAction,
  ConfirmController,
  ConfirmOptions,
  ConfirmResult,
  FileEditorProps,
  FileEditorState,
  UseFileEditorOptions,
} from './components/SkillEditor';

export { SkillDocument } from './lib/document/skillDocument';
export type {
  CreateSkillDocumentOptions,
  ExportOptions,
  ExportResult,
  ExportStats,
  FileEdit,
} from './lib/document/skillDocument';
export {
  writeZipArchive,
  writeZipBlob,
  ZIP_METHOD,
  ZipWriteError,
} from './lib/zip/zipWriter';
export type { ZipWriteEntry, ZipWriteOptions, ZipMethod } from './lib/zip/zipWriter';
export { crc32, Crc32 } from './lib/zip/crc32';

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
export { renderMarkdown, isExternalHref } from './lib/markdown.tsx';
export type {
  MarkdownHeading,
  MarkdownLink,
  MarkdownOptions,
  RenderedMarkdown,
} from './lib/markdown.tsx';
export {
  highlight,
  resolveLanguage,
  supportedLanguages,
  languageForPath,
  languageLabel,
} from './lib/highlight';
export type { HighlightResult, Token, TokenType } from './lib/highlight';
export { resolveLinkTarget, normalizeArchivePath } from './lib/linkTarget';
export type { LinkTarget, LinkTargetKind } from './lib/linkTarget';
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

import { parseZipArchiveFromBlob } from './zip/zipArchive';
import type { LocatedZipEntry, ZipArchive } from './zip/zipArchive';
import { buildSkillTree } from './skillTree';
import type { SkillFileNode, SkillTree } from './skillTree';
import { readSkillManifest } from './skillManifest';
import type { SkillManifestSummary } from './skillManifest';

/** Everything derived from one `.zip` file. */
export interface SkillArchiveResult {
  /** The source file the result was built from. */
  readonly file: File;
  /** Raw archive handle, used to read individual files. */
  readonly archive: ZipArchive;
  /** Directory tree of the archive. */
  readonly tree: SkillTree;
  /** Summary of `SKILL.md`, when the archive contains one. */
  readonly manifest: SkillManifestSummary | undefined;
  /** `true` when loading finished without skipping the manifest. */
  readonly hasManifest: boolean;
  /** Uncompressed bytes of one tree node, resolved through the archive. */
  readonly readFile: (node: SkillFileNode) => Promise<Uint8Array>;
}

/** Strip the `.zip` suffix so a wrapper folder can fall back to the file name. */
function baseNameOf(file: File): string {
  return file.name.replace(/\.zip$/i, '') || file.name;
}

/**
 * Guess a display name for archives whose entries all live under one top-level
 * folder (e.g. `api-call-by-knowledge/SKILL.md`): that folder is then shown as
 * the root instead of a single wrapper node.
 *
 * The folder is only collapsed when it is the *only* top-level entry, so an
 * archive that also has loose files keeps its real structure.
 */
export function detectWrapperFolder(tree: SkillTree): string | undefined {
  if (tree.children.length !== 1) return undefined;
  const [only] = tree.children;
  return only.kind === 'folder' ? only.name : undefined;
}

/** Re-root archive entries under a wrapper folder so paths match the tree. */
function remapThroughWrapper(
  entries: readonly LocatedZipEntry[],
  wrapper: string,
): LocatedZipEntry[] {
  const prefix = `${wrapper}/`;
  return entries
    .filter((entry) => entry.path.startsWith(prefix))
    .map((entry) => ({ ...entry, path: entry.path.slice(prefix.length), zipEntry: entry }));
}

/**
 * Parse a `.zip` file into a skill tree. Throws `ZipFormatError` (or a plain
 * `Error`) when the bytes are not a readable archive.
 */
export async function loadSkillArchive(file: File): Promise<SkillArchiveResult> {
  const archive = await parseZipArchiveFromBlob(file);
  const rawTree = buildSkillTree(archive.entries, { rootName: baseNameOf(file) });
  const wrapper = detectWrapperFolder(rawTree);
  const entries: readonly LocatedZipEntry[] = wrapper
    ? remapThroughWrapper(archive.entries, wrapper)
    : archive.entries;

  const tree = wrapper ? buildSkillTree(entries, { rootName: wrapper }) : rawTree;

  const manifest = await readSkillManifest(
    entries,
    (entry) => archive.readText(entry.zipEntry ?? entry),
    // Entries already carry tree-relative paths (see `remapThroughWrapper`).
    { pathOf: (entry) => entry.path },
  );

  return {
    file,
    archive,
    tree,
    manifest,
    hasManifest: manifest !== undefined,
    async readFile(node) {
      const entry = node.zipEntry;
      if (!entry) {
        throw new Error(`文件 "${node.path}" 未关联压缩包条目。`);
      }
      return archive.readEntry(entry);
    },
  };
}

import type { ZipEntry } from './zip/zipArchive';

/**
 * An archive entry, optionally carrying the entry it should read its payload
 * from. Callers that remap paths (wrapper collapsing) set `zipEntry` to the
 * original record so `SkillFileNode.zipEntry` still points at the archive.
 */
type TreeEntry = ZipEntry & { readonly zipEntry?: ZipEntry };

/** A file inside the archive. */
export interface SkillFileNode {
  readonly kind: 'file';
  /** Path of the node inside the tree, using `/` separators. */
  readonly path: string;
  /** Final path segment. */
  readonly name: string;
  /** Lower-case path, handy for filtering. */
  readonly pathLower: string;
  /** Uncompressed size in bytes. `-1` when the writer streamed the entry. */
  readonly size: number;
  /** Compression method of the underlying entry. */
  readonly compression: number;
  /** Modification time, when the archive records one. */
  readonly modifiedAt: Date | null;
  /**
   * The archive record this node came from. Its `path` is the path *inside the
   * archive*, which differs from `path` when a wrapper folder was collapsed —
   * always read payloads through this entry.
   */
  readonly zipEntry?: ZipEntry;
}

/** A folder inside the archive, including folders implied by nested paths. */
export interface SkillFolderNode {
  readonly kind: 'folder';
  readonly path: string;
  readonly name: string;
  readonly pathLower: string;
  /** `true` when the archive contains an explicit directory record. */
  readonly explicit: boolean;
  readonly children: readonly SkillTreeNode[];
}

export type SkillTreeNode = SkillFileNode | SkillFolderNode;

/** The archive laid out as a tree, ready to render. */
export interface SkillTree {
  /** Synthetic node for the archive itself. */
  readonly rootName: string;
  readonly children: readonly SkillTreeNode[];
  /** Lookup by absolute path. */
  readonly byPath: ReadonlyMap<string, SkillTreeNode>;
  /** Every node, root children first, depth-first. */
  readonly all: readonly SkillTreeNode[];
  readonly fileCount: number;
  readonly folderCount: number;
  readonly totalSize: number;
}

interface MutableFolder {
  path: string;
  name: string;
  pathLower: string;
  explicit: boolean;
  folders: Map<string, MutableFolder>;
  files: Map<string, SkillFileNode>;
}

function createFolder(path: string, name: string, explicit: boolean): MutableFolder {
  return {
    path,
    name,
    pathLower: path.toLowerCase(),
    explicit,
    folders: new Map(),
    files: new Map(),
  };
}

function splitSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0 && segment !== '.');
}

/** Case-insensitive natural-ish ordering: folders first, then names. */
function compareNodes(a: { kind: string; name: string }, b: { kind: string; name: string }): number {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
  const byName = a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  return byName !== 0 ? byName : a.name.localeCompare(b.name);
}

/**
 * Turn archive entries into a render-ready tree.
 *
 * Folder nodes are synthesised when an archive only stores full file paths
 * (the common case), and deduplicated against explicit directory records.
 */
export function buildSkillTree(
  entries: readonly TreeEntry[],
  options: { rootName?: string } = {},
): SkillTree {
  const root = createFolder('', options.rootName ?? 'archive', true);

  const ensureFolder = (segments: readonly string[], explicit: boolean): MutableFolder => {
    let current = root;
    let path = '';
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      let next = current.folders.get(segment);
      if (!next) {
        next = createFolder(path, segment, explicit);
        current.folders.set(segment, next);
      } else if (explicit) {
        next.explicit = true;
      }
      current = next;
    }
    return current;
  };

  for (const entry of entries) {
    const segments = splitSegments(entry.path);
    if (segments.length === 0) continue;

    if (entry.isDirectory) {
      ensureFolder(segments, true);
      continue;
    }

    const parent = ensureFolder(segments.slice(0, -1), false);
    const name = segments[segments.length - 1];
    const existing = parent.files.get(name);
    // Last record wins, matching how unzip tools treat duplicates.
    if (existing) parent.files.delete(name);
    parent.files.set(name, {
      // An explicit `zipEntry` on the raw entry lets callers rewrite `path`
      // (wrapper collapsing) while keeping the link back to the archive.
      zipEntry: entry.zipEntry ?? entry,
      kind: 'file',
      path: entry.path,
      name,
      pathLower: entry.pathLower,
      size: entry.size,
      compression: entry.compression,
      modifiedAt: entry.dosDateTime,
    });
  }

  const byPath = new Map<string, SkillTreeNode>();
  const all: SkillTreeNode[] = [];
  let fileCount = 0;
  let folderCount = 0;
  let totalSize = 0;

  const finalize = (folder: MutableFolder): SkillTreeNode[] => {
    const folders: SkillFolderNode[] = [...folder.folders.values()].map((child) => ({
      kind: 'folder' as const,
      path: child.path,
      name: child.name,
      pathLower: child.pathLower,
      explicit: child.explicit,
      children: finalize(child),
    }));
    const nodes: SkillTreeNode[] = [...folders, ...folder.files.values()];
    nodes.sort(compareNodes);
    for (const node of nodes) {
      byPath.set(node.path, node);
      all.push(node);
      if (node.kind === 'folder') folderCount += 1;
      else {
        fileCount += 1;
        if (node.size > 0) totalSize += node.size;
      }
    }
    return nodes;
  };

  const children = finalize(root);

  return {
    rootName: root.name,
    children,
    byPath,
    all,
    fileCount,
    folderCount,
    totalSize,
  };
}

/** Paths of the first `depth` levels of folders, used to seed expansion state. */
export function defaultExpandedPaths(tree: SkillTree, depth = 1): string[] {
  const expanded: string[] = [];
  const walk = (nodes: readonly SkillTreeNode[], level: number): void => {
    if (level > depth) return;
    for (const node of nodes) {
      if (node.kind !== 'folder') continue;
      expanded.push(node.path);
      walk(node.children, level + 1);
    }
  };
  walk(tree.children, 1);
  return expanded;
}

export interface FlatNode {
  readonly node: SkillTreeNode;
  /** Nesting level; top-level nodes are `0`. */
  readonly depth: number;
  /** `true` when the node is a folder that is currently expanded. */
  readonly expanded: boolean;
}

/**
 * Flatten the tree into the ordered list of visible rows, skipping the children
 * of collapsed folders.
 */
export function flattenTree(
  tree: SkillTree,
  isExpanded: (path: string) => boolean,
): FlatNode[] {
  const rows: FlatNode[] = [];
  const walk = (nodes: readonly SkillTreeNode[], depth: number): void => {
    for (const node of nodes) {
      const expanded = node.kind === 'folder' && isExpanded(node.path);
      rows.push({ node, depth, expanded });
      if (expanded && node.kind === 'folder') walk(node.children, depth + 1);
    }
  };
  walk(tree.children, 0);
  return rows;
}

/** Every ancestor folder path of a node, outermost first. */
export function ancestorPaths(path: string): string[] {
  const segments = splitSegments(path);
  const result: string[] = [];
  let current = '';
  for (let i = 0; i < segments.length - 1; i += 1) {
    current = current ? `${current}/${segments[i]}` : segments[i];
    result.push(current);
  }
  return result;
}

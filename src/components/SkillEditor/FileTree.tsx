import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import type { FlatNode } from '../../lib/skillTree';

export interface FileTreeRowContext {
  readonly row: FlatNode;
  /** Nesting level, starting at 0. */
  readonly depth: number;
  readonly expanded: boolean;
  readonly selected: boolean;
  readonly focused: boolean;
}

export interface FileTreeProps {
  /** Visible rows, in render order (see `flattenTree`). */
  readonly rows: readonly FlatNode[];
  /** Path of the highlighted node, or `null`. */
  readonly selectedPath?: string | null;
  /** Renders one row's contents; the tree supplies the interactive shell. */
  readonly renderRow: (context: FileTreeRowContext) => ReactNode;
  readonly onToggle?: (node: FlatNode['node']) => void;
  readonly onSelect?: (node: FlatNode['node']) => void;
  /** Expanded state of a path, exposed for `aria-expanded`. */
  readonly isExpanded: (path: string) => boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Accessible label for the tree. */
  readonly 'aria-label'?: string;
  /** Value for a `data-testid` attribute on the tree container. */
  readonly testId?: string;
  /** Value for a `data-state` attribute, so hosts and tests can read readiness. */
  readonly dataState?: string;
  readonly emptyState?: ReactNode;
}

/**
 * Accessible, keyboard-driven tree of rows.
 *
 * Row content is provided by the caller; this component owns ordering,
 * roving focus, ARIA wiring and the keyboard contract (↑ ↓ ← → Home End).
 */
export function FileTree({
  rows,
  selectedPath = null,
  renderRow,
  onToggle,
  onSelect,
  className,
  style,
  emptyState,
  testId,
  dataState,
  'aria-label': ariaLabel,
}: FileTreeProps) {
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  // Keep roving focus on a row that still exists.
  useEffect(() => {
    if (focusedPath && !rows.some((row) => row.node.path === focusedPath)) {
      setFocusedPath(null);
    }
  }, [rows, focusedPath]);

  const focusRow = (path: string): void => {
    setFocusedPath(path);
    rowRefs.current.get(path)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number): void => {
    const row = rows[index];
    if (!row) return;
    const { node, expanded } = row;
    const isFolder = node.kind === 'folder';
    let handled = true;

    switch (event.key) {
      case 'ArrowDown':
        if (index + 1 < rows.length) focusRow(rows[index + 1].node.path);
        break;
      case 'ArrowUp':
        if (index > 0) focusRow(rows[index - 1].node.path);
        break;
      case 'ArrowRight':
        if (isFolder && !expanded) onToggle?.(node);
        else if (isFolder && index + 1 < rows.length) focusRow(rows[index + 1].node.path);
        break;
      case 'ArrowLeft':
        if (isFolder && expanded) onToggle?.(node);
        else {
          // Jump to the parent row.
          const parentPath = node.path.includes('/')
            ? node.path.slice(0, node.path.lastIndexOf('/'))
            : null;
          if (parentPath) focusRow(parentPath);
        }
        break;
      case 'Home':
        if (rows.length > 0) focusRow(rows[0].node.path);
        break;
      case 'End':
        if (rows.length > 0) focusRow(rows[rows.length - 1].node.path);
        break;
      case 'Enter':
      case ' ':
        onSelect?.(node);
        if (isFolder) onToggle?.(node);
        break;
      default:
        handled = false;
    }

    if (handled) event.preventDefault();
  };

  const tabbablePath = useMemo(() => {
    if (focusedPath && rows.some((row) => row.node.path === focusedPath)) return focusedPath;
    if (selectedPath && rows.some((row) => row.node.path === selectedPath)) return selectedPath;
    return rows[0]?.node.path ?? null;
  }, [focusedPath, selectedPath, rows]);

  if (rows.length === 0) {
    return (
      <div className={className} style={style} data-testid={testId} data-state={dataState}>
        {emptyState}
      </div>
    );
  }

  return (
    <div
      role="tree"
      aria-label={ariaLabel}
      className={className}
      style={style}
      data-testid={testId}
      data-state={dataState}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusedPath(null);
        }
      }}
    >
      {rows.map((row, index) => {
        const expanded = row.expanded;
        const selected = row.node.path === selectedPath;
        const focused = row.node.path === focusedPath;
        return (
          <div
            key={row.node.path}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-selected={selected}
            aria-expanded={row.node.kind === 'folder' ? expanded : undefined}
            data-path={row.node.path}
            data-kind={row.node.kind}
            tabIndex={row.node.path === tabbablePath ? 0 : -1}
            ref={(element) => {
              if (element) rowRefs.current.set(row.node.path, element);
              else rowRefs.current.delete(row.node.path);
            }}
            className="se-tree__row"
            onClick={() => {
              setFocusedPath(row.node.path);
              onSelect?.(row.node);
              if (row.node.kind === 'folder') onToggle?.(row.node);
            }}
            onFocus={() => setFocusedPath(row.node.path)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {renderRow({ row, depth: row.depth, expanded, selected, focused })}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Inline icon set. Kept as plain SVG so the component has no icon dependency
 * and inherits colour from the surrounding text via `currentColor`.
 */

interface IconProps {
  className?: string;
}

const baseProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function FolderIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17z" />
    </svg>
  );
}

export function FolderOpenIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M3 8a1.5 1.5 0 0 1 1.5-1.5h3.6l2 2.5h6.4A1.5 1.5 0 0 1 18 10.5v1" />
      <path d="M3 8v9a1.5 1.5 0 0 0 1.5 1.5h12.2a1.5 1.5 0 0 0 1.45-1.1l1.6-5.4A1 1 0 0 0 18.8 11H6.1a1.5 1.5 0 0 0-1.44 1.08z" />
    </svg>
  );
}

export function FileIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M13.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8z" />
      <path d="M13.5 3v5h5" />
    </svg>
  );
}

export function MarkdownIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M13.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8z" />
      <path d="M13.5 3v5h5" />
      <path d="M8.5 17v-4l1.75 2 1.75-2v4" />
      <path d="M15 13v4m0 0 1.5-1.5M15 17l-1.5-1.5" />
    </svg>
  );
}

export function ArchiveIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h14a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M10 5v3m4-3v3m-4 3v2m4-2v2m-4 3h4" />
    </svg>
  );
}

export function UploadIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M12 15V4m0 0L8 8m4-4 4 4" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function AlertIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v4.5M12 15.75v.25" />
    </svg>
  );
}

export function SpinnerIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M12 4a8 8 0 1 0 8 8" />
    </svg>
  );
}

export function CopyIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 6.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v8.5A1.5 1.5 0 0 0 5 15h1.5" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M12 4v11m0 0 4-4m-4 4-4-4" />
      <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
    </svg>
  );
}

export function ImageIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="10" r="1.6" />
      <path d="M4 17l4.6-4.6a1.5 1.5 0 0 1 2.1 0L15 16.5m0 0 1.6-1.6a1.5 1.5 0 0 1 2.1 0L20 16.4" />
    </svg>
  );
}

export function CodeIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M9 7.5 4.5 12 9 16.5M15 7.5 19.5 12 15 16.5" />
    </svg>
  );
}

export function EyeIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}

export function PencilIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

export function UndoIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M4 9h10.5a5 5 0 0 1 0 10H9" />
      <path d="M7.5 5.5 4 9l3.5 3.5" />
    </svg>
  );
}

export function ListIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M5 6.5h.01M5 12h.01M5 17.5h.01" />
      <path d="M9.5 6.5h9.5M9.5 12h9.5M9.5 17.5h9.5" />
    </svg>
  );
}

export function FileQuestionIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M13.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8z" />
      <path d="M13.5 3v5h5" />
      <path d="M9.9 12.6a2.1 2.1 0 0 1 4.1.6c0 1.4-2 1.8-2 3m0 2.3v.1" />
    </svg>
  );
}

export function FilesIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M9 3.5h6.5L19 7v9.5A1.5 1.5 0 0 1 17.5 18H9a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 9 3.5z" />
      <path d="M13.5 3.5V7H17" />
      <path d="M5 7v11a1.5 1.5 0 0 0 1.5 1.5H15" />
    </svg>
  );
}

/** Shown while every folder is open: pressing the control folds them back up. */
export function CollapseAllIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M5 6h14" />
      <path d="M5 16h14" />
      <path d="M9 11.5h6" />
    </svg>
  );
}

/** Shown while every folder is folded: pressing the control opens them all. */
export function ExpandAllIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M5 6h14" />
      <path d="M5 16h14" />
      <path d="M12 9.5v5m0 0-2.2-2.2M12 14.5l2.2-2.2" />
    </svg>
  );
}


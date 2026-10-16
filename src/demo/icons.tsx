/**
 * Demo-only icon set for the host-provided toolbar. The editor owns its own
 * icons; these live here to make it clear the toolbar is not part of it.
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

export function DownloadIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M12 4v11m0 0 4-4m-4 4-4-4" />
      <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
    </svg>
  );
}

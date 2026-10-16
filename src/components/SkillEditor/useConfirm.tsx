import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './ConfirmDialog.css';

/** How a confirmation ended. `'cancel'` also covers Esc and backdrop closes. */
export type ConfirmResult = 'confirm' | 'cancel' | 'discard';

export interface ConfirmAction {
  /** Value resolved when this action is chosen. */
  readonly value: ConfirmResult;
  readonly label: string;
  readonly variant?: 'primary' | 'danger' | 'ghost';
}

export interface ConfirmOptions {
  readonly title: string;
  readonly message: ReactNode;
  /** Detail lines rendered under the message, e.g. export warnings. */
  readonly details?: readonly string[];
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** Extra third action, e.g. "放弃修改" while switching files. */
  readonly discardLabel?: string;
  /** Which action should receive focus and react to Enter. */
  readonly primary?: ConfirmResult;
}

export interface ConfirmController {
  /**
   * Renders the dialog; mount it once inside the component. The controller owns
   * this field and refreshes it on every render.
   */
  dialog: ReactNode;
  /** Ask the user; resolves with the chosen action. */
  readonly confirm: (options: ConfirmOptions) => Promise<ConfirmResult>;
}

interface PendingState extends ConfirmOptions {
  readonly id: number;
}

/**
 * Promise-based confirmation dialog built on the native `<dialog>` element, so
 * focus trapping, Esc handling and the backdrop come from the platform.
 *
 * The returned controller keeps a stable identity: `confirm` never changes and
 * `dialog` is refreshed on every render, so it can sit in other hook dependency
 * lists without invalidating them.
 */
export function useConfirm(): ConfirmController {
  const [pending, setPending] = useState<PendingState | null>(null);
  const resolver = useRef<((result: ConfirmResult) => void) | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const idRef = useRef(0);
  const [controller] = useState<ConfirmController>(() => ({
    dialog: null,
    confirm: (options: ConfirmOptions) =>
      new Promise<ConfirmResult>((resolve) => {
        // A second request while one is open supersedes the first.
        resolver.current?.('cancel');
        resolver.current = resolve;
        setPending({ ...options, id: (idRef.current += 1) });
      }),
  }));

  const close = useCallback((result: ConfirmResult) => {
    setPending(null);
    const resolve = resolver.current;
    resolver.current = null;
    resolve?.(result);
  }, []);

  // Show the native modal once the element is in the DOM.
  useEffect(() => {
    const element = dialogRef.current;
    if (!element || !pending) return;
    if (typeof element.showModal === 'function') {
      if (!element.open) element.showModal();
    } else {
      element.setAttribute('open', '');
    }
  }, [pending]);

  useEffect(
    () => () => {
      resolver.current?.('cancel');
      resolver.current = null;
    },
    [],
  );

  const primary = pending?.primary ?? 'confirm';
  const actions: ConfirmAction[] = [];
  if (pending) {
    if (pending.discardLabel) {
      actions.push({ value: 'discard', label: pending.discardLabel, variant: 'ghost' });
    }
    actions.push({
      value: 'cancel',
      label: pending.cancelLabel ?? '取消',
      variant: 'ghost',
    });
    actions.push({
      value: 'confirm',
      label: pending.confirmLabel ?? '确定',
      variant: 'primary',
    });
  }

  const dialog = pending ? (
    <dialog
      key={pending.id}
      ref={dialogRef}
      className="se-dialog"
      aria-labelledby="se-dialog-title"
      onCancel={(event) => {
        // Esc: keep the browser from closing the element behind our back.
        event.preventDefault();
        close('cancel');
      }}
      onClose={() => {
        close('cancel');
      }}
    >
      <h2 className="se-dialog__title" id="se-dialog-title">
        {pending.title}
      </h2>
      <div className="se-dialog__body">{pending.message}</div>
      {pending.details && pending.details.length > 0 && (
        <ul className="se-dialog__details">
          {pending.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
      <div className="se-dialog__actions">
        {actions.map((action) => (
          <button
            key={action.value}
            type="button"
            className={`se-dialog__button se-dialog__button--${action.variant ?? 'ghost'}`}
            autoFocus={action.value === primary}
            onClick={() => close(action.value)}
          >
            {action.label}
          </button>
        ))}
      </div>
      <p className="se-dialog__hint">Esc 取消 · Enter 确认</p>
    </dialog>
  ) : null;

  controller.dialog = dialog;
  return controller;
}

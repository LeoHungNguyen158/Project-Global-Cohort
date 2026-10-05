"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Accessible modal built on the native <dialog> element: focus is trapped by the
 * browser, Escape closes it, and focus returns to the trigger on close.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  description,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  description?: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const returnFocus = useRef<Element | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      returnFocus.current = document.activeElement;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={() => {
        onClose();
        if (returnFocus.current instanceof HTMLElement) returnFocus.current.focus();
      }}
      className={`m-auto w-[calc(100%-2rem)] ${wide ? "max-w-3xl" : "max-w-lg"} rounded-lg border border-line bg-panel p-0 text-ink shadow-xl`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          {description ? <p id={descId} className="text-sm text-muted">{description}</p> : null}
        </div>
        <button type="button" onClick={() => ref.current?.close()} className="rounded-md p-2 hover:bg-canvas" aria-label="Close dialog">
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  );
}

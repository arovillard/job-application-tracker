"use client";

import { useEffect, useId, useRef } from "react";

type ModalProps = {
  children: React.ReactNode;
  dismissDisabled?: boolean;
  onClose: () => void;
  size?: "compact" | "wide";
  title: string;
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

let activeModalCount = 0;
let overflowBeforeModal = "";

export function Modal({ children, dismissDisabled = false, onClose, size = "compact", title }: ModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const dismissDisabledRef = useRef(dismissDisabled);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  dismissDisabledRef.current = dismissDisabled;

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (activeModalCount === 0) {
      overflowBeforeModal = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    activeModalCount += 1;
    const frame = window.requestAnimationFrame(() => {
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
      const initialFocus = dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]")
        ?? focusable.find((element) => !element.classList.contains("modal__close"))
        ?? focusable[0];
      (initialFocus ?? dialogRef.current)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!dismissDisabledRef.current) onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      activeModalCount -= 1;
      if (activeModalCount === 0) {
        document.body.style.overflow = overflowBeforeModal;
      }
      previousFocus.current?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !dismissDisabled) {
        onClose();
      }
    }}>
      <section aria-labelledby={titleId} aria-modal="true" className={`modal modal--${size}`} ref={dialogRef} role="dialog" tabIndex={-1}>
        <header className="modal__header">
          <h2 className="modal__title" id={titleId}>{title}</h2>
          <button className="modal__close" disabled={dismissDisabled} type="button" onClick={onClose}>
            <span aria-hidden="true">×</span><span className="sr-only">Close</span>
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

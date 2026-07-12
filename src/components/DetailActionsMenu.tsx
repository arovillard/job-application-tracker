"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

type DetailActionsMenuProps = {
  hasLinkedJob: boolean;
  onArchive: () => void;
  onCreateLinkedJob: () => void;
  onDelete: () => void;
  onEdit: () => void;
};

export function DetailActionsMenu({ hasLinkedJob, onArchive, onCreateLinkedJob, onDelete, onEdit }: DetailActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLButtonElement[]>([]);
  const focusFirstOnOpen = useRef(false);

  useEffect(() => {
    if (!open) return;
    if (focusFirstOnOpen.current) {
      focusFirstOnOpen.current = false;
      itemsRef.current[0]?.focus();
    }
    const dismiss = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [open]);

  const close = (restoreFocus = false) => {
    if (restoreFocus) triggerRef.current?.focus();
    setOpen(false);
  };
  const invoke = (action: () => void) => {
    close(true);
    action();
  };
  const keyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = itemsRef.current.length;
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Home") {
      event.preventDefault();
      itemsRef.current[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      itemsRef.current[count - 1]?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      itemsRef.current[(index + 1) % count]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      itemsRef.current[(index - 1 + count) % count]?.focus();
    }
  };
  const entries = [
    { label: "Edit details", action: onEdit },
    ...(hasLinkedJob ? [{ label: "Create job opportunity", action: onCreateLinkedJob }] : []),
    { label: "Archive", action: onArchive },
    { label: "Delete permanently", action: onDelete }
  ];

  return <div className="detail-actions-menu">
    <button aria-controls="detail-actions-menu" aria-expanded={open} aria-haspopup="menu" className="button" ref={triggerRef} type="button" onClick={() => setOpen((current) => !current)} onKeyDown={(event) => {
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        focusFirstOnOpen.current = true;
        setOpen(true);
      }
    }}>More</button>
    {open ? <div id="detail-actions-menu" ref={menuRef} role="menu">
      {entries.map((entry, index) => <button key={entry.label} ref={(element) => { if (element) itemsRef.current[index] = element; }} role="menuitem" type="button" onClick={() => invoke(entry.action)} onKeyDown={(event) => keyDown(event, index)}>{entry.label}</button>)}
    </div> : null}
  </div>;
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
}

export function NewOpportunityMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (open && !rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      } else if (event.key.toLowerCase() === "n" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !isEditableTarget(event.target)) {
        event.preventDefault();
        setOpen(true);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return <div className="new-opportunity-menu" ref={rootRef}>
    <button
      className="button button--primary"
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls="new-opportunity-menu"
      onClick={() => setOpen((current) => !current)}
      ref={buttonRef}
    >
      <span aria-hidden="true">+</span> New opportunity <kbd>N</kbd>
    </button>
    {open ? <div className="new-opportunity-menu__content" id="new-opportunity-menu" role="menu">
      <Link role="menuitem" href="/opportunities/new?type=job" onClick={() => setOpen(false)}>
        <strong>Job posting</strong>
        <span>Track a specific role and application process.</span>
      </Link>
      <Link role="menuitem" href="/opportunities/new?type=connection" onClick={() => setOpen(false)}>
        <strong>Connection</strong>
        <span>Track a person, interaction history, and follow-up.</span>
      </Link>
    </div> : null}
  </div>;
}

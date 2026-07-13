"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
}

export function NewOpportunityMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const jobItemRef = useRef<HTMLAnchorElement>(null);
  const connectionItemRef = useRef<HTMLAnchorElement>(null);
  const focusFirstItemOnOpen = useRef(false);

  useEffect(() => {
    if (open && focusFirstItemOnOpen.current) {
      jobItemRef.current?.focus();
      focusFirstItemOnOpen.current = false;
    }
  }, [open]);

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
        if (open) {
          jobItemRef.current?.focus();
        } else {
          focusFirstItemOnOpen.current = true;
          setOpen(true);
        }
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleButtonKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!open && (event.key === "Enter" || event.key === " ")) focusFirstItemOnOpen.current = true;
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLAnchorElement>) => {
    const items = [jobItemRef.current, connectionItemRef.current];
    const currentIndex = items.indexOf(event.currentTarget);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      items[(currentIndex + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.click();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return <div className="new-opportunity-menu" ref={rootRef}>
    <button
      className="button button--primary"
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls="new-opportunity-menu"
      onClick={() => setOpen((current) => !current)}
      onKeyDown={handleButtonKeyDown}
      ref={buttonRef}
    >
      <span aria-hidden="true">+</span> New opportunity <kbd>N</kbd>
    </button>
    {open ? <div className="new-opportunity-menu__content" id="new-opportunity-menu" role="menu">
      <Link role="menuitem" href="/opportunities/new?type=job" onClick={() => setOpen(false)} onKeyDown={handleMenuKeyDown} ref={jobItemRef}>
        <strong>Job posting</strong>
        <span>Track a specific role and application process.</span>
      </Link>
      <Link role="menuitem" href="/opportunities/new?type=connection" onClick={() => setOpen(false)} onKeyDown={handleMenuKeyDown} ref={connectionItemRef}>
        <strong>Connection</strong>
        <span>Track a person, interaction history, and follow-up.</span>
      </Link>
    </div> : null}
  </div>;
}

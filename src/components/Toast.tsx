"use client";

import { useEffect } from "react";

type ToastProps = {
  message: string | null;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
};

export function Toast({ message, actionLabel, onAction, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!message) {
      return;
    }

    const timeout = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(timeout);
  }, [message, onDismiss]);

  if (!message) {
    return null;
  }

  return (
    <div className="toast" role="status">
      <span>{message}</span>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction}>{actionLabel}</button>
      ) : null}
      <button className="toast__dismiss" type="button" aria-label="Dismiss notification" onClick={onDismiss}>×</button>
    </div>
  );
}

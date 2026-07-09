"use client";

import Link from "next/link";
import { useState } from "react";

import { type Application, type ApplicationInput } from "../types";

type QuickCaptureProps = {
  onCreate: (input: ApplicationInput) => Promise<Application>;
  disabled?: boolean;
};

export function QuickCapture({ onCreate, disabled = false }: QuickCaptureProps) {
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) {
      return;
    }
    setSaving(true);
    setError(null);

    try {
      await onCreate({
        company,
        role,
        status: "wishlist",
        source: null,
        location: null,
        url: url.trim() || null,
        contact: null,
        notes: null,
        appliedDate: null,
        followUpDate: null,
        nextAction: "Review opportunity",
        nextActionDate: null,
        priority: "medium"
      });
      setCompany("");
      setRole("");
      setUrl("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save application");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="quick-capture" aria-labelledby="quick-capture-title">
      <div className="quick-capture__copy">
        <p className="panel-heading__eyebrow">Capture</p>
        <h2 id="quick-capture-title">Save the opportunity before it disappears.</h2>
        <p>Company and role are enough to start. Refine the details when you are ready.</p>
      </div>
      <form className="quick-capture__form" onSubmit={(event) => void submit(event)}>
        <label>
          <span className="sr-only">Company</span>
          <input disabled={disabled} required value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Company" />
        </label>
        <label>
          <span className="sr-only">Role</span>
          <input disabled={disabled} required value={role} onChange={(event) => setRole(event.target.value)} placeholder="Role" />
        </label>
        <label className="quick-capture__url">
          <span className="sr-only">Job URL</span>
          <input disabled={disabled} type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Job URL (optional)" />
        </label>
        <button className="button button--primary" disabled={saving || disabled} type="submit">
          {saving ? "Saving…" : disabled ? "Loading…" : "Add to pipeline"}
        </button>
      </form>
      <div className="quick-capture__footer">
        {error ? <span role="alert">{error}</span> : <span>Default stage: Wishlist</span>}
        <Link href="/applications/new">Use the full form</Link>
      </div>
    </section>
  );
}

"use client";

import { useState } from "react";

import { JOB_STATUSES, OPPORTUNITY_PRIORITIES, type JobOpportunity, type JobOpportunityInput } from "../types";
import { JOB_STATUS_LABELS } from "./OpportunityTable";

const emptyJob: JobOpportunityInput = {
  type: "job", label: "", organization: "", status: "wishlist", priority: "medium",
  summary: null, url: null, source: null, location: null, contact: null, appliedDate: null,
  originOpportunityId: null
};

export function JobOpportunityForm({ initialValue, originOpportunityId, onSubmit, isSubmitting = false, submitLabel = "Create job opportunity" }: {
  initialValue?: JobOpportunity | JobOpportunityInput | null;
  originOpportunityId?: string | null;
  onSubmit: (input: JobOpportunityInput) => void | Promise<void>;
  isSubmitting?: boolean;
  submitLabel?: string;
}) {
  const [value, setValue] = useState<JobOpportunityInput>(() => ({ ...emptyJob, ...initialValue, originOpportunityId: originOpportunityId ?? initialValue?.originOpportunityId ?? null, type: "job" }));
  const set = <K extends keyof JobOpportunityInput>(key: K, next: JobOpportunityInput[K]) => setValue((current) => ({ ...current, [key]: next }));
  const text = (key: keyof JobOpportunityInput, label: string, required = false) => <label className="application-form__field"><span className="application-form__label">{label}</span><input className="application-form__input" required={required} value={(value[key] as string | null) ?? ""} onChange={(event) => set(key, event.target.value || null)} /></label>;
  return <form className="application-form" onSubmit={(event) => { event.preventDefault(); void onSubmit({ ...value, label: value.label.trim(), organization: value.organization?.trim() || null }); }}>
    <div className="application-form__grid">{text("label", "Role", true)}{text("organization", "Organization", true)}
      <label className="application-form__field"><span className="application-form__label">Stage</span><select className="application-form__select" value={value.status} onChange={(event) => set("status", event.target.value as JobOpportunityInput["status"])}>{JOB_STATUSES.map((status) => <option key={status} value={status}>{JOB_STATUS_LABELS[status]}</option>)}</select></label>
      <label className="application-form__field"><span className="application-form__label">Priority</span><select className="application-form__select" value={value.priority} onChange={(event) => set("priority", event.target.value as JobOpportunityInput["priority"])}>{OPPORTUNITY_PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}</select></label>
      {text("url", "Posting URL")}{text("source", "Source")}{text("location", "Location")}{text("contact", "Contact")}
      <label className="application-form__field"><span className="application-form__label">Applied date</span><input className="application-form__input" type="date" value={value.appliedDate ?? ""} onChange={(event) => set("appliedDate", event.target.value || null)} /></label>
    </div>
    <label className="application-form__field"><span className="application-form__label">Summary</span><textarea className="application-form__textarea" value={value.summary ?? ""} onChange={(event) => set("summary", event.target.value || null)} /></label>
    <button className="button button--primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Saving…" : submitLabel}</button>
  </form>;
}

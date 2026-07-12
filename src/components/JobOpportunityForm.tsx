"use client";

import { useRef, useState } from "react";

import { JOB_STATUSES, OPPORTUNITY_PRIORITIES, type JobOpportunity, type JobOpportunityInput, type OpportunityTaskInput } from "../types";
import { JOB_STATUS_LABELS } from "./OpportunityTable";

export type JobCreationPayload = { opportunity: JobOpportunityInput; initialTask: OpportunityTaskInput | null };
export type JobOpportunityFormMode = "create" | "edit" | "linked";

const emptyJob: JobOpportunityInput = { type: "job", label: "", organization: "", status: "wishlist", priority: "medium", summary: null, url: null, source: null, location: null, contact: null, appliedDate: null, originOpportunityId: null };
const appliedStatuses = new Set(["applied", "interviewing", "offer", "rejected"]);

export function JobOpportunityForm({ initialValue, originOpportunityId, onSubmit, isSubmitting = false, submitLabel = "Create job opportunity", mode = "create", onCancel }: {
  initialValue?: JobOpportunity | JobOpportunityInput | null;
  originOpportunityId?: string | null;
  onSubmit: (payload: JobCreationPayload) => void | Promise<void>;
  isSubmitting?: boolean;
  submitLabel?: string;
  mode?: JobOpportunityFormMode;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState<JobOpportunityInput>(() => ({ ...emptyJob, ...initialValue, originOpportunityId: originOpportunityId ?? initialValue?.originOpportunityId ?? null, type: "job" }));
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const optionalPopulated = Boolean(initialValue?.url || initialValue?.source || initialValue?.location || initialValue?.contact || initialValue?.summary || initialValue?.appliedDate);
  const [detailsOpen, setDetailsOpen] = useState(mode !== "create" && optionalPopulated);
  const urlRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof JobOpportunityInput>(key: K, next: JobOpportunityInput[K]) => setValue((current) => ({ ...current, [key]: next }));
  const optional = (key: keyof JobOpportunityInput, label: string, type = "text") => {
    const helperId = `job-${String(key)}-helper`;
    return <label className="application-form__field"><span className="application-form__label">{label}</span><input ref={key === "url" ? urlRef : undefined} className="application-form__input" type={type} aria-describedby={helperId} value={(value[key] as string | null) ?? ""} onInvalid={() => { setDetailsOpen(true); requestAnimationFrame(() => urlRef.current?.focus()); }} onChange={(event) => set(key, event.target.value || null)} /><span id={helperId} className="application-form__helper">Optional</span></label>;
  };
  const showAppliedDate = appliedStatuses.has(value.status);
  const submit = () => {
    const opportunity = { ...value, label: value.label.trim(), organization: value.organization?.trim() || null, appliedDate: showAppliedDate ? value.appliedDate : null };
    onSubmit({ opportunity, initialTask: mode === "create" && taskTitle.trim() ? { title: taskTitle.trim(), dueDate: taskDueDate || null } : null });
  };
  return <form className="application-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div className="application-form__grid">
      <label className="application-form__field"><span className="application-form__label">Role <span>Required</span></span><input className="application-form__input" required aria-describedby="job-label-helper" value={value.label} onChange={(event) => set("label", event.target.value)} /><span id="job-label-helper" className="application-form__helper">Enter the role title.</span></label>
      <label className="application-form__field"><span className="application-form__label">Organization <span>Required</span></span><input className="application-form__input" required aria-describedby="job-organization-helper" value={value.organization ?? ""} onChange={(event) => set("organization", event.target.value || null)} /><span id="job-organization-helper" className="application-form__helper">Enter the organization name.</span></label>
    </div>
    <fieldset className="application-form__fieldset"><legend>Plan your next move</legend><div className="application-form__grid">
      <label className="application-form__field"><span className="application-form__label">Stage</span><select className="application-form__select" value={value.status} onChange={(event) => set("status", event.target.value as JobOpportunityInput["status"])}>{JOB_STATUSES.map((status) => <option key={status} value={status}>{JOB_STATUS_LABELS[status]}</option>)}</select></label>
      <label className="application-form__field"><span className="application-form__label">Priority</span><select className="application-form__select" value={value.priority} onChange={(event) => set("priority", event.target.value as JobOpportunityInput["priority"])}>{OPPORTUNITY_PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}</select></label>
      {mode === "create" ? <><label className="application-form__field"><span className="application-form__label">First task</span><input className="application-form__input" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} /></label><label className="application-form__field"><span className="application-form__label">Due date</span><input className="application-form__input" type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} /></label></> : null}
    </div></fieldset>
    <details open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}><summary>Optional details</summary><div className="application-form__grid">
      {optional("url", "Posting URL", "url")}{optional("source", "Source")}{optional("location", "Location")}{optional("contact", "Contact")}
      {showAppliedDate ? <label className="application-form__field"><span className="application-form__label">Applied date</span><input className="application-form__input" type="date" value={value.appliedDate ?? ""} onChange={(event) => set("appliedDate", event.target.value || null)} /></label> : null}
    </div><label className="application-form__field"><span className="application-form__label">Summary</span><textarea className="application-form__textarea" value={value.summary ?? ""} onChange={(event) => set("summary", event.target.value || null)} /></label></details>
    <div className="application-form__actions">{onCancel ? <button className="button" type="button" onClick={onCancel}>Cancel</button> : null}<button className="button button--primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Saving…" : submitLabel}</button></div>
  </form>;
}

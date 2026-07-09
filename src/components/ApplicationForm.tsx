"use client";

import { useId, useState } from "react";

import {
  APPLICATION_PRIORITIES,
  APPLICATION_STATUSES,
  EMPTY_APPLICATION_INPUT,
  STATUS_LABELS,
  type Application,
  type ApplicationInput
} from "../types";

type ApplicationFormState = {
  company: string;
  role: string;
  status: ApplicationInput["status"];
  priority: Application["priority"];
  nextAction: string;
  nextActionDate: string;
  source: string;
  location: string;
  url: string;
  contact: string;
  appliedDate: string;
  notes: string;
};

type ApplicationFormProps = {
  initialValue?: Application | ApplicationInput | null;
  onSubmit: (input: ApplicationInput) => void | Promise<void>;
  onCancel?: () => void;
  showStatus?: boolean;
  submitLabel?: string;
  isSubmitting?: boolean;
};

function createFormState(value: Application | ApplicationInput | null | undefined): ApplicationFormState {
  const application = value ?? EMPTY_APPLICATION_INPUT;

  return {
    company: application.company,
    role: application.role,
    status: application.status,
    priority: application.priority ?? "medium",
    nextAction: application.nextAction ?? "",
    nextActionDate: application.nextActionDate ?? "",
    source: application.source ?? "",
    location: application.location ?? "",
    url: application.url ?? "",
    contact: application.contact ?? "",
    appliedDate: application.appliedDate ?? "",
    notes: application.notes ?? ""
  };
}

function toApplicationInput(state: ApplicationFormState): ApplicationInput {
  const normalizeOptional = (value: string) => (value.trim() === "" ? null : value);

  return {
    company: state.company,
    role: state.role,
    status: state.status,
    priority: state.priority,
    nextAction: normalizeOptional(state.nextAction),
    nextActionDate: normalizeOptional(state.nextActionDate),
    source: normalizeOptional(state.source),
    location: normalizeOptional(state.location),
    url: normalizeOptional(state.url),
    contact: normalizeOptional(state.contact),
    appliedDate: normalizeOptional(state.appliedDate),
    followUpDate: null,
    notes: normalizeOptional(state.notes)
  };
}

export function ApplicationForm({
  initialValue = null,
  onSubmit,
  onCancel,
  showStatus = true,
  submitLabel = "Save application",
  isSubmitting = false
}: ApplicationFormProps) {
  const fieldId = useId();
  const [formState, setFormState] = useState<ApplicationFormState>(() => createFormState(initialValue));

  const update = <Key extends keyof ApplicationFormState>(key: Key, value: ApplicationFormState[Key]) => {
    setFormState((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isSubmitting) {
      void onSubmit(toApplicationInput(formState));
    }
  };

  return (
    <form className="application-form" onSubmit={handleSubmit}>
      <div className="application-form__intro">
        <strong>Start with the signal.</strong>
        <span>Company and role are required. Add the details that make the next move clear.</span>
      </div>
      <div className="application-form__grid">
        <label className="application-form__field" htmlFor={`${fieldId}-company`}>
          <span className="application-form__label">Company <em>Required</em></span>
          <input className="application-form__input" id={`${fieldId}-company`} name="company" required value={formState.company} onChange={(event) => update("company", event.target.value)} />
        </label>
        <label className="application-form__field" htmlFor={`${fieldId}-role`}>
          <span className="application-form__label">Role <em>Required</em></span>
          <input className="application-form__input" id={`${fieldId}-role`} name="role" required value={formState.role} onChange={(event) => update("role", event.target.value)} />
        </label>
        {showStatus ? (
          <label className="application-form__field" htmlFor={`${fieldId}-status`}>
            <span className="application-form__label">Stage</span>
            <select className="application-form__select" id={`${fieldId}-status`} name="status" value={formState.status} onChange={(event) => update("status", event.target.value as ApplicationInput["status"])}>
              {APPLICATION_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
            </select>
          </label>
        ) : null}
        <label className="application-form__field" htmlFor={`${fieldId}-priority`}>
          <span className="application-form__label">Focus</span>
          <select className="application-form__select" id={`${fieldId}-priority`} name="priority" value={formState.priority} onChange={(event) => update("priority", event.target.value as Application["priority"])}>
            {APPLICATION_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority[0]?.toUpperCase()}{priority.slice(1)} focus</option>)}
          </select>
        </label>
      </div>

      <section className="application-form__planning" aria-labelledby={`${fieldId}-planning`}>
        <div>
          <p className="panel-heading__eyebrow">Next move</p>
          <h3 id={`${fieldId}-planning`}>Give this opportunity momentum.</h3>
        </div>
        <div className="application-form__grid application-form__grid--planning">
          <label className="application-form__field" htmlFor={`${fieldId}-next-action`}>
            <span className="application-form__label">Next action</span>
            <input className="application-form__input" id={`${fieldId}-next-action`} name="nextAction" value={formState.nextAction} onChange={(event) => update("nextAction", event.target.value)} placeholder="e.g. Send a tailored follow-up" />
          </label>
          <label className="application-form__field" htmlFor={`${fieldId}-next-action-date`}>
            <span className="application-form__label">Due date</span>
            <input className="application-form__input" id={`${fieldId}-next-action-date`} name="nextActionDate" type="date" value={formState.nextActionDate} onChange={(event) => update("nextActionDate", event.target.value)} />
          </label>
        </div>
      </section>

      <details className="form-disclosure">
        <summary>More details <span>Optional</span></summary>
        <div className="application-form__grid form-disclosure__grid">
          <label className="application-form__field" htmlFor={`${fieldId}-source`}><span className="application-form__label">Source</span><input className="application-form__input" id={`${fieldId}-source`} name="source" value={formState.source} onChange={(event) => update("source", event.target.value)} /></label>
          <label className="application-form__field" htmlFor={`${fieldId}-location`}><span className="application-form__label">Location</span><input className="application-form__input" id={`${fieldId}-location`} name="location" value={formState.location} onChange={(event) => update("location", event.target.value)} /></label>
          <label className="application-form__field" htmlFor={`${fieldId}-url`}><span className="application-form__label">Job URL</span><input className="application-form__input" id={`${fieldId}-url`} name="url" type="url" value={formState.url} onChange={(event) => update("url", event.target.value)} /></label>
          <label className="application-form__field" htmlFor={`${fieldId}-contact`}><span className="application-form__label">Contact</span><input className="application-form__input" id={`${fieldId}-contact`} name="contact" value={formState.contact} onChange={(event) => update("contact", event.target.value)} /></label>
          <label className="application-form__field" htmlFor={`${fieldId}-applied-date`}><span className="application-form__label">Applied date</span><input className="application-form__input" id={`${fieldId}-applied-date`} name="appliedDate" type="date" value={formState.appliedDate} onChange={(event) => update("appliedDate", event.target.value)} /></label>
          <label className="application-form__field application-form__field--wide" htmlFor={`${fieldId}-notes`}><span className="application-form__label">Notes</span><textarea className="application-form__textarea" id={`${fieldId}-notes`} name="notes" rows={4} value={formState.notes} onChange={(event) => update("notes", event.target.value)} /></label>
        </div>
      </details>

      <div className="application-form__actions">
        {onCancel ? <button className="application-form__button application-form__button--secondary" disabled={isSubmitting} type="button" onClick={onCancel}>Cancel</button> : null}
        <button className="application-form__button application-form__button--primary" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

"use client";

import { useState } from "react";

import { CONNECTION_STATUSES, OPPORTUNITY_PRIORITIES, RELATIONSHIP_STRENGTHS, type ConnectionOpportunityInput, type OpportunityActivityInput, type OpportunityTaskInput } from "../types";
import { CONNECTION_STATUS_LABELS } from "./OpportunityTable";

export type ConnectionFormState = {
  label: string; organization: string; roleContext: string; contactInfo: string; meetingContext: string;
  summary: string; relationshipStrength: ConnectionOpportunityInput["relationshipStrength"];
  status: ConnectionOpportunityInput["status"]; priority: NonNullable<ConnectionOpportunityInput["priority"]>;
  activityType: OpportunityActivityInput["type"]; activityBody: string; activityDate: string;
  taskTitle: string; taskDueDate: string;
};

export type ConnectionCreationPayload = {
  opportunity: ConnectionOpportunityInput;
  initialActivity: OpportunityActivityInput | null;
  initialTask: OpportunityTaskInput | null;
};

export function buildConnectionCreationPayload(state: ConnectionFormState): ConnectionCreationPayload {
  return {
    opportunity: {
      type: "connection", label: state.label.trim(), organization: state.organization.trim() || null,
      roleContext: state.roleContext.trim() || null, contactInfo: state.contactInfo.trim() || null,
      meetingContext: state.meetingContext.trim() || null, summary: state.summary.trim() || null,
      relationshipStrength: state.relationshipStrength, status: state.status, priority: state.priority
    },
    initialActivity: state.activityBody.trim() ? {
      type: state.activityType, body: state.activityBody.trim(),
      occurredAt: state.activityDate ? `${state.activityDate}T12:00:00.000Z` : new Date().toISOString()
    } : null,
    initialTask: state.taskTitle.trim() ? { title: state.taskTitle.trim(), dueDate: state.taskDueDate || null } : null
  };
}

const empty: ConnectionFormState = {
  label: "", organization: "", roleContext: "", contactInfo: "", meetingContext: "", summary: "",
  relationshipStrength: "new", status: "new", priority: "medium", activityType: "note", activityBody: "",
  activityDate: "", taskTitle: "", taskDueDate: ""
};

export function ConnectionOpportunityForm({ onSubmit, isSubmitting = false }: {
  onSubmit: (payload: ConnectionCreationPayload) => void | Promise<void>; isSubmitting?: boolean;
}) {
  const [state, setState] = useState(empty);
  const set = <K extends keyof ConnectionFormState>(key: K, value: ConnectionFormState[K]) => setState((current) => ({ ...current, [key]: value }));
  const input = (key: keyof ConnectionFormState, label: string, required = false) => <label className="application-form__field"><span className="application-form__label">{label}</span><input className="application-form__input" required={required} value={state[key] as string} onChange={(event) => set(key, event.target.value as never)} /></label>;
  return <form className="application-form" onSubmit={(event) => { event.preventDefault(); void onSubmit(buildConnectionCreationPayload(state)); }}>
    <div className="application-form__grid">{input("label", "Person's name", true)}{input("organization", "Organization")}{input("roleContext", "Role or context")}{input("contactInfo", "Contact information")}{input("meetingContext", "Where or how you met")}
      <label className="application-form__field"><span className="application-form__label">Relationship strength</span><select className="application-form__select" value={state.relationshipStrength} onChange={(event) => set("relationshipStrength", event.target.value as ConnectionFormState["relationshipStrength"])}>{RELATIONSHIP_STRENGTHS.map((strength) => <option key={strength}>{strength}</option>)}</select></label>
      <label className="application-form__field"><span className="application-form__label">Stage</span><select className="application-form__select" value={state.status} onChange={(event) => set("status", event.target.value as ConnectionFormState["status"])}>{CONNECTION_STATUSES.map((status) => <option key={status} value={status}>{CONNECTION_STATUS_LABELS[status]}</option>)}</select></label>
      <label className="application-form__field"><span className="application-form__label">Priority</span><select className="application-form__select" value={state.priority} onChange={(event) => set("priority", event.target.value as ConnectionFormState["priority"])}>{OPPORTUNITY_PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}</select></label>
    </div>
    <label className="application-form__field"><span className="application-form__label">Summary</span><textarea className="application-form__textarea" value={state.summary} onChange={(event) => set("summary", event.target.value)} /></label>
    <fieldset className="application-form__fieldset"><legend>Initial interaction</legend><div className="application-form__grid">
      <label className="application-form__field"><span className="application-form__label">Type</span><select className="application-form__select" value={state.activityType} onChange={(event) => set("activityType", event.target.value as ConnectionFormState["activityType"])}>{["note", "meeting", "call", "email", "message", "introduction"].map((type) => <option key={type}>{type}</option>)}</select></label>
      {input("activityDate", "Date")}{input("activityBody", "What happened?")}
    </div></fieldset>
    <fieldset className="application-form__fieldset"><legend>Next action</legend><div className="application-form__grid">{input("taskTitle", "Action")}{input("taskDueDate", "Due date")}</div></fieldset>
    <button className="button button--primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Saving…" : "Create connection"}</button>
  </form>;
}

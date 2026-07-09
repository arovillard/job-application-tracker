"use client";

import { useId, useState } from "react";

import {
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
};

function createFormState(value: Application | ApplicationInput | null | undefined): ApplicationFormState {
  const application = value ?? EMPTY_APPLICATION_INPUT;

  return {
    company: application.company,
    role: application.role,
    status: application.status,
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
  submitLabel = "Save application"
}: ApplicationFormProps) {
  const fieldId = useId();
  const [formState, setFormState] = useState<ApplicationFormState>(() => createFormState(initialValue));

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSubmit(toApplicationInput(formState));
  };

  return (
    <form className="application-form" onSubmit={handleSubmit}>
      <div className="application-form__field">
        <label className="application-form__label" htmlFor={`${fieldId}-company`}>
          Company
        </label>
        <input
          className="application-form__input"
          id={`${fieldId}-company`}
          name="company"
          type="text"
          required
          value={formState.company}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              company: event.target.value
            }))
          }
        />
      </div>

      <div className="application-form__field">
        <label className="application-form__label" htmlFor={`${fieldId}-role`}>
          Role
        </label>
        <input
          className="application-form__input"
          id={`${fieldId}-role`}
          name="role"
          type="text"
          required
          value={formState.role}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              role: event.target.value
            }))
          }
        />
      </div>

      {showStatus ? (
        <div className="application-form__field">
          <label className="application-form__label" htmlFor={`${fieldId}-status`}>
            Status
          </label>
          <select
            className="application-form__select"
            id={`${fieldId}-status`}
            name="status"
            value={formState.status}
            onChange={(event) =>
              setFormState((current) => ({
                ...current,
                status: event.target.value as ApplicationInput["status"]
              }))
            }
          >
            {APPLICATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="application-form__field">
        <label className="application-form__label" htmlFor={`${fieldId}-source`}>
          Source
        </label>
        <input
          className="application-form__input"
          id={`${fieldId}-source`}
          name="source"
          type="text"
          value={formState.source}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              source: event.target.value
            }))
          }
        />
      </div>

      <div className="application-form__field">
        <label className="application-form__label" htmlFor={`${fieldId}-location`}>
          Location
        </label>
        <input
          className="application-form__input"
          id={`${fieldId}-location`}
          name="location"
          type="text"
          value={formState.location}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              location: event.target.value
            }))
          }
        />
      </div>

      <div className="application-form__field">
        <label className="application-form__label" htmlFor={`${fieldId}-url`}>
          URL
        </label>
        <input
          className="application-form__input"
          id={`${fieldId}-url`}
          name="url"
          type="url"
          value={formState.url}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              url: event.target.value
            }))
          }
        />
      </div>

      <div className="application-form__field">
        <label className="application-form__label" htmlFor={`${fieldId}-contact`}>
          Contact
        </label>
        <input
          className="application-form__input"
          id={`${fieldId}-contact`}
          name="contact"
          type="text"
          value={formState.contact}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              contact: event.target.value
            }))
          }
        />
      </div>

      <div className="application-form__field">
        <label className="application-form__label" htmlFor={`${fieldId}-appliedDate`}>
          Applied date
        </label>
        <input
          className="application-form__input"
          id={`${fieldId}-appliedDate`}
          name="appliedDate"
          type="date"
          value={formState.appliedDate}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              appliedDate: event.target.value
            }))
          }
        />
      </div>

      <div className="application-form__field">
        <label className="application-form__label" htmlFor={`${fieldId}-notes`}>
          Notes
        </label>
        <textarea
          className="application-form__textarea"
          id={`${fieldId}-notes`}
          name="notes"
          rows={5}
          value={formState.notes}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              notes: event.target.value
            }))
          }
        />
      </div>

      <div className="application-form__actions">
        {onCancel ? (
          <button className="application-form__button application-form__button--secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button className="application-form__button application-form__button--primary" type="submit">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

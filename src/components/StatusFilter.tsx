"use client";

import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  type ApplicationStatus
} from "../types";

export type StatusFilterValue = ApplicationStatus | "all";

type StatusFilterProps = {
  value: StatusFilterValue;
  onChange: (value: StatusFilterValue) => void;
  counts?: Partial<Record<StatusFilterValue, number>>;
};

export function StatusFilter({ value, onChange, counts = {} }: StatusFilterProps) {
  const options: Array<{ value: StatusFilterValue; label: string }> = [
    { value: "all", label: "All" },
    ...APPLICATION_STATUSES.map((status) => ({
      value: status,
      label: STATUS_LABELS[status]
    }))
  ];

  return (
    <div className="status-filter" role="group" aria-label="Filter applications by status">
      {options.map((option) => {
        const count = counts[option.value];

        return (
          <button
            className="status-filter__button"
            type="button"
            key={option.value}
            aria-pressed={value === option.value}
            data-active={value === option.value ? "true" : "false"}
            onClick={() => onChange(option.value)}
          >
            <span className="status-filter__label">{option.label}</span>
            {count !== undefined ? <span className="status-filter__count">{count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

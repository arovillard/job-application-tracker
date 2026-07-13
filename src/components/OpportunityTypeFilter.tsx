"use client";

import type { OpportunityType } from "../types";

export type OpportunityTypeFilterValue = OpportunityType | "all";

export function OpportunityTypeFilter({
  value,
  onChange
}: {
  value: OpportunityTypeFilterValue;
  onChange: (value: OpportunityTypeFilterValue) => void;
}) {
  const options: Array<{ value: OpportunityTypeFilterValue; label: string }> = [
    { value: "all", label: "All" },
    { value: "job", label: "Jobs" },
    { value: "connection", label: "Connections" }
  ];
  return (
    <div className="opportunity-type-filter" role="group" aria-label="Filter opportunities by type">
      {options.map((option) => (
        <button
          className="status-filter__button"
          data-active={value === option.value ? "true" : "false"}
          aria-pressed={value === option.value}
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

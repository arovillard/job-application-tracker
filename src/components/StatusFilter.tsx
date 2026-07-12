"use client";

export type StatusFilterOption = { value: string; label: string; count?: number };

type StatusFilterProps = {
  value: string;
  options: StatusFilterOption[];
  onChange: (value: string) => void;
};

export function StatusFilter({ value, options, onChange }: StatusFilterProps) {
  return (
    <div className="status-filter" role="group" aria-label="Filter opportunities by status">
      {options.map((option) => (
        <button
          className="status-filter__button"
          type="button"
          key={option.value}
          aria-pressed={value === option.value}
          data-active={value === option.value ? "true" : "false"}
          onClick={() => onChange(option.value)}
        >
          <span className="status-filter__label">{option.label}</span>
          {option.count !== undefined ? <span className="status-filter__count">{option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

import { type DashboardInsights } from "../lib/dashboard";

type PipelineOverviewProps = {
  metrics: DashboardInsights["metrics"];
  onSelect: (view: "active" | "attention" | "interviewing" | "offer") => void;
};

export function PipelineOverview({ metrics, onSelect }: PipelineOverviewProps) {
  const cards: Array<{
    label: string;
    value: number;
    detail: string;
    view: "active" | "attention" | "interviewing" | "offer";
    tone: "ink" | "warning" | "accent" | "success";
  }> = [
    { label: "Active", value: metrics.active, detail: "live opportunities", view: "active", tone: "ink" },
    { label: "Needs attention", value: metrics.attention, detail: "moves to make now", view: "attention", tone: "warning" },
    { label: "Interviewing", value: metrics.interviewing, detail: "in conversation", view: "interviewing", tone: "accent" },
    { label: "Offers", value: metrics.offers, detail: "decisions in motion", view: "offer", tone: "success" }
  ];

  return (
    <section className="pipeline-overview" aria-label="Pipeline overview">
      {cards.map((card) => (
        <button
          className={`metric-card metric-card--${card.tone}`}
          type="button"
          key={card.label}
          onClick={() => onSelect(card.view)}
        >
          <span className="metric-card__label">{card.label}</span>
          <strong className="metric-card__value">{card.value}</strong>
          <span className="metric-card__detail">{card.detail}</span>
        </button>
      ))}
    </section>
  );
}

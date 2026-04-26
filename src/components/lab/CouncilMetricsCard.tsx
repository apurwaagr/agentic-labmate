import React from "react";
import { QualityScores } from "@/lib/labApi";
import { CheckCircle2, ShieldAlert } from "lucide-react";

export function CouncilMetricsCard({ scores }: { scores: QualityScores }) {
  if (!scores) return null;

  return (
    <div className="rounded-2xl border border-border bg-panel shadow-sm overflow-hidden p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">Council Quality Metrics</h3>
        <p className="text-xs text-muted-foreground">Computed after council deliberation rounds</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <MetricItem label="Faithfulness" value={scores.faithfulness} format="%" />
        <MetricItem label="Step Coverage" value={scores.step_coverage} format="%" />
        <MetricItem label="Entity Precision" value={scores.entity_precision} format="%" />
        <MetricItem label="Retrieval Recall@10" value={scores.retrieval_recall_at_10} format="%" />
        <MetricItem label="Convergence" value={scores.convergence_score} format="%" />
        <div className="rounded-xl border border-primary/20 bg-primary-soft p-3">
          <div className="text-[10px] font-semibold uppercase text-primary mb-1">Composite Score</div>
          <div className="text-2xl font-bold text-primary">{Math.round(scores.composite * 100)} / 100</div>
        </div>
      </div>
    </div>
  );
}

function MetricItem({ label, value, format }: { label: string; value: number; format: string }) {
  const displayValue = format === "%" ? Math.round(value * 100) : value;
  const isGood = value >= 0.8;
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <div className="flex justify-between items-start mb-1">
        <div className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</div>
        {isGood ? <CheckCircle2 className="size-3 text-success" /> : <ShieldAlert className="size-3 text-warning" />}
      </div>
      <div className="text-lg font-bold">{displayValue}{format}</div>
    </div>
  );
}

import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import type { ValidationPlan } from "@/lib/labApi";

/** Heuristic: gate text contains "fail", "no-go", "halt", "stop", "abort" → NO-GO */
function gateStatus(gate: string): "go" | "nogo" | "conditional" {
  const lower = gate.toLowerCase();
  if (/(fail|no.go|halt|stop|abort|reject)/.test(lower)) return "nogo";
  if (/(if|when|unless|only if|condition|depend|threshold)/.test(lower)) return "conditional";
  return "go";
}

const gateStyle = {
  go: {
    dot: "bg-success",
    badge: "border-success/25 bg-success-soft text-success",
    label: "GO",
  },
  conditional: {
    dot: "bg-warning",
    badge: "border-warning/25 bg-warning-soft text-warning",
    label: "COND.",
  },
  nogo: {
    dot: "bg-danger",
    badge: "border-danger/25 bg-danger-soft text-danger",
    label: "NO-GO",
  },
};

export function ValidationCard({ validation }: { validation: ValidationPlan }) {
  return (
    <section className="rounded-2xl bg-panel border border-border shadow-sm overflow-hidden">
      {/* Header */}
      <header className="border-b border-border bg-[radial-gradient(circle_at_top_right,_hsl(var(--success-soft)),_transparent_55%)] px-5 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-success text-white shadow-sm">
              <ShieldCheck className="size-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold leading-tight">Validation &amp; Go / No-Go Gates</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Scientific decision criteria before proceeding to next phase</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success-soft px-2.5 py-1 text-success">
              <span className="size-1.5 rounded-full bg-success" />
              {validation.decisionGates.filter((g) => gateStatus(g) === "go").length} GO
            </span>
            {validation.decisionGates.filter((g) => gateStatus(g) === "conditional").length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/25 bg-warning-soft px-2.5 py-1 text-warning">
                <span className="size-1.5 rounded-full bg-warning" />
                {validation.decisionGates.filter((g) => gateStatus(g) === "conditional").length} COND
              </span>
            )}
            {validation.decisionGates.filter((g) => gateStatus(g) === "nogo").length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-danger/25 bg-danger-soft px-2.5 py-1 text-danger">
                <span className="size-1.5 rounded-full bg-danger" />
                {validation.decisionGates.filter((g) => gateStatus(g) === "nogo").length} NO-GO
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="p-5 space-y-4">
        {/* Primary metric — hero card */}
        <div className="rounded-xl border-2 border-success/25 bg-success-soft/40 p-4">
          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-success">
            <CheckCircle2 className="size-3.5" />
            Primary success metric
          </div>
          <div className="text-sm font-semibold text-foreground">{validation.primaryMetric}</div>
          <p className="mt-2 text-xs leading-relaxed text-foreground/75">{validation.successCriteria}</p>
        </div>

        {/* Decision gates — traffic light */}
        <div>
          <div className="mb-2.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <ShieldCheck className="size-3.5 text-primary" />
            Decision gates
          </div>
          <ul className="space-y-2">
            {validation.decisionGates.map((gate) => {
              const status = gateStatus(gate);
              const style = gateStyle[status];
              return (
                <li key={gate} className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-3">
                  {/* Traffic-light indicator */}
                  <span className={`mt-0.5 flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-wide ${style.badge}`}>
                    <span className={`size-1.5 rounded-full ${style.dot}`} />
                    {style.label}
                  </span>
                  <p className="text-xs leading-relaxed text-foreground/85">{gate}</p>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Failure criteria */}
        <div className="rounded-xl border border-danger/20 bg-danger-soft/30 p-4">
          <div className="mb-2.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-danger">
            <XCircle className="size-3.5" />
            Failure / abort criteria
          </div>
          <ul className="space-y-2">
            {validation.failureCriteria.map((item) => (
              <li key={item} className="flex items-start gap-2 text-xs leading-relaxed text-foreground/80">
                <XCircle className="size-3 mt-0.5 shrink-0 text-danger/70" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

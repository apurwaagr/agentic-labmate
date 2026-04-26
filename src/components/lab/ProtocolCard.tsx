import { useState } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, ChevronDown, Clock3, FlaskConical, ShieldCheck, TestTube2, XCircle } from "lucide-react";
import type { MaterialItem, ProtocolStep } from "@/lib/labApi";

const riskColor = {
  low: "bg-success-soft text-success border-success/25",
  med: "bg-warning-soft text-warning border-warning/25",
  high: "bg-danger-soft text-danger border-danger/25",
};

const riskIcon = {
  low: <CheckCircle2 className="size-3.5" />,
  med: <AlertTriangle className="size-3.5" />,
  high: <XCircle className="size-3.5" />,
};

export function ProtocolCard({ steps, materials = [] }: { steps: ProtocolStep[]; materials?: MaterialItem[] }) {
  const [open, setOpen] = useState<string | null>(steps[0]?.id ?? null);

  const highRiskCount = steps.filter((s) => s.riskLevel === "high").length;
  const gateCount = steps.filter((s) => s.decisionGate).length;

  return (
    <section className="rounded-2xl bg-panel border border-border shadow-sm overflow-hidden">
      {/* Header */}
      <header className="border-b border-border bg-[radial-gradient(circle_at_top_left,_hsl(var(--primary-soft)),_transparent_60%)] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <TestTube2 className="size-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold leading-tight">Experimental Portal</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Step-by-step operational protocol with risk controls and decision gates
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-panel px-2.5 py-1 text-muted-foreground">
              <FlaskConical className="size-3 text-primary" />
              {steps.length} steps
            </span>
            {gateCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success-soft px-2.5 py-1 text-success">
                <ShieldCheck className="size-3" />
                {gateCount} gates
              </span>
            )}
            {highRiskCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-danger/25 bg-danger-soft px-2.5 py-1 text-danger">
                <AlertTriangle className="size-3" />
                {highRiskCount} high-risk
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="p-4 space-y-3">
        {/* Materials strip */}
        {materials.length > 0 && (
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <div className="mb-2.5 flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Required materials ({materials.length})</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {materials.map((item) => (
                <span
                  key={`${item.catalogNumber}-${item.name}`}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                    item.status === "order"
                      ? "border-warning/30 bg-warning-soft text-warning"
                      : item.status === "owned"
                        ? "border-success/30 bg-success-soft text-success"
                        : "border-border bg-panel text-foreground/80"
                  }`}
                >
                  {item.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Steps */}
        {steps.map((step, index) => {
          const isOpen = open === step.id;
          const isLast = index === steps.length - 1;
          return (
            <div key={step.id} className="relative flex gap-3">
              {/* Step connector line */}
              {!isLast && (
                <div className="absolute left-[17px] top-[38px] bottom-0 w-px bg-gradient-to-b from-primary/25 to-transparent" />
              )}

              {/* Step number circle */}
              <div className="shrink-0 mt-0.5">
                <div
                  className={`flex size-9 items-center justify-center rounded-full border-2 text-sm font-bold shadow-sm transition-colors ${
                    isOpen
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-primary/30 bg-primary-soft text-primary"
                  }`}
                >
                  {index + 1}
                </div>
              </div>

              {/* Step card */}
              <article className="flex-1 min-w-0 rounded-2xl border border-border bg-muted/20 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : step.id)}
                  className="flex w-full items-start gap-3 p-3.5 text-left hover:bg-muted/30 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold leading-snug">{step.title}</h4>
                      {step.riskLevel && (
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${riskColor[step.riskLevel]}`}>
                          {riskIcon[step.riskLevel]}
                          {step.riskLevel === "low" ? "Low" : step.riskLevel === "med" ? "Medium" : "High"} risk
                        </span>
                      )}
                      {step.decisionGate && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary">
                          <ShieldCheck className="size-3" />
                          Gate
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                      <span className="rounded-full bg-panel border border-border px-2 py-0.5 font-mono">{step.quantity}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-panel border border-border px-2 py-0.5">
                        <Clock3 className="size-2.5" />
                        {step.duration}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-panel border border-border px-2 py-0.5">
                        <BookOpen className="size-2.5" />
                        {step.source}
                      </span>
                    </div>
                  </div>
                  <ChevronDown className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
                </button>

                {isOpen && (
                  <div className="border-t border-border bg-panel/60 px-4 py-3 space-y-2">
                    {/* Procedure — compact prose */}
                    <p className="text-xs leading-relaxed text-foreground/80">{step.detail}</p>

                    {/* Validation checks as tightly-spaced bullets */}
                    {step.validationChecks.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {step.validationChecks.map((check) => (
                          <span key={check} className="inline-flex items-center gap-1 rounded-full border border-success/25 bg-success-soft px-2 py-0.5 text-[10px] text-success">
                            <CheckCircle2 className="size-2.5 shrink-0" />
                            {check}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Risk + gate inline */}
                    <div className="flex flex-wrap gap-2">
                      {step.riskLevel && step.riskNote && (
                        <div className={`flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug flex-1 min-w-0 ${riskColor[step.riskLevel]}`}>
                          <span className="shrink-0 mt-0.5">{riskIcon[step.riskLevel]}</span>
                          <span>{step.riskNote}</span>
                        </div>
                      )}
                      {step.decisionGate && (
                        <div className="flex items-start gap-1.5 rounded-lg border-2 border-primary/30 bg-primary-soft px-2.5 py-1.5 text-[11px] leading-snug flex-1 min-w-0">
                          <ShieldCheck className="size-3 shrink-0 mt-0.5 text-primary" />
                          <span className="text-foreground/80">{step.decisionGate}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </article>
            </div>
          );
        })}
      </div>
    </section>
  );
}

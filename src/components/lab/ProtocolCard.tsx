import { useState } from "react";
import { AlertTriangle, BookOpen, ChevronDown, Clock3, TestTube2 } from "lucide-react";
import type { ProtocolStep } from "@/lib/labApi";

const riskColor = {
  low: "bg-success-soft text-success border-success/30",
  med: "bg-warning-soft text-warning border-warning/30",
  high: "bg-danger-soft text-danger border-danger/30",
};

export function ProtocolCard({ steps }: { steps: ProtocolStep[] }) {
  const [open, setOpen] = useState<string | null>(steps[0]?.id ?? null);

  return (
    <section className="rounded-2xl bg-panel border border-border shadow-sm overflow-hidden">
      <header className="flex flex-col gap-2 border-b border-border p-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h3 className="text-base font-semibold">Experimental Protocol</h3>
          <p className="text-xs text-muted-foreground">
            Short operational steps with visible risks, checks, and go / no-go criteria
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <TestTube2 className="size-3.5 text-primary" />
          {steps.length} steps
        </div>
      </header>

      <div className="grid gap-3 p-4">
        {steps.map((step, index) => {
          const isOpen = open === step.id;
          return (
            <article key={step.id} className="rounded-2xl border border-border bg-muted/20">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : step.id)}
                className="flex w-full items-start gap-4 p-4 text-left"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold">{step.title}</h4>
                    {step.riskLevel && (
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${riskColor[step.riskLevel]}`}>
                        {step.riskLevel.toUpperCase()} risk
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded-full bg-panel px-2 py-1 font-mono">{step.quantity}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-panel px-2 py-1">
                      <Clock3 className="size-3" />
                      {step.duration}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-panel px-2 py-1">
                      <BookOpen className="size-3" />
                      {step.source}
                    </span>
                  </div>
                </div>
                <ChevronDown className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>

              {isOpen && (
                <div className="border-t border-border bg-panel px-4 py-4">
                  <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
                    <div className="space-y-3">
                      <div>
                        <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">What to do</div>
                        <p className="text-sm leading-relaxed text-foreground/85">{step.detail}</p>
                      </div>
                      {step.validationChecks.length > 0 && (
                        <div className="rounded-xl border border-border bg-muted/25 p-3">
                          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Validation checks</div>
                          <ul className="space-y-1.5">
                            {step.validationChecks.map((check) => (
                              <li key={check} className="text-xs leading-relaxed text-foreground/80">
                                {check}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      {step.riskLevel && step.riskNote && (
                        <div className={`rounded-xl border p-3 text-xs leading-relaxed ${riskColor[step.riskLevel]}`}>
                          <div className="mb-1 flex items-center gap-1 font-medium">
                            <AlertTriangle className="size-3.5" />
                            Operational risk
                          </div>
                          {step.riskNote}
                        </div>
                      )}
                      {step.decisionGate && (
                        <div className="rounded-xl border border-primary/30 bg-primary-soft p-3 text-xs leading-relaxed text-primary">
                          <div className="mb-1 font-medium">Go / no-go gate</div>
                          {step.decisionGate}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

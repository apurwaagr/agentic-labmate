import { useState } from "react";
import { AlertTriangle, BookOpen, ChevronDown, Sparkles } from "lucide-react";
import type { ProtocolStep } from "@/lib/labApi";

const riskColor = {
  low: "bg-success-soft text-success border-success/30",
  med: "bg-warning-soft text-warning border-warning/30",
  high: "bg-danger-soft text-danger border-danger/30",
};

export function ProtocolCard({ steps }: { steps: ProtocolStep[] }) {
  const [open, setOpen] = useState<string | null>(steps[0]?.id ?? null);

  return (
    <section className="rounded-xl bg-panel border border-border shadow-sm">
      <header className="flex items-center justify-between p-5 border-b border-border">
        <div>
          <h3 className="text-base font-semibold">Experiment Protocol</h3>
          <p className="text-xs text-muted-foreground">
            {steps.length} steps with grounded sources, validation checks, and decision gates
          </p>
        </div>
        <button className="text-xs text-primary hover:underline flex items-center gap-1">
          <Sparkles className="size-3.5" /> Regeneration-ready
        </button>
      </header>
      <ol className="divide-y divide-border">
        {steps.map((step, index) => {
          const isOpen = open === step.id;
          return (
            <li key={step.id} className="px-5 py-3">
              <div className="flex items-start gap-3 cursor-pointer" onClick={() => setOpen(isOpen ? null : step.id)}>
                <div className="size-7 rounded-md bg-primary-soft text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                  {index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{step.title}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                      {step.quantity}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {step.duration}
                    </span>
                    {step.riskLevel && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${riskColor[step.riskLevel]}`}
                      >
                        <AlertTriangle className="size-2.5" /> {step.riskLevel.toUpperCase()}
                      </span>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-primary/30 text-primary flex items-center gap-1">
                      <BookOpen className="size-2.5" /> {step.source}
                    </span>
                  </div>
                </div>
                <ChevronDown
                  className={`size-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </div>
              {isOpen && (
                <div className="ml-10 mt-2 space-y-3">
                  <p className="text-xs text-foreground/80 leading-relaxed">{step.detail}</p>
                  {step.riskLevel && step.riskNote && (
                    <div className={`text-xs rounded-md border px-2.5 py-1.5 ${riskColor[step.riskLevel]}`}>
                      <strong>Operational risk:</strong> {step.riskNote}
                    </div>
                  )}
                  {step.validationChecks.length > 0 && (
                    <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                        Validation checks
                      </div>
                      <ul className="space-y-1">
                        {step.validationChecks.map((check) => (
                          <li key={check} className="text-xs text-foreground/80">
                            {check}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {step.decisionGate && (
                    <div className="rounded-md border border-primary/30 bg-primary-soft px-3 py-2 text-xs text-primary">
                      <strong>Go / no-go:</strong> {step.decisionGate}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

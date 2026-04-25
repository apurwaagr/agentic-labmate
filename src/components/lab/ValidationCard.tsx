import { ShieldCheck, XCircle } from "lucide-react";
import type { ValidationPlan } from "@/lib/labApi";

export function ValidationCard({ validation }: { validation: ValidationPlan }) {
  return (
    <section className="rounded-xl bg-panel border border-border shadow-sm p-5">
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <h3 className="text-base font-semibold">Validation and Go / No-Go Gates</h3>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Primary metric</div>
          <div className="text-sm font-medium">{validation.primaryMetric}</div>
          <div className="text-xs text-muted-foreground mt-3">{validation.successCriteria}</div>
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Decision gates</div>
          <ul className="space-y-2">
            {validation.decisionGates.map((gate) => (
              <li key={gate} className="text-xs text-foreground/85">
                {gate}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-danger/20 bg-danger-soft/30 p-4">
        <div className="flex items-center gap-2 text-danger text-sm font-medium mb-2">
          <XCircle className="size-4" />
          Failure criteria
        </div>
        <ul className="space-y-2">
          {validation.failureCriteria.map((item) => (
            <li key={item} className="text-xs text-foreground/85">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

import { useState } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, ChevronDown, Clock3, ExternalLink, FlaskConical, ShieldCheck, TestTube2, XCircle } from "lucide-react";
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

type StepStatus = "not-started" | "in-progress" | "blocked" | "done";

const statusLabel: Record<StepStatus, string> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  blocked: "Blocked",
  done: "Done",
};

const statusCls: Record<StepStatus, string> = {
  "not-started": "border-border bg-panel text-muted-foreground",
  "in-progress": "border-primary/30 bg-primary-soft text-primary",
  blocked: "border-danger/30 bg-danger-soft text-danger",
  done: "border-success/30 bg-success-soft text-success",
};

function toPointers(text?: string, max = 3) {
  if (!text) return [];
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const parts = cleaned
    .split(/[.;](?:\s+|$)|\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, max);
  return parts.length ? parts : [cleaned];
}

export function ProtocolCard({ steps, materials = [], planId }: { steps: ProtocolStep[]; materials?: MaterialItem[]; planId: string }) {
  const [open, setOpen] = useState<string | null>(steps[0]?.id ?? null);
  const [stepStatus, setStepStatus] = useState<Record<string, StepStatus>>(() => {
    try {
      return JSON.parse(localStorage.getItem(`agentic-labmate-step-status-${planId}`) || "{}");
    } catch {
      return {};
    }
  });
  const [stepStatusDraft, setStepStatusDraft] = useState<Record<string, StepStatus>>(() => {
    try {
      return JSON.parse(localStorage.getItem(`agentic-labmate-step-status-${planId}`) || "{}");
    } catch {
      return {};
    }
  });
  const [stepLogs, setStepLogs] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(`agentic-labmate-step-logs-${planId}`) || "{}");
    } catch {
      return {};
    }
  });
  const [stepLogDrafts, setStepLogDrafts] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(`agentic-labmate-step-logs-${planId}`) || "{}");
    } catch {
      return {};
    }
  });

  function applyStatus(stepId: string, status: StepStatus) {
    setStepStatus((current) => {
      const next = { ...current, [stepId]: status };
      localStorage.setItem(`agentic-labmate-step-status-${planId}`, JSON.stringify(next));
      return next;
    });
  }

  function applyLog(stepId: string, log: string) {
    setStepLogs((current) => {
      const next = { ...current, [stepId]: log };
      localStorage.setItem(`agentic-labmate-step-logs-${planId}`, JSON.stringify(next));
      return next;
    });
  }

  const highRiskCount = steps.filter((s) => s.riskLevel === "high").length;
  const gateCount = steps.filter((s) => s.decisionGate).length;
  const doneCount = steps.filter((step) => (stepStatus[step.id] || "not-started") === "done").length;
  const inProgressCount = steps.filter((step) => (stepStatus[step.id] || "not-started") === "in-progress").length;

  return (
    <section className="rounded-2xl bg-panel border border-border shadow-sm overflow-hidden">
      {/* Header */}
      <header className="border-b border-border bg-gradient-to-r from-primary-soft/80 to-panel p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl border border-primary/20 bg-primary-soft text-foreground shadow-sm">
              <TestTube2 className="size-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold leading-tight text-foreground">Experimental Portal</h3>
              <p className="text-xs text-foreground/70 mt-0.5">
                Concise execution checklist with gates and risk controls
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
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary-soft px-2.5 py-1 text-primary">
              {doneCount}/{steps.length} done
            </span>
            {inProgressCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent-soft px-2.5 py-1 text-accent">
                {inProgressCount} in progress
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="p-4 space-y-3 bg-surface/30">
        {/* Materials strip */}
        {materials.length > 0 && (
          <div className="rounded-xl border border-border bg-panel p-4 shadow-[inset_0_1px_0_hsl(var(--background))]">
            <div className="mb-2.5 flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/70">Required materials ({materials.length})</span>
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
          const status = stepStatus[step.id] || "not-started";
          const statusDraft = stepStatusDraft[step.id] || status;
          const noteDraft = stepLogDrafts[step.id] ?? stepLogs[step.id] ?? "";
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
                      ? "border-primary bg-primary-soft text-foreground"
                      : "border-primary/30 bg-panel text-foreground"
                  }`}
                >
                  {index + 1}
                </div>
              </div>

              {/* Step card */}
              <article className={`flex-1 min-w-0 rounded-2xl border overflow-hidden transition-colors ${isOpen ? "border-primary/30 bg-panel shadow-sm" : "border-border bg-panel"}`}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : step.id)}
                  className="flex w-full items-start gap-3 p-3.5 text-left hover:bg-surface/60 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold leading-snug text-foreground">{step.title}</h4>
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
                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-foreground/70">
                      <span className="rounded-full bg-panel border border-border px-2 py-0.5 font-mono">{step.quantity}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-panel border border-border px-2 py-0.5">
                        <Clock3 className="size-2.5" />
                        {step.duration}
                      </span>
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${statusCls[status]}`}>
                        {statusLabel[status]}
                      </span>
                      {step.sourceTitle ? (
                        <a
                          href={step.sourceUri || "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-full bg-panel border border-primary/20 px-2 py-0.5 text-primary hover:bg-primary-soft transition-colors"
                          title={step.sourceTitle}
                        >
                          <BookOpen className="size-2.5" />
                          <span className="max-w-[160px] truncate">{step.sourceTitle}</span>
                          <ExternalLink className="size-2.5 opacity-60" />
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-panel border border-border px-2 py-0.5">
                          <BookOpen className="size-2.5" />
                          {step.source}
                        </span>
                      )}
                      {typeof step.sourceConfidence === "number" && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary-soft px-2 py-0.5 text-[10px] text-primary">
                          Evidence {Math.round(step.sourceConfidence * 100)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronDown className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
                </button>

                {isOpen && (
                  <div className="border-t border-border bg-surface/35 px-4 py-3 space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-[11px] text-foreground/70">Step status</label>
                      <select
                        value={statusDraft}
                        onChange={(event) => setStepStatusDraft((current) => ({ ...current, [step.id]: event.target.value as StepStatus }))}
                        className={`rounded-md border px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-primary/25 ${statusCls[statusDraft]}`}
                      >
                        <option value="not-started">Not started</option>
                        <option value="in-progress">In progress</option>
                        <option value="blocked">Blocked</option>
                        <option value="done">Done</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => applyStatus(step.id, statusDraft)}
                        className="rounded-md border border-primary/30 bg-primary-soft px-2 py-1 text-[11px] font-medium text-foreground hover:bg-primary-soft/80 transition-colors"
                      >
                        Update status
                      </button>
                    </div>

                    <div className="rounded-lg border border-border bg-panel p-2.5">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/65">Action pointers</div>
                      <ul className="space-y-1">
                        {toPointers(step.detail, 4).map((point) => (
                          <li key={point} className="text-[11px] leading-snug text-foreground/80">• {point}</li>
                        ))}
                      </ul>
                    </div>

                    {step.stepMaterials && step.stepMaterials.length > 0 && (
                      <div className="rounded-lg border border-border bg-panel p-2.5">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/65">Materials</div>
                        <div className="flex flex-wrap gap-1.5">
                          {step.stepMaterials.map((item) => (
                            <span key={item} className="inline-flex items-center rounded-full border border-border bg-panel px-2 py-0.5 text-[10px] text-foreground/80">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {step.safetyConstraints && step.safetyConstraints.length > 0 && (
                      <div className="rounded-lg border border-warning/30 bg-warning-soft/50 p-2.5">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-warning">Safety constraints</div>
                        <ul className="space-y-1">
                          {step.safetyConstraints.map((constraint) => (
                            <li key={constraint} className="text-[11px] text-foreground/75 leading-snug">• {constraint}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {step.rationale && (
                      <div className="rounded-lg border border-primary/20 bg-primary-soft/35 px-2.5 py-2">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/70">Why this step</div>
                        <ul className="space-y-1">
                          {toPointers(step.rationale, 2).map((point) => (
                            <li key={point} className="text-[11px] leading-snug text-foreground/80">• {point}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {step.sourceEvidence && (
                      <div className="rounded-lg border border-primary/20 bg-primary-soft/35 px-2.5 py-2">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/70">Lineage evidence</div>
                        <p className="text-[11px] leading-snug text-foreground/80">{step.sourceEvidence}</p>
                      </div>
                    )}

                    {/* Validation checks */}
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

                    {/* Literature citation for this step */}
                    {(step.sourceTitle || step.sourceUri) && (
                      <div className="flex items-start gap-1.5 rounded-lg border border-border bg-panel px-2.5 py-2 text-[11px]">
                        <BookOpen className="size-3 shrink-0 mt-0.5 text-foreground/70" />
                        <div className="flex-1 min-w-0">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground/60 mr-1.5">Reference</span>
                          {step.sourceUri ? (
                            <a href={step.sourceUri} target="_blank" rel="noreferrer" className="text-foreground hover:underline inline-flex items-center gap-1">
                              <span className="line-clamp-1">{step.sourceTitle || step.source}</span>
                              <ExternalLink className="size-2.5 shrink-0 opacity-60" />
                            </a>
                          ) : (
                            <span className="text-foreground/70">{step.sourceTitle || step.source}</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Risk + gate inline */}
                    <div className="flex flex-wrap gap-2">
                      {step.riskLevel && step.riskNote && (
                        <div className={`flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug flex-1 min-w-0 ${riskColor[step.riskLevel]}`}>
                          <span className="shrink-0 mt-0.5">{riskIcon[step.riskLevel]}</span>
                          <span className="line-clamp-2">{step.riskNote}</span>
                        </div>
                      )}
                      {step.decisionGate && (
                        <div className="flex items-start gap-1.5 rounded-lg border-2 border-primary/30 bg-primary-soft/45 px-2.5 py-1.5 text-[11px] leading-snug flex-1 min-w-0">
                          <ShieldCheck className="size-3 shrink-0 mt-0.5 text-foreground" />
                          <span className="text-foreground/80 line-clamp-2">{step.decisionGate}</span>
                        </div>
                      )}
                    </div>

                    <div className="rounded-lg border border-border bg-panel p-2.5">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/65">Progress log</div>
                      <textarea
                        value={noteDraft}
                        onChange={(event) => setStepLogDrafts((current) => ({ ...current, [step.id]: event.target.value }))}
                        rows={2}
                        placeholder="Scientist notes while executing this step..."
                        className="w-full rounded-md border border-border bg-panel px-2 py-1.5 text-[11px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/25 resize-none"
                      />
                      <div className="mt-1.5 flex items-center justify-end">
                        <button
                          type="button"
                          onClick={() => applyLog(step.id, noteDraft)}
                          className="rounded-md border border-primary/30 bg-primary-soft px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-primary-soft/80 transition-colors"
                        >
                          Save note
                        </button>
                      </div>
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

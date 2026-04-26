import { useState, useEffect } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, ChevronDown, DollarSign, ExternalLink, Info, MessageSquareWarning, Send, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import {
  budgetRegions,
  adjustedBudgetAmount,
  createReview,
  formatCurrency,
  scientistGapsForPlan,
  type BudgetRegion,
  type ExperimentPlan,
  type ReviewRecord,
} from "@/lib/labApi";
function referenceHref(source: string, uri?: string) {
  if (uri) {
    return uri;
  }

  const label = source.toLowerCase();
  if (label.includes("protocols.io")) {
    return "https://www.protocols.io/";
  }
  if (label.includes("bio-protocol")) return "https://bio-protocol.org/";
  if (label.includes("thermofisher")) return "https://www.thermofisher.com/";
  if (label.includes("sigma")) return "https://www.sigmaaldrich.com/";
  if (label.includes("atcc")) return "https://www.atcc.org/";
  if (label.includes("jove")) return "https://www.jove.com/";
  if (label.includes("nature")) return "https://www.nature.com/nprot/";
  return `https://${source}`;
}

export function ContextStore({
  plan,
  reviews,
  onReviewAdded,
  budgetRegion,
  onBudgetRegionChange,
}: {
  plan: ExperimentPlan;
  reviews: ReviewRecord[];
  onReviewAdded: () => Promise<void>;
  budgetRegion: BudgetRegion;
  onBudgetRegionChange: (code: string) => void;
}) {
  const [reviewer, setReviewer] = useState("Scientist");
  const [section, setSection] = useState("General");
  const [correction, setCorrection] = useState("");
  const [saving, setSaving] = useState(false);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);

  async function submitReview() {
    const trimmed = correction.trim();
    if (!trimmed || saving) {
      return;
    }

    setSaving(true);
    try {
      await createReview({
        experimentId: plan.id,
        reviewer,
        section,
        correction: trimmed,
        severity: "medium",
        domain: plan.domain,
        hypothesis: plan.hypothesis,
        tags: [plan.domain, section].filter(Boolean),
      });
      setCorrection("");
      await onReviewAdded();
    } finally {
      setSaving(false);
    }
  }

  const scientistGaps = scientistGapsForPlan(plan);

  return (
    <aside className="w-full xl:w-[360px] shrink-0 flex flex-col gap-3 p-3 border-l border-border bg-surface overflow-y-auto h-full">

      {/* Literature & Novelty — enhanced */}
      <div className="rounded-2xl bg-panel border border-border shadow-sm overflow-hidden">
        {/* Signal header */}
        {(() => {
          const sig = plan.novelty.signal;
          const isExact = sig === "exact match found";
          const isSimilar = sig === "similar work exists";
          const headerCls = isExact
            ? "bg-danger-soft/60 border-b border-danger/20"
            : isSimilar
            ? "bg-warning-soft/60 border-b border-warning/20"
            : "bg-success-soft/60 border-b border-success/20";
          const icon = isExact ? <XCircle className="size-4 text-danger" /> : isSimilar ? <AlertTriangle className="size-4 text-warning" /> : <Sparkles className="size-4 text-success" />;
          const badge = isExact
            ? "border-danger/30 bg-danger-soft text-danger"
            : isSimilar
            ? "border-warning/30 bg-warning-soft text-warning"
            : "border-success/30 bg-success-soft text-success";
          const score = isExact ? 92 : isSimilar ? 54 : 18;
          const advice = isExact
            ? "Strong precedent found — adapt the protocol rather than treating this as greenfield. Differentiate on method, scale, or system."
            : isSimilar
            ? "Related work exists — confirm your intervention-outcome pair is novel. Review the references below before finalising the design."
            : "Weak or no precedent — this may be genuinely novel, or retrieval coverage was low. Validate with a manual literature search.";
          return (
            <>
              <div className={`flex items-center gap-2.5 px-3.5 py-3 ${headerCls}`}>
                {icon}
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-0.5">Novelty Signal</div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${badge}`}>{sig}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${isExact ? "bg-danger" : isSimilar ? "bg-warning" : "bg-success"}`}
                        style={{ width: `${score}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{score}%</span>
                  </div>
                </div>
              </div>
              <div className="px-3.5 pt-2.5 pb-1">
                <div className="flex items-start gap-1.5 rounded-lg border border-border bg-muted/25 px-2.5 py-1.5 text-[11px] text-foreground/80 leading-snug mb-2.5">
                  <Info className="size-3 shrink-0 mt-0.5 text-primary" />
                  {advice}
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed mb-2.5">{plan.novelty.summary}</p>
              </div>
            </>
          );
        })()}

        {/* References — title + source + link */}
        {plan.novelty.references.length > 0 && (
          <div className="border-t border-border px-3.5 pt-2.5 pb-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <BookOpen className="size-3 text-primary" />
              Retrieved references ({plan.novelty.references.length})
            </div>
            <div className="space-y-1.5">
              {plan.novelty.references.map((reference, i) => (
                <a
                  key={reference.source + i}
                  href={referenceHref(reference.source, reference.uri)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 rounded-lg border border-border bg-muted/25 px-2.5 py-2 hover:border-primary/30 hover:bg-primary-soft/20 transition-colors group"
                >
                  <CheckCircle2 className="size-3 shrink-0 mt-0.5 text-primary/50 group-hover:text-primary transition-colors" />
                  <div className="flex-1 min-w-0">
                    {reference.title && (
                      <div className="text-[11px] font-medium text-foreground/85 line-clamp-2 group-hover:text-primary transition-colors leading-snug">
                        {reference.title}
                      </div>
                    )}
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <ExternalLink className="size-2.5 shrink-0" />
                      <span className="truncate">{reference.source}</span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Source chip row (quick links) */}
        {plan.sources && plan.sources.length > 0 && (
          <div className="border-t border-border px-3.5 pt-2 pb-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">All plan sources</div>
            <div className="flex flex-wrap gap-1">
              {plan.sources.map((source) => (
                <a
                  key={source.source}
                  href={referenceHref(source.source, source.uri)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
                  title={source.title}
                >
                  <ExternalLink className="size-2.5" />
                  {source.source}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Operational Budget — collapsible */}
      <div className="rounded-2xl bg-panel border border-border shadow-sm overflow-hidden">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3.5 py-3 hover:bg-muted/20 transition-colors"
          onClick={() => setBudgetOpen((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <DollarSign className="size-3.5 text-primary" />
            <h3 className="text-sm font-semibold">Operational Budget</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-primary">{formatCurrency(adjustedBudgetAmount(plan.budget.totalUsd, budgetRegion, "total"), budgetRegion)}</span>
            <ChevronDown className={`size-3.5 text-muted-foreground transition-transform duration-200 ${budgetOpen ? "rotate-180" : ""}`} />
          </div>
        </button>

        {budgetOpen && (
          <div className="border-t border-border px-3.5 pb-3.5 pt-3 space-y-3">
            {/* Region selector */}
            <select
              value={budgetRegion.code}
              onChange={(event) => onBudgetRegionChange(event.target.value)}
              className="w-full rounded-lg border border-border bg-muted/20 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {budgetRegions.map((region) => (
                <option key={region.code} value={region.code}>
                  {region.label} · {region.currency}
                </option>
              ))}
            </select>

            {/* 3 headline numbers */}
            <div className="grid grid-cols-3 gap-1.5 text-center text-[11px]">
              <div className="rounded-lg bg-muted/60 p-2">
                <div className="text-sm font-bold">{formatCurrency(adjustedBudgetAmount(plan.budget.reagentsUsd, budgetRegion, "reagents"), budgetRegion)}</div>
                <div className="text-muted-foreground">Reagents</div>
              </div>
              <div className="rounded-lg bg-muted/60 p-2">
                <div className="text-sm font-bold">{formatCurrency(adjustedBudgetAmount(plan.budget.equipmentUsd, budgetRegion, "equipment"), budgetRegion)}</div>
                <div className="text-muted-foreground">Equipment</div>
              </div>
              <div className="rounded-lg bg-success-soft p-2">
                <div className="text-sm font-bold text-success">{formatCurrency(adjustedBudgetAmount(plan.budget.savedUsd, budgetRegion, "total"), budgetRegion)}</div>
                <div className="text-success/70">Headroom</div>
              </div>
            </div>

            {/* Line items */}
            <div className="space-y-1">
              {(plan.budget.lineItems || []).map((item) => (
                <div key={`${item.category}-${item.label}`} className="flex items-center justify-between rounded-lg border border-border bg-panel px-2.5 py-1.5 text-[11px]">
                  <span className="text-foreground/85">{item.label}</span>
                  <span className="font-semibold text-foreground ml-2 shrink-0">{formatCurrency(adjustedBudgetAmount(item.amountUsd, budgetRegion, item.category), budgetRegion)}</span>
                </div>
              ))}
            </div>

            {/* Shipping + Labor */}
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <div className="rounded-lg border border-border bg-muted/25 p-2">
                <div className="text-muted-foreground">Shipping</div>
                <div className="mt-0.5 font-semibold">{formatCurrency(adjustedBudgetAmount(plan.budget.shippingUsd || 0, budgetRegion, "shipping"), budgetRegion)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/25 p-2">
                <div className="text-muted-foreground">Labor</div>
                <div className="mt-0.5 font-semibold">{formatCurrency(adjustedBudgetAmount(plan.budget.laborUsd || 0, budgetRegion, "labor"), budgetRegion)}</div>
              </div>
            </div>

            {/* Assumptions accordion */}
            <div className="rounded-lg border border-primary/20 bg-primary-soft/50 p-2.5 text-[11px]">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left"
                onClick={() => setAssumptionsOpen((v) => !v)}
              >
                <div className="flex items-center gap-1.5 font-semibold text-primary">
                  <Info className="size-3 shrink-0" />
                  Pricing assumptions
                </div>
                <ChevronDown className={`size-3 shrink-0 text-primary transition-transform duration-200 ${assumptionsOpen ? "rotate-180" : ""}`} />
              </button>
              {assumptionsOpen && (
                <div className="mt-2 space-y-1 border-t border-primary/20 pt-2">
                  {plan.budget.assumptions?.map((assumption, i) => (
                    <div key={assumption} className="flex items-start gap-1.5 text-[10px] text-muted-foreground leading-relaxed">
                      <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[8px] font-bold text-primary mt-0.5">{i + 1}</span>
                      {assumption}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Scientist Sanity Check */}
      <div className="rounded-2xl bg-panel border border-border p-3.5 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-3.5 text-primary" />
            <h3 className="text-sm font-semibold">Sanity Check</h3>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-warning-soft text-warning border border-warning/30">Review</span>
        </div>
        <ul className="space-y-1">
          {scientistGaps.map((gap) => (
            <li key={gap} className="flex items-start gap-1.5 rounded-lg border border-border bg-muted/25 px-2.5 py-1.5 text-[10px] text-foreground/80 leading-snug">
              <span className="shrink-0 text-warning font-bold mt-0.5">›</span>
              <span className="line-clamp-2">{gap}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Plan Improvements */}
      <div className="rounded-2xl bg-panel border border-border p-3.5 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-3.5 text-accent" />
            <h3 className="text-sm font-semibold">Plan Improvements</h3>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-soft text-accent-foreground border border-accent/30">
            {plan.reviewAdaptations.length} applied
          </span>
        </div>
        <ul className="space-y-1.5">
          {plan.reviewAdaptations.length > 0 ? (
            plan.reviewAdaptations.map((adaptation) => (
              <li key={`${adaptation.section}-${adaptation.change}`} className="rounded-lg border border-border bg-muted/25 px-2.5 py-2 text-[11px]">
                <div className="font-semibold text-foreground/90">{adaptation.section}</div>
                <div className="text-foreground/75 leading-snug mt-0.5">{adaptation.change}</div>
                {adaptation.impact && <div className="text-[10px] text-muted-foreground mt-0.5">{adaptation.impact}</div>}
              </li>
            ))
          ) : (
            <li className="text-[11px] text-muted-foreground rounded-lg border border-dashed border-border px-2.5 py-2">
              Add a scientist review and regenerate to see improvements.
            </li>
          )}
        </ul>
      </div>

      {/* Scientist Review */}
      <div className="rounded-2xl bg-panel border border-border p-3.5 flex-1 flex flex-col shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <MessageSquareWarning className="size-3.5 text-accent" />
            <h3 className="text-sm font-semibold">Scientist Review</h3>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-soft text-accent-foreground border border-accent/30">{reviews.length} notes</span>
        </div>
        <ul className="space-y-1.5 flex-1 overflow-y-auto max-h-40">
          {reviews.map((review) => (
            <li key={`${review.reviewer}-${review.section}-${review.correction}`} className="rounded-lg border border-border bg-muted/25 px-2.5 py-2 text-[11px]">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="flex size-4 items-center justify-center rounded-full bg-primary-soft text-primary text-[9px] font-bold">
                  {review.reviewer.charAt(0)}
                </span>
                <span className="font-medium">{review.reviewer}</span>
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-primary-soft text-primary">{review.section}</span>
              </div>
              <p className="text-foreground/80 leading-snug">{review.correction}</p>
            </li>
          ))}
        </ul>
        <div className="mt-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <input
              value={reviewer}
              onChange={(event) => setReviewer(event.target.value)}
              placeholder="Reviewer"
              className="text-xs px-2.5 py-1.5 rounded-lg border border-border bg-panel focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <input
              value={section}
              onChange={(event) => setSection(event.target.value)}
              placeholder="Section"
              className="text-xs px-2.5 py-1.5 rounded-lg border border-border bg-panel focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <input
              value={correction}
              onChange={(event) => setCorrection(event.target.value)}
              placeholder="Add a correction to improve the next plan…"
              className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-border bg-panel focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              type="button"
              onClick={() => void submitReview()}
              disabled={saving || correction.trim().length === 0}
              className="size-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-60"
            >
              <Send className="size-3" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

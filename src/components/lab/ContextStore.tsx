import { useState, useEffect } from "react";
import { BookOpen, DollarSign, ExternalLink, MessageSquareWarning, Send, ShieldCheck } from "lucide-react";
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
import { MoleculeCard } from "@/components/lab/MoleculeCard";

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
      });
      setCorrection("");
      await onReviewAdded();
    } finally {
      setSaving(false);
    }
  }

  const scientistGaps = scientistGapsForPlan(plan);

  return (
    <aside className="w-[390px] shrink-0 flex flex-col gap-4 p-4 border-l border-border bg-surface overflow-y-auto">
      <div className="rounded-2xl bg-panel border border-border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Literature and Novelty</h3>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-success-soft text-success border border-success/30">
            Grounded
          </span>
        </div>
        <div className="mb-2 text-xs font-medium text-foreground">{plan.novelty.signal}</div>
        <p className="text-xs text-muted-foreground leading-relaxed mb-4">{plan.novelty.summary}</p>
        <ul>
          {plan.novelty.references.map((reference) => (
            <li key={reference.source}>
              <a href={referenceHref(reference.source, reference.uri)} target="_blank" rel="noopener noreferrer">
                {reference.source}
              </a>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl bg-panel border border-border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <DollarSign className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Operational Budget</h3>
          </div>
          <span className="text-xs font-semibold text-primary">{formatCurrency(adjustedBudgetAmount(plan.budget.totalUsd, budgetRegion, "total"), budgetRegion)}</span>
        </div>
        <div className="mb-3 rounded-xl border border-border bg-muted/20 p-3">
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Operating region</div>
          <select
            value={budgetRegion.code}
            onChange={(event) => onBudgetRegionChange(event.target.value)}
            className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {budgetRegions.map((region) => (
              <option key={region.code} value={region.code}>
                {region.label} · {region.currency}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-3 grid grid-cols-3 gap-2 text-center text-[11px]">
          <div className="rounded-xl bg-muted/60 p-3">
            <div className="text-base font-semibold">{formatCurrency(adjustedBudgetAmount(plan.budget.reagentsUsd, budgetRegion, "reagents"), budgetRegion)}</div>
            <div className="text-muted-foreground">Reagents</div>
          </div>
          <div className="rounded-xl bg-muted/60 p-3">
            <div className="text-base font-semibold">{formatCurrency(adjustedBudgetAmount(plan.budget.equipmentUsd, budgetRegion, "equipment"), budgetRegion)}</div>
            <div className="text-muted-foreground">Equipment</div>
          </div>
          <div className="rounded-xl bg-muted/60 p-3">
            <div className="text-base font-semibold">{formatCurrency(adjustedBudgetAmount(plan.budget.savedUsd, budgetRegion, "total"), budgetRegion)}</div>
            <div className="text-success">Headroom</div>
          </div>
        </div>
        <div className="mb-3 space-y-2">
          {(plan.budget.lineItems || []).map((item) => (
            <div key={`${item.category}-${item.label}`} className="flex items-center justify-between rounded-xl border border-border bg-panel px-3 py-2 text-xs">
              <div>
                <div className="font-medium text-foreground">{item.label}</div>
                {item.note && <div className="text-[11px] text-muted-foreground">{item.note}</div>}
              </div>
              <div className="font-semibold text-foreground">{formatCurrency(adjustedBudgetAmount(item.amountUsd, budgetRegion, item.category), budgetRegion)}</div>
            </div>
          ))}
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-xl border border-border bg-muted/25 p-3">
            <div className="text-muted-foreground">Procurement and shipping</div>
            <div className="mt-1 text-sm font-semibold">{formatCurrency(adjustedBudgetAmount(plan.budget.shippingUsd || 0, budgetRegion, "shipping"), budgetRegion)}</div>
          </div>
          <div className="rounded-xl border border-border bg-muted/25 p-3">
            <div className="text-muted-foreground">Scientist labor</div>
            <div className="mt-1 text-sm font-semibold">{formatCurrency(adjustedBudgetAmount(plan.budget.laborUsd || 0, budgetRegion, "labor"), budgetRegion)}</div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-primary-soft/60 p-3 text-xs text-foreground/85">
          <div className="mb-1 flex items-center gap-2 font-medium text-primary">
            <ShieldCheck className="size-3.5" />
            Reliability and assumptions
          </div>
          <p className="text-muted-foreground leading-relaxed">{plan.budget.reliability || "Planning-grade estimate with operational overhead included."}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Display values are adjusted for the selected operating region using planning multipliers for procurement, shipping, and scientist labor. They are not a substitute for institution-specific quotes or tax treatment.
          </p>
          {plan.budget.assumptions && plan.budget.assumptions.length > 0 && (
            <ul className="mt-2 space-y-1">
              {plan.budget.assumptions.map((assumption) => (
                <li key={assumption} className="text-[11px] leading-relaxed text-muted-foreground">
                  {assumption}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <MoleculeCard plan={plan} />

      <div className="rounded-2xl bg-panel border border-border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Scientist Sanity Check</h3>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning-soft text-warning border border-warning/30">
            Review needed
          </span>
        </div>
        <ul className="space-y-2">
          {scientistGaps.map((gap) => (
            <li key={gap} className="rounded-xl border border-border bg-muted/25 p-3 text-xs leading-relaxed text-foreground/85">
              {gap}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl bg-panel border border-border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-accent" />
            <h3 className="text-sm font-semibold">Plan Improvements</h3>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-soft border border-accent/30 text-accent-foreground">
            Regenerated
          </span>
        </div>
        <ul className="space-y-2">
          {plan.reviewAdaptations.length > 0 ? (
            plan.reviewAdaptations.map((adaptation) => (
              <li key={`${adaptation.section}-${adaptation.change}`} className="text-xs p-3 rounded-xl border border-border bg-muted/25">
                <div className="font-medium">{adaptation.section}</div>
                <p className="text-foreground/80 leading-snug mt-1">{adaptation.change}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{adaptation.impact}</p>
              </li>
            ))
          ) : (
            <li className="text-xs text-muted-foreground rounded-xl border border-dashed border-border p-3">
              No learned adaptations yet. Add a scientist review and regenerate the plan.
            </li>
          )}
        </ul>
      </div>

      <div className="rounded-2xl bg-panel border border-border p-4 flex-1 flex flex-col shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <MessageSquareWarning className="size-4 text-accent" />
            <h3 className="text-sm font-semibold">Scientist Review</h3>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-soft border border-accent/30 text-accent-foreground">
            {reviews.length} notes
          </span>
        </div>
        <ul className="space-y-2 flex-1 overflow-y-auto">
          {reviews.map((review) => (
            <li key={`${review.reviewer}-${review.section}-${review.correction}`} className="text-xs p-3 rounded-xl border border-border bg-muted/25">
              <div className="flex items-center gap-2 mb-1">
                <div className="size-5 rounded-full bg-primary-soft text-primary text-[10px] font-semibold flex items-center justify-center">
                  {review.reviewer.charAt(0)}
                </div>
                <span className="font-medium">{review.reviewer}</span>
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-primary-soft text-primary">{review.section}</span>
              </div>
              <p className="text-foreground/80 leading-snug">{review.correction}</p>
            </li>
          ))}
        </ul>
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={reviewer}
              onChange={(event) => setReviewer(event.target.value)}
              placeholder="Reviewer"
              className="text-xs px-2.5 py-2 rounded-xl border border-border bg-panel focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <input
              value={section}
              onChange={(event) => setSection(event.target.value)}
              placeholder="Section"
              className="text-xs px-2.5 py-2 rounded-xl border border-border bg-panel focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              value={correction}
              onChange={(event) => setCorrection(event.target.value)}
              placeholder="Add a scientist correction to improve the next plan..."
              className="flex-1 text-xs px-2.5 py-2 rounded-xl border border-border bg-panel focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              type="button"
              onClick={() => void submitReview()}
              disabled={saving || correction.trim().length === 0}
              className="size-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-60"
            >
              <Send className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

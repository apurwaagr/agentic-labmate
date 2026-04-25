import { useEffect, useState } from "react";
import { BookOpen, DollarSign, MessageSquareWarning, ExternalLink, Send, Network, BrainCircuit } from "lucide-react";
import {
  createReview,
  fetchApiContracts,
  fetchKnowledgeGraphContext,
  type ApiContract,
  type ExperimentPlan,
  type KnowledgeGraphContext,
  type ReviewRecord,
} from "@/lib/labApi";

export function ContextStore({
  plan,
  reviews,
  onReviewAdded,
}: {
  plan: ExperimentPlan;
  reviews: ReviewRecord[];
  onReviewAdded: () => Promise<void>;
}) {
  const [contracts, setContracts] = useState<ApiContract[]>([]);
  const [graphContext, setGraphContext] = useState<KnowledgeGraphContext | null>(null);
  const [reviewer, setReviewer] = useState("Scientist");
  const [section, setSection] = useState("General");
  const [correction, setCorrection] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchApiContracts().then(setContracts).catch(() => setContracts([]));
    fetchKnowledgeGraphContext(plan.hypothesis).then(setGraphContext).catch(() => setGraphContext(null));
  }, [plan.id, plan.hypothesis]);

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

  return (
    <aside className="w-[360px] shrink-0 flex flex-col gap-4 p-4 border-l border-border bg-surface overflow-y-auto">
      <div className="rounded-xl bg-panel border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Novelty Signal</h3>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-success-soft text-success border border-success/30">
            Grounded
          </span>
        </div>
        <div className="text-xs font-medium text-foreground mb-2">{plan.novelty.signal}</div>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">{plan.novelty.summary}</p>
        <ul className="space-y-2.5">
          {plan.novelty.references.map((reference) => (
            <li key={`${reference.title}-${reference.source}`} className="text-xs">
              <a className="font-medium text-foreground hover:text-primary leading-snug flex items-start gap-1">
                {reference.title} <ExternalLink className="size-3 mt-0.5 shrink-0" />
              </a>
              <div className="text-[11px] text-muted-foreground mt-0.5">{reference.source}</div>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl bg-panel border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <DollarSign className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Operational Budget</h3>
          </div>
          <span className="text-xs font-semibold text-primary">
            ${plan.budget.totalUsd} / ${plan.budget.budgetCapUsd}
          </span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden mb-3">
          <div
            className="h-full bg-gradient-to-r from-primary to-accent"
            style={{ width: `${Math.min((plan.budget.totalUsd / plan.budget.budgetCapUsd) * 100, 100)}%` }}
          />
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
          <div className="p-2 rounded-md bg-muted/60">
            <div className="font-semibold text-sm">${plan.budget.reagentsUsd}</div>
            <div className="text-muted-foreground">Reagents</div>
          </div>
          <div className="p-2 rounded-md bg-muted/60">
            <div className="font-semibold text-sm">${plan.budget.equipmentUsd}</div>
            <div className="text-muted-foreground">Equipment</div>
          </div>
          <div className="p-2 rounded-md bg-muted/60">
            <div className="font-semibold text-sm">${plan.budget.savedUsd}</div>
            <div className="text-success">Saved</div>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-panel border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Network className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Knowledge Graph Handoff</h3>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-soft text-primary border border-primary/30">
            API-ready
          </span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
          Graph endpoint exposes domain tags, grounded materials, protocol entities, and review memory for your teammate.
        </p>
        <ul className="space-y-2 text-[11px] mb-3">
          {(contracts.length > 0 ? contracts.slice(4, 7) : []).map((contract) => (
            <li key={contract.path} className="rounded-md border border-border bg-muted/30 px-2.5 py-2">
              <div className="font-mono text-[10px] text-primary">
                {contract.method} {contract.path}
              </div>
              <div className="text-muted-foreground mt-1">{contract.purpose}</div>
            </li>
          ))}
        </ul>
        {graphContext && (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Current graph snapshot</div>
            <div className="text-xs text-foreground/80">
              {graphContext.nodes.length} nodes · {graphContext.edges.length} edges · {graphContext.tags.join(", ")}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-panel border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BrainCircuit className="size-4 text-accent" />
            <h3 className="text-sm font-semibold">Learned Adaptations</h3>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-soft border border-accent/30 text-accent-foreground">
            Regenerated
          </span>
        </div>
        <ul className="space-y-2">
          {plan.reviewAdaptations.length > 0 ? (
            plan.reviewAdaptations.map((adaptation) => (
              <li key={`${adaptation.section}-${adaptation.change}`} className="text-xs p-2.5 rounded-md border border-border bg-muted/30">
                <div className="font-medium">{adaptation.section}</div>
                <p className="text-foreground/80 leading-snug mt-1">{adaptation.change}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{adaptation.impact}</p>
              </li>
            ))
          ) : (
            <li className="text-xs text-muted-foreground">No learned adaptations yet. Add a review below and regenerate the plan.</li>
          )}
        </ul>
      </div>

      <div className="rounded-xl bg-panel border border-border p-4 flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <MessageSquareWarning className="size-4 text-accent" />
            <h3 className="text-sm font-semibold">Scientist Review Loop</h3>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-soft border border-accent/30 text-accent-foreground">
            {reviews.length} reviews
          </span>
        </div>
        <ul className="space-y-2 flex-1 overflow-y-auto">
          {reviews.map((review) => (
            <li key={`${review.reviewer}-${review.section}-${review.correction}`} className="text-xs p-2.5 rounded-md border border-border bg-muted/30">
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
              className="text-xs px-2.5 py-1.5 rounded-md border border-border bg-panel focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <input
              value={section}
              onChange={(event) => setSection(event.target.value)}
              placeholder="Section"
              className="text-xs px-2.5 py-1.5 rounded-md border border-border bg-panel focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              value={correction}
              onChange={(event) => setCorrection(event.target.value)}
              placeholder="Add a correction that should improve the next plan..."
              className="flex-1 text-xs px-2.5 py-1.5 rounded-md border border-border bg-panel focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              type="button"
              onClick={() => void submitReview()}
              disabled={saving || correction.trim().length === 0}
              className="size-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-60"
            >
              <Send className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

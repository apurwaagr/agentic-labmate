import { useEffect, useState } from "react";
import { Leaf, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { Navigator } from "@/components/lab/Navigator";
import { ContextStore } from "@/components/lab/ContextStore";
import { ProtocolCard } from "@/components/lab/ProtocolCard";
import { SupplyChainCard } from "@/components/lab/SupplyChainCard";
import { TimelineCard } from "@/components/lab/TimelineCard";
import { ComparisonCard } from "@/components/lab/ComparisonCard";
import { Chatbot } from "@/components/lab/Chatbot";
import { PhaseTracker } from "@/components/lab/PhaseTracker";
import { ValidationCard } from "@/components/lab/ValidationCard";
import {
  fetchExperimentPlan,
  fetchReviews,
  sampleHypotheses,
  type ExperimentPlan,
  type ReviewRecord,
} from "@/lib/labApi";

const toneMap: Record<string, string> = {
  primary: "bg-primary-soft text-primary border-primary/30",
  accent: "bg-accent-soft text-accent-foreground border-accent/30",
  success: "bg-success-soft text-success border-success/30",
};

const initialHypothesis = sampleHypotheses[0].hypothesis;

function Metric({ label, value, tone, icon }: { label: string; value: string; tone: string; icon: React.ReactNode }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${toneMap[tone]}`}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-80">
        {icon} {label}
      </div>
      <div className="text-lg font-bold leading-tight">{value}</div>
    </div>
  );
}

const Index = () => {
  const [hypothesis, setHypothesis] = useState(initialHypothesis);
  const [plan, setPlan] = useState<ExperimentPlan | null>(null);
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadPlan(nextHypothesis: string) {
    setLoading(true);
    setError(null);

    try {
      const planResponse = await fetchExperimentPlan(nextHypothesis);
      setPlan(planResponse.experiment);
      const reviewResponse = await fetchReviews(planResponse.experiment.id);
      setReviews(reviewResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load experiment plan.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPlan(initialHypothesis);
  }, []);

  async function refreshReviewsAndPlan() {
    if (!plan) {
      return;
    }
    await loadPlan(plan.hypothesis);
  }

  return (
    <div className="min-h-screen bg-background flex">
      <Navigator />

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-panel">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Project · Agentic Labmate
            </div>
            <h1 className="text-xl font-semibold">Protocol Workbench</h1>
          </div>
          <PhaseTracker />
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <section className="rounded-xl border border-border bg-gradient-to-br from-panel to-primary-soft p-6 shadow-sm">
            <div className="flex flex-col gap-5">
              <div className="flex items-start justify-between gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="size-4 text-primary" />
                    <span className="text-[11px] uppercase tracking-wider text-primary font-semibold">
                      Hypothesis Input
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold leading-snug max-w-3xl">
                    {plan?.hypothesis || hypothesis}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
                    {plan
                      ? `${plan.domain} template active · literature QC plus review memory applied before generation.`
                      : "Generate a domain-aware plan with grounded sources, validation gates, and review memory."}
                  </p>
                </div>
                {plan && (
                  <div className="grid grid-cols-3 gap-3 shrink-0">
                    <Metric label="Confidence" value={plan.metrics.confidence} tone="primary" icon={<ShieldCheck className="size-3.5" />} />
                    <Metric label="Novelty" value={plan.metrics.novelty} tone="accent" icon={<Sparkles className="size-3.5" />} />
                    <Metric label="Sustainability" value={plan.metrics.sustainability} tone="success" icon={<Leaf className="size-3.5" />} />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {sampleHypotheses.map((sample) => (
                  <button
                    key={sample.id}
                    type="button"
                    onClick={() => setHypothesis(sample.hypothesis)}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      hypothesis === sample.hypothesis
                        ? "border-primary/30 bg-primary text-primary-foreground"
                        : "border-border bg-panel text-foreground hover:bg-muted"
                    }`}
                  >
                    {sample.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-3">
                <textarea
                  value={hypothesis}
                  onChange={(event) => setHypothesis(event.target.value)}
                  className="min-h-28 rounded-xl border border-border bg-panel px-4 py-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="Describe the scientific hypothesis in natural language..."
                />
                <div className="flex xl:flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => void loadPlan(hypothesis)}
                    disabled={loading}
                    className="rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-60"
                  >
                    {loading ? "Generating..." : "Generate Plan"}
                  </button>
                  {plan && (
                    <button
                      type="button"
                      onClick={() => void loadPlan(plan.hypothesis)}
                      disabled={loading}
                      className="rounded-xl border border-border bg-panel px-4 py-3 text-sm font-medium hover:bg-muted disabled:opacity-60"
                    >
                      Regenerate with Reviews
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          {loading && (
            <section className="rounded-xl border border-border bg-panel p-10 flex items-center justify-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Building a grounded plan with domain template, retrieval, and validation gates...
            </section>
          )}

          {error && (
            <section className="rounded-xl border border-danger/20 bg-danger-soft/30 p-5 text-sm text-danger">
              {error}
            </section>
          )}

          {plan && !loading && (
            <>
              <ProtocolCard steps={plan.steps} />
              <ValidationCard validation={plan.validation} />
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <SupplyChainCard plan={plan} />
                <TimelineCard phases={plan.timeline} />
              </div>
              <ComparisonCard rows={plan.benchmark} />
            </>
          )}
        </div>
      </main>

      {plan && (
        <>
          <ContextStore plan={plan} reviews={reviews} onReviewAdded={refreshReviewsAndPlan} />
          <Chatbot experimentId={plan.id} hypothesis={plan.hypothesis} />
        </>
      )}
    </div>
  );
};

export default Index;

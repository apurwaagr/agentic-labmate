import { useMemo, useState } from "react";
import { ArrowRight, BookOpen, ClipboardCheck, ExternalLink, FlaskConical, Gauge, Sparkles } from "lucide-react";
import type { ExperimentPlan } from "@/lib/labApi";

type ObservationRecord = {
  id: string;
  stage: string;
  type: "visual" | "instrument" | "safety" | "deviation";
  note: string;
  impact: "low" | "medium" | "high";
};

type Recommendation = "proceed" | "iterate" | "hold";

const impactStyle = {
  low: "border-success/25 bg-success-soft text-success",
  medium: "border-warning/25 bg-warning-soft text-warning",
  high: "border-danger/25 bg-danger-soft text-danger",
};

const recommendationCopy: Record<Recommendation, string> = {
  proceed: "Proceed to next phase",
  iterate: "Iterate with parameter refinement",
  hold: "Hold and investigate root cause",
};

function makeObservationId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function isMoleculeMaterial(name: string) {
  return !/(buffer|water|solvent mix|glassware|tube|plate|consumable|pipette)/i.test(name);
}

export function ScientistWorkbenchCard({ plan }: { plan: ExperimentPlan }) {
  const [observations, setObservations] = useState<ObservationRecord[]>([]);
  const [stageDraft, setStageDraft] = useState(plan.steps[0]?.title || "Reaction setup");
  const [typeDraft, setTypeDraft] = useState<ObservationRecord["type"]>("visual");
  const [impactDraft, setImpactDraft] = useState<ObservationRecord["impact"]>("medium");
  const [noteDraft, setNoteDraft] = useState("");
  const [analysisText, setAnalysisText] = useState("");
  const [recommendation, setRecommendation] = useState<Recommendation>("iterate");
  const [recommendationReason, setRecommendationReason] = useState("");

  const chemistryMaterials = useMemo(
    () => plan.materials.filter((item) => isMoleculeMaterial(item.name)).slice(0, 6),
    [plan.materials],
  );

  const observationCounts = useMemo(() => {
    return {
      high: observations.filter((item) => item.impact === "high").length,
      medium: observations.filter((item) => item.impact === "medium").length,
      low: observations.filter((item) => item.impact === "low").length,
    };
  }, [observations]);

  const executionReadiness = useMemo(() => {
    const hasCriticalObservation = observationCounts.high > 0;
    const hasAnalysis = analysisText.trim().length > 24;
    const hasReason = recommendationReason.trim().length > 14;
    if (!hasAnalysis || !hasReason) return "Needs scientist input";
    if (recommendation === "hold" || hasCriticalObservation) return "Risk flagged";
    if (recommendation === "proceed") return "Ready for controlled progression";
    return "Ready for targeted iteration";
  }, [analysisText, recommendation, recommendationReason, observationCounts.high]);

  function addObservation() {
    const note = noteDraft.trim();
    if (!note) return;
    const next: ObservationRecord = {
      id: makeObservationId(),
      stage: stageDraft.trim() || "Unassigned stage",
      type: typeDraft,
      note,
      impact: impactDraft,
    };
    setObservations((current) => [next, ...current]);
    setNoteDraft("");
  }

  return (
    <section className="rounded-2xl border border-border bg-panel shadow-sm overflow-hidden">
      <header className="border-b border-border bg-[linear-gradient(110deg,_hsl(var(--primary-soft))_0%,_transparent_58%)] px-5 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl border border-primary/25 bg-primary-soft text-foreground shadow-sm">
              <ClipboardCheck className="size-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold leading-tight">Scientist Workbench</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Structured observations, analysis, and recommendation loop</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary-soft px-2.5 py-1 text-[11px] text-primary">
            <Gauge className="size-3" />
            {executionReadiness}
          </span>
        </div>
      </header>

      <div className="p-5 space-y-4">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface/35 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/70 flex items-center gap-1.5">
              <FlaskConical className="size-3 text-primary" />Materials intelligence
            </div>
            <ul className="space-y-1.5">
              {chemistryMaterials.map((item) => (
                <li key={`${item.name}-${item.catalogNumber}`} className="rounded-lg border border-border bg-panel px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold text-foreground/90">{item.name}</div>
                      <div className="mt-0.5 text-[10px] text-foreground/70">
                        {item.molecularFormula ? `Formula: ${item.molecularFormula}` : "Formula: pending"}
                        {" | "}
                        {item.molecularWeight ? `MW ${item.molecularWeight.toFixed(2)}` : "MW pending"}
                      </div>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${item.status === "order" ? "border-warning/25 bg-warning-soft text-warning" : item.status === "owned" ? "border-success/25 bg-success-soft text-success" : "border-border bg-panel text-foreground/75"}`}>
                      {item.status}
                    </span>
                  </div>
                  {item.sourceUri && (
                    <a href={item.sourceUri} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                      PubChem data
                      <ExternalLink className="size-2.5" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-surface/35 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/70 flex items-center gap-1.5">
              <Sparkles className="size-3 text-primary" />Reaction setup graphics
            </div>
            <div className="rounded-lg border border-border bg-panel p-3">
              <div className="flex items-center justify-between text-[10px] text-foreground/75">
                <span>{plan.materials[0]?.name || "Reagent A"}</span>
                <ArrowRight className="size-3 text-primary" />
                <span>{plan.targetCompound?.name || "Target output"}</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px]">
                <div className="rounded-md border border-border bg-surface/30 px-2 py-1">Pre-mix</div>
                <div className="rounded-md border border-primary/25 bg-primary-soft px-2 py-1">Reaction</div>
                <div className="rounded-md border border-success/25 bg-success-soft px-2 py-1">Quench / Validate</div>
              </div>
              <div className="mt-2 text-[10px] text-foreground/65 leading-snug">
                Graphic cues stay synchronized with the active plan so scientists can quickly brief setup and transfer points.
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface/35 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/70">Structured observations</div>
          <div className="grid gap-2 sm:grid-cols-4">
            <input
              value={stageDraft}
              onChange={(event) => setStageDraft(event.target.value)}
              className="rounded-md border border-border bg-panel px-2 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-primary/25"
              placeholder="Stage"
            />
            <select
              value={typeDraft}
              onChange={(event) => setTypeDraft(event.target.value as ObservationRecord["type"])}
              className="rounded-md border border-border bg-panel px-2 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-primary/25"
            >
              <option value="visual">Visual</option>
              <option value="instrument">Instrument</option>
              <option value="safety">Safety</option>
              <option value="deviation">Deviation</option>
            </select>
            <select
              value={impactDraft}
              onChange={(event) => setImpactDraft(event.target.value as ObservationRecord["impact"])}
              className="rounded-md border border-border bg-panel px-2 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-primary/25"
            >
              <option value="low">Low impact</option>
              <option value="medium">Medium impact</option>
              <option value="high">High impact</option>
            </select>
            <button
              type="button"
              onClick={addObservation}
              className="rounded-md border border-primary/30 bg-primary-soft px-2 py-1.5 text-[11px] font-medium text-foreground hover:bg-primary-soft/80"
            >
              Add observation
            </button>
          </div>
          <textarea
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            rows={2}
            placeholder="Observation note: what happened, where, and under what condition?"
            className="mt-2 w-full rounded-md border border-border bg-panel px-2 py-1.5 text-[11px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
          {observations.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {observations.map((item) => (
                <li key={item.id} className="rounded-lg border border-border bg-panel px-3 py-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-border bg-surface/50 px-2 py-0.5 text-[10px]">{item.stage}</span>
                    <span className="rounded-full border border-border bg-surface/50 px-2 py-0.5 text-[10px] capitalize">{item.type}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${impactStyle[item.impact]}`}>{item.impact}</span>
                  </div>
                  <div className="mt-1.5 text-foreground/85 leading-snug">{item.note}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface/35 p-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/70">Analysis input</div>
            <textarea
              value={analysisText}
              onChange={(event) => setAnalysisText(event.target.value)}
              rows={4}
              placeholder="Interpret trends, suspected mechanisms, and likely causes of variance."
              className="w-full rounded-md border border-border bg-panel px-2 py-1.5 text-[11px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>

          <div className="rounded-xl border border-border bg-surface/35 p-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/70">Recommendation output</div>
            <select
              value={recommendation}
              onChange={(event) => setRecommendation(event.target.value as Recommendation)}
              className="w-full rounded-md border border-border bg-panel px-2 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-primary/25"
            >
              <option value="proceed">Proceed</option>
              <option value="iterate">Iterate</option>
              <option value="hold">Hold</option>
            </select>
            <textarea
              value={recommendationReason}
              onChange={(event) => setRecommendationReason(event.target.value)}
              rows={3}
              placeholder="Rationale for the recommendation and immediate next action."
              className="mt-2 w-full rounded-md border border-border bg-panel px-2 py-1.5 text-[11px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
            <div className="mt-2 rounded-lg border border-border bg-panel px-3 py-2 text-[11px] text-foreground/80">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <BookOpen className="size-3" /> Recommended path
              </div>
              <div className="mt-1">{recommendationCopy[recommendation]}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
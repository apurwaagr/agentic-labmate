import { useEffect, useMemo, useRef, useState } from "react";
import { Beaker, ChevronRight, Leaf, Loader2, Plus, ShieldCheck, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Navigator, type AgentLogItem, type ProjectListItem } from "@/components/lab/Navigator";
import { ContextStore } from "@/components/lab/ContextStore";
import { ProtocolCard } from "@/components/lab/ProtocolCard";
import { SupplyChainCard } from "@/components/lab/SupplyChainCard";
import { TimelineCard } from "@/components/lab/TimelineCard";
import { ComparisonCard } from "@/components/lab/ComparisonCard";
import { Chatbot } from "@/components/lab/Chatbot";
import { PhaseTracker } from "@/components/lab/PhaseTracker";
import { ValidationCard } from "@/components/lab/ValidationCard";
import {
  budgetRegionByCode,
  fetchExperimentPlan,
  fetchReviews,
  type BudgetRegion,
  type ExperimentPlan,
  type ReviewRecord,
} from "@/lib/labApi";

type LabProject = ProjectListItem & {
  hypothesis: string;
  novelty?: string;
};

const PROJECTS_STORAGE_KEY = "agentic-labmate-projects";
const ACTIVE_PROJECT_STORAGE_KEY = "agentic-labmate-active-project";
const BUDGET_REGION_STORAGE_KEY = "agentic-labmate-budget-region";

const toneMap: Record<string, string> = {
  primary: "bg-primary-soft text-primary border-primary/30",
  accent: "bg-accent-soft text-accent-foreground border-accent/30",
  success: "bg-success-soft text-success border-success/30",
};

function formatProjectTime(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function createLog(id: string, message: string, state: AgentLogItem["state"]): AgentLogItem {
  return {
    id,
    message,
    state,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
}

function buildGenerationLogs(projectName: string): AgentLogItem[] {
  return [
    createLog("parse", `Parsing hypothesis structure for ${projectName}`, "active"),
    createLog("novelty", "Running novelty QC across protocol and literature sources", "pending"),
    createLog("template", "Selecting domain template and matching assay workflow", "pending"),
    createLog("plan", "Assembling operational plan, budget, and critical-path materials", "pending"),
    createLog("validate", "Writing decision gates and validation criteria", "pending"),
  ];
}

function Metric({ label, value, tone, icon }: { label: string; value: string; tone: string; icon: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border px-3 py-3 ${toneMap[tone]}`}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-80">
        {icon} {label}
      </div>
      <div className="mt-1 text-lg font-bold leading-tight">{value}</div>
    </div>
  );
}

const Index = () => {
  const [projects, setProjects] = useState<LabProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [plansByProject, setPlansByProject] = useState<Record<string, ExperimentPlan>>({});
  const [reviewsByProject, setReviewsByProject] = useState<Record<string, ReviewRecord[]>>({});
  const [agentLogs, setAgentLogs] = useState<AgentLogItem[]>([]);
  const [composerOpen, setComposerOpen] = useState(true);
  const [draftName, setDraftName] = useState("");
  const [draftHypothesis, setDraftHypothesis] = useState("");
  const [budgetRegion, setBudgetRegion] = useState<BudgetRegion>(budgetRegionByCode("DE"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const storedProjects = localStorage.getItem(PROJECTS_STORAGE_KEY);
      const storedActiveId = localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);

      if (storedProjects) {
        const parsed = JSON.parse(storedProjects) as LabProject[];
        setProjects(parsed);
        if (parsed.length > 0) {
          setComposerOpen(false);
        }
      }

      if (storedActiveId) {
        setActiveProjectId(storedActiveId);
      }

      const storedBudgetRegion = localStorage.getItem(BUDGET_REGION_STORAGE_KEY);
      if (storedBudgetRegion) {
        setBudgetRegion(budgetRegionByCode(storedBudgetRegion));
      }
    } catch {
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    if (activeProjectId) {
      localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, activeProjectId);
    } else {
      localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
    }
  }, [activeProjectId]);

  useEffect(() => {
    localStorage.setItem(BUDGET_REGION_STORAGE_KEY, budgetRegion.code);
  }, [budgetRegion]);

  useEffect(() => {
    return () => {
      if (logIntervalRef.current) {
        window.clearInterval(logIntervalRef.current);
      }
    };
  }, []);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const activePlan = activeProject ? plansByProject[activeProject.id] : undefined;
  const activeReviews = activeProject ? reviewsByProject[activeProject.id] ?? [] : [];

  useEffect(() => {
    const shouldAutoGenerate =
      activeProject &&
      activeProject.status === "draft" &&
      !plansByProject[activeProject.id] &&
      Boolean(activeProject.hypothesis) &&
      !loading;

    if (shouldAutoGenerate && activeProject) {
      void generateForProject(activeProject.id, activeProject.hypothesis);
    }
    // generateForProject is intentionally excluded to avoid retrigger loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject, plansByProject, loading]);

  function clearLogInterval() {
    if (logIntervalRef.current) {
      window.clearInterval(logIntervalRef.current);
      logIntervalRef.current = null;
    }
  }

  function startLogAnimation(projectName: string) {
    const initialLogs = buildGenerationLogs(projectName);
    setAgentLogs(initialLogs);
    clearLogInterval();

    let index = 0;
    logIntervalRef.current = window.setInterval(() => {
      index += 1;
      setAgentLogs((current) =>
        current.map((log, logIndex) => {
          if (logIndex < index) {
            return { ...log, state: "done" };
          }
          if (logIndex === index) {
            return { ...log, state: "active", time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
          }
          return log;
        }),
      );

      if (index >= initialLogs.length - 1) {
        clearLogInterval();
      }
    }, 1400);
  }

  function finalizeLogs(state: "done" | "error", projectName: string) {
    clearLogInterval();
    setAgentLogs((current) => {
      const updated = current.map((log) => ({
        ...log,
        state: state === "done" ? "done" : log.state === "done" ? "done" : "error",
      }));

      updated.push(
        createLog(
          `${state}-${Date.now()}`,
          state === "done"
            ? `Plan ready for ${projectName}. Scientist review loop is available.`
            : `Plan generation hit an issue for ${projectName}. Review the hypothesis or retry.`,
          state,
        ),
      );

      return updated;
    });
  }

  function updateProject(projectId: string, updater: (project: LabProject) => LabProject) {
    setProjects((current) => current.map((project) => (project.id === projectId ? updater(project) : project)));
  }

  async function generateForProject(projectId: string, hypothesis: string) {
    const targetProject = projects.find((project) => project.id === projectId);
    if (!targetProject) {
      return;
    }

    setLoading(true);
    setError(null);
    startLogAnimation(targetProject.name);
    updateProject(projectId, (project) => ({
      ...project,
      hypothesis,
      status: "analyzing",
      updatedAt: new Date().toISOString(),
    }));

    try {
      const planResponse = await fetchExperimentPlan(hypothesis);
      const reviewResponse = await fetchReviews(planResponse.experiment.id);

      setPlansByProject((current) => ({ ...current, [projectId]: planResponse.experiment }));
      setReviewsByProject((current) => ({ ...current, [projectId]: reviewResponse }));

      updateProject(projectId, (project) => ({
        ...project,
        hypothesis,
        status: "planned",
        domain: planResponse.experiment.domain,
        novelty: planResponse.experiment.novelty.signal,
        updatedAt: new Date().toISOString(),
      }));

      finalizeLogs("done", targetProject.name);
    } catch (generationError) {
      updateProject(projectId, (project) => ({
        ...project,
        status: "error",
        updatedAt: new Date().toISOString(),
      }));
      setError(generationError instanceof Error ? generationError.message : "Could not generate the experiment plan.");
      finalizeLogs("error", targetProject.name);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateProject() {
    const hypothesis = draftHypothesis.trim();
    const name = draftName.trim();
    if (!hypothesis || !name) {
      return;
    }

    const projectId = `project-${Date.now()}`;
    const newProject: LabProject = {
      id: projectId,
      name,
      hypothesis,
      status: "draft",
      updatedAt: new Date().toISOString(),
    };

    setProjects((current) => [newProject, ...current]);
    setActiveProjectId(projectId);
    setComposerOpen(false);
    await generateForProject(projectId, hypothesis);
  }

  async function handleRegenerate() {
    if (!activeProject) {
      return;
    }
    await generateForProject(activeProject.id, activeProject.hypothesis);
  }

  async function handleReviewAdded() {
    if (!activeProject) {
      return;
    }
    await generateForProject(activeProject.id, activeProject.hypothesis);
  }

  function selectProject(projectId: string) {
    setActiveProjectId(projectId);
    setComposerOpen(false);
  }

  function resetDraftProject() {
    setDraftName("");
    setDraftHypothesis("");
    setError(null);
  }

  function handleDeleteProject(projectId: string) {
    const target = projects.find((project) => project.id === projectId);
    if (!target) {
      return;
    }

    const confirmed = window.confirm(`Delete "${target.name}" and remove its local plan, reviews, and workspace state?`);
    if (!confirmed) {
      return;
    }

    setProjects((current) => current.filter((project) => project.id !== projectId));
    setPlansByProject((current) => {
      const next = { ...current };
      delete next[projectId];
      return next;
    });
    setReviewsByProject((current) => {
      const next = { ...current };
      delete next[projectId];
      return next;
    });

    if (activeProjectId === projectId) {
      const remaining = projects.filter((project) => project.id !== projectId);
      setActiveProjectId(remaining[0]?.id ?? null);
      setComposerOpen(remaining.length === 0);
      setAgentLogs([]);
      setError(null);
    }
  }

  const workspaceEmpty = !activeProject;

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,hsl(var(--background)),hsl(var(--surface)))] flex">
      <Navigator
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={selectProject}
        onCreateProject={() => {
          resetDraftProject();
          setComposerOpen(true);
        }}
        onDeleteProject={handleDeleteProject}
        agentLogs={agentLogs}
      />

      <main className="flex-1 flex min-w-0 flex-col overflow-hidden">
        <header className="border-b border-border bg-panel/90 px-6 py-4 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {activeProject ? `${activeProject.name} · ${activeProject.domain || "Custom workflow"}` : "Create an experiment project"}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">Scientific Planning Workbench</h1>
            </div>
            <PhaseTracker
              projectReady={Boolean(activeProject)}
              noveltyReady={Boolean(activePlan?.novelty)}
              planReady={Boolean(activePlan)}
              loading={loading}
              error={Boolean(error)}
            />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-[1400px] space-y-5">
            {(composerOpen || workspaceEmpty) && (
              <section className="overflow-hidden rounded-[28px] border border-border bg-[radial-gradient(circle_at_top_left,_hsl(var(--accent-soft)),_transparent_35%),linear-gradient(180deg,hsl(var(--panel)),hsl(var(--surface)))] shadow-sm">
                <div className="grid gap-0 xl:grid-cols-[1.15fr_0.85fr]">
                  <div className="p-6 xl:p-8">
                    <div className="mb-4 flex items-center gap-2">
                      <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                        <Plus className="size-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold">Start a new project</div>
                        <div className="text-xs text-muted-foreground">Create the experiment container first, then let the system build the operational plan.</div>
                      </div>
                    </div>

                    <div className="grid gap-4">
                      <div>
                        <label className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                          Project name
                        </label>
                        <input
                          value={draftName}
                          onChange={(event) => setDraftName(event.target.value)}
                          placeholder="Example: Trehalose Cryopreservation Study"
                          className="w-full rounded-2xl border border-border bg-panel px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                          Scientific hypothesis
                        </label>
                        <textarea
                          value={draftHypothesis}
                          onChange={(event) => setDraftHypothesis(event.target.value)}
                          className="min-h-40 w-full rounded-2xl border border-border bg-panel px-4 py-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30"
                          placeholder="Enter the intervention, outcome threshold, mechanism, and control condition..."
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => void handleCreateProject()}
                          disabled={loading || !draftName.trim() || !draftHypothesis.trim()}
                          className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-sm disabled:opacity-60"
                        >
                          {loading ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                          Create project and generate plan
                        </button>
                        {!workspaceEmpty && (
                          <button
                            type="button"
                            onClick={() => setComposerOpen(false)}
                            className="rounded-2xl border border-border bg-panel px-4 py-3 text-sm font-medium hover:bg-muted"
                          >
                            Continue with current workspace
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-border bg-panel/70 p-6 xl:border-l xl:border-t-0 xl:p-8">
                    <div className="mb-4 text-sm font-semibold">What scientists need immediately</div>
                    <div className="grid gap-3">
                      {[
                        "A fast novelty signal before spending on materials",
                        "Critical-path reagents, lead times, and realistic ordering risk",
                        "Go / no-go validation gates instead of verbose prose",
                        "A feedback loop where reviews improve the next plan",
                      ].map((item) => (
                        <div key={item} className="flex items-start gap-3 rounded-2xl border border-border bg-muted/30 p-4">
                          <div className="mt-0.5 flex size-6 items-center justify-center rounded-full bg-success-soft text-success">
                            <ChevronRight className="size-3.5" />
                          </div>
                          <div className="text-sm text-foreground/85">{item}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {activeProject && (
              <>
                <section className="rounded-[28px] border border-border bg-[radial-gradient(circle_at_top_right,_hsl(var(--primary-soft)),_transparent_30%),linear-gradient(180deg,hsl(var(--panel)),hsl(var(--panel)))] p-6 shadow-sm">
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-primary/20 bg-primary-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                          {activeProject.domain || "Active project"}
                        </span>
                        <span className="rounded-full border border-border bg-panel px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          Updated {formatProjectTime(activeProject.updatedAt)}
                        </span>
                        {activeProject.novelty && (
                          <span className="rounded-full border border-accent/20 bg-accent-soft px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-accent-foreground">
                            {activeProject.novelty}
                          </span>
                        )}
                      </div>
                      <h2 className="max-w-4xl text-xl font-semibold leading-tight">{activeProject.name}</h2>
                      <p className="mt-2 max-w-4xl text-sm leading-relaxed text-muted-foreground">
                        {activePlan?.plainEnglish || "Use the hypothesis editor below to generate the first operational plan."}
                      </p>
                    </div>

                    {activePlan && (
                      <div className="grid grid-cols-3 gap-3 xl:w-[360px]">
                        <Metric label="Confidence" value={activePlan.metrics.confidence} tone="primary" icon={<ShieldCheck className="size-3.5" />} />
                        <Metric label="Novelty" value={activePlan.metrics.novelty} tone="accent" icon={<Sparkles className="size-3.5" />} />
                        <Metric label="Sustainability" value={activePlan.metrics.sustainability} tone="success" icon={<Leaf className="size-3.5" />} />
                      </div>
                    )}
                  </div>

                  <div className="mt-5 grid gap-3 xl:grid-cols-[1fr_auto]">
                    <textarea
                      value={activeProject.hypothesis}
                      onChange={(event) =>
                        updateProject(activeProject.id, (project) => ({
                          ...project,
                          hypothesis: event.target.value,
                        }))
                      }
                      className="min-h-28 rounded-2xl border border-border bg-panel px-4 py-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <div className="flex flex-wrap gap-3 xl:flex-col">
                      <button
                        type="button"
                        onClick={() => void generateForProject(activeProject.id, activeProject.hypothesis)}
                        disabled={loading}
                        className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-sm disabled:opacity-60"
                      >
                        {loading ? "Generating..." : "Run Planning Agent"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          resetDraftProject();
                          setComposerOpen(true);
                        }}
                        className="rounded-2xl border border-border bg-panel px-4 py-3 text-sm font-medium hover:bg-muted"
                      >
                        New Project
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteProject(activeProject.id)}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-danger/20 bg-danger-soft px-4 py-3 text-sm font-medium text-danger hover:bg-danger hover:text-white"
                      >
                        <Trash2 className="size-4" />
                        Delete Project
                      </button>
                    </div>
                  </div>
                </section>

                <section className="grid gap-4 xl:grid-cols-4">
                  <div className="rounded-2xl border border-border bg-panel p-4 shadow-sm">
                    <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Novelty</div>
                    <div className="text-sm font-medium">{activePlan?.novelty.signal || "Waiting"}</div>
                    <div className="mt-2 text-xs text-muted-foreground">Fast QC before the lab commits budget.</div>
                  </div>
                  <div className="rounded-2xl border border-border bg-panel p-4 shadow-sm">
                    <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Materials</div>
                    <div className="text-sm font-medium">{activePlan?.materials.length ?? 0} critical items</div>
                    <div className="mt-2 text-xs text-muted-foreground">Catalog-ready and procurement-aware.</div>
                  </div>
                  <div className="rounded-2xl border border-border bg-panel p-4 shadow-sm">
                    <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Validation</div>
                    <div className="text-sm font-medium">{activePlan?.validation.decisionGates.length ?? 0} gates</div>
                    <div className="mt-2 text-xs text-muted-foreground">Clear stop/go decisions for scientists.</div>
                  </div>
                  <div className="rounded-2xl border border-border bg-panel p-4 shadow-sm">
                    <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Review memory</div>
                    <div className="text-sm font-medium">{activeReviews.length} scientist notes</div>
                    <div className="mt-2 text-xs text-muted-foreground">Used to improve the next regeneration.</div>
                  </div>
                </section>
              </>
            )}

            {loading && (
              <section className="rounded-2xl border border-border bg-panel p-5 shadow-sm">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  The planning agent is working through retrieval, novelty QC, and operational assembly. If this takes longer than expected, check backend logs for `[plan:*]` timing lines.
                </div>
              </section>
            )}

            {error && (
              <section className="rounded-2xl border border-danger/20 bg-danger-soft/30 p-4 text-sm text-danger shadow-sm">
                {error}
              </section>
            )}

            {activePlan && (
              <>
                <ProtocolCard steps={activePlan.steps} materials={activePlan.materials} />
                <ValidationCard validation={activePlan.validation} />
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                  <SupplyChainCard plan={activePlan} budgetRegion={budgetRegion} />
                  <TimelineCard phases={activePlan.timeline} />
                </div>
                <ComparisonCard rows={activePlan.benchmark} budgetRegion={budgetRegion} />
              </>
            )}

            {!activeProject && !composerOpen && (
              <section className="rounded-2xl border border-dashed border-border bg-panel p-10 text-center shadow-sm">
                <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                  <Beaker className="size-6" />
                </div>
                <div className="text-lg font-semibold">No active project selected</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  Create a new project to start novelty QC, planning, and scientist review.
                </div>
                <button
                  type="button"
                  onClick={() => setComposerOpen(true)}
                  className="mt-5 rounded-2xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground"
                >
                  Create Project
                </button>
              </section>
            )}
          </div>
        </div>
      </main>

      {activePlan && activeProject && (
        <>
          <ContextStore
            plan={activePlan}
            reviews={activeReviews}
            onReviewAdded={handleReviewAdded}
            budgetRegion={budgetRegion}
            onBudgetRegionChange={(code) => setBudgetRegion(budgetRegionByCode(code))}
          />
          <Chatbot experimentId={activePlan.id} hypothesis={activeProject.hypothesis} plan={activePlan} reviews={activeReviews} />
        </>
      )}
    </div>
  );
};

export default Index;

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Beaker, ChevronRight, DollarSign, Leaf, Loader2, Menu, PanelRightOpen, Plus, ShieldCheck, Sparkles, TestTube2, Timer, Trash2, Wand2, X } from "lucide-react";
import { Navigator, type AgentLogItem, type ProjectListItem } from "@/components/lab/Navigator";
import { ContextStore } from "@/components/lab/ContextStore";
import { ProtocolCard } from "@/components/lab/ProtocolCard";
import { MoleculeCard } from "@/components/lab/MoleculeCard";
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

const REFERENCE_PROJECT_ID = "gold-np-reference";

function buildReferenceProjectBundle() {
  const now = new Date().toISOString();
  const project: LabProject = {
    id: REFERENCE_PROJECT_ID,
    name: "Turkevich Gold Nanoparticle Synthesis",
    hypothesis:
      "If trisodium citrate is used to reduce HAuCl4 at controlled boiling conditions, then 15-25 nm citrate-capped gold nanoparticles will form with an SPR peak near 520 nm and stable colloidal behavior for at least 7 days.",
    status: "planned",
    domain: "Nanomaterials / Colloidal Chemistry",
    novelty: "similar work exists",
    updatedAt: now,
  };

  const plan: ExperimentPlan = {
    id: "gold-np-reference-exp",
    project: project.name,
    hypothesis: project.hypothesis,
    plainEnglish:
      "Convert gold salt to stable citrate-capped gold nanoparticles and validate size and optical signature against expected literature ranges.",
    domain: "Nanomaterials / Colloidal Chemistry",
    metrics: {
      confidence: "82%",
      novelty: "similar work exists",
      sustainability: "76",
    },
    novelty: {
      signal: "similar work exists",
      summary:
        "Turkevich citrate reduction is established; this setup remains useful as a benchmark for reproducibility and downstream functionalization studies.",
      references: [
        {
          title: "The chemistry of the citrate process of gold nanoparticle synthesis",
          source: "PubChem / Literature",
          uri: "https://pubmed.ncbi.nlm.nih.gov/17658745/",
        },
        {
          title: "Mechanistic understanding of Turkevich method",
          source: "Open literature",
          uri: "https://doi.org/10.1039/C3NR02121A",
        },
      ],
    },
    materials: [
      {
        name: "Hydrogen tetrachloroaurate(III) trihydrate",
        catalogNumber: "HAuCl4-3H2O",
        supplier: "Sigma-Aldrich",
        quantity: "100 mg",
        unitCostUsd: 145,
        leadTime: "3-5 days",
        status: "order",
        pubchemCid: 28103,
        molecularFormula: "AuCl4H",
        molecularWeight: 339.79,
        sourceUri: "https://pubchem.ncbi.nlm.nih.gov/compound/28103",
      },
      {
        name: "Trisodium citrate dihydrate",
        catalogNumber: "TCD-500G",
        supplier: "Thermo Fisher",
        quantity: "500 g",
        unitCostUsd: 42,
        leadTime: "2-4 days",
        status: "in-stock",
        pubchemCid: 16211978,
        molecularFormula: "C6H9Na3O9",
        molecularWeight: 258.06,
        sourceUri: "https://pubchem.ncbi.nlm.nih.gov/compound/16211978",
      },
      {
        name: "Ultrapure water",
        catalogNumber: "MQ-H2O",
        supplier: "In-house",
        quantity: "2 L",
        unitCostUsd: 8,
        leadTime: "same day",
        status: "owned",
      },
      {
        name: "Gold nanoparticles",
        catalogNumber: "AU-NP-RESULT",
        supplier: "In-lab synthesis",
        quantity: "100 mL colloid",
        unitCostUsd: 0,
        leadTime: "generated",
        status: "owned",
        pubchemCid: 23985,
        molecularFormula: "Au",
        molecularWeight: 196.97,
        sourceUri: "https://pubchem.ncbi.nlm.nih.gov/compound/23985",
      },
    ],
    steps: [
      {
        id: "s1",
        title: "Prepare precursor and citrate stocks",
        detail:
          "Prepare 1 mM HAuCl4 in ultrapure water and 38.8 mM trisodium citrate stock. Filter both through 0.22 um membrane to minimize particle contamination.",
        quantity: "100 mL batch",
        duration: "25 min",
        source: "protocols.io",
        sourceTitle: "Citrate reduction synthesis of Au nanoparticles",
        sourceUri: "https://www.protocols.io/",
        riskLevel: "low",
        riskNote: "Avoid metal contamination from glassware residues.",
        validationChecks: ["Solutions clear", "No precipitate", "Correct molarity labels"],
        stepMaterials: ["HAuCl4", "Trisodium citrate", "Ultrapure water"],
        safetyConstraints: ["Use gloves and eye protection", "Handle gold salt away from skin contact"],
        rationale: "Stock accuracy directly controls nucleation rate and final size spread.",
      },
      {
        id: "s2",
        title: "Heat and initiate reduction",
        detail:
          "Bring HAuCl4 solution to rolling boil under stirring. Quickly inject citrate solution and maintain boiling for 15 minutes.",
        quantity: "100 mL reaction",
        duration: "20 min",
        source: "Open literature",
        sourceTitle: "Turkevich method optimization report",
        sourceUri: "https://doi.org/10.1039/C3NR02121A",
        riskLevel: "med",
        riskNote: "Unstable temperature may broaden nanoparticle size distribution.",
        validationChecks: ["Color shift pale yellow to wine-red", "No visible aggregates"],
        decisionGate: "Proceed only if colloid appears ruby-red without gray/black precipitate.",
        stepMaterials: ["HAuCl4 solution", "Citrate solution"],
        safetyConstraints: ["Use heat-resistant gloves", "Prevent boiling overflow"],
        rationale: "Temperature and injection timing determine nucleation burst and growth balance.",
      },
      {
        id: "s3",
        title: "Cool and age colloid",
        detail:
          "Remove heat and continue stirring during cool-down to room temperature. Age for 12-24 hours before characterization.",
        quantity: "full batch",
        duration: "24 h",
        source: "protocols.io",
        sourceTitle: "Post-synthesis stabilization for citrate-capped AuNP",
        sourceUri: "https://www.protocols.io/",
        riskLevel: "low",
        riskNote: "Insufficient aging can cause unstable UV-Vis baseline.",
        validationChecks: ["No sediment after 24 h", "Uniform red color"],
        stepMaterials: ["Fresh AuNP colloid"],
        rationale: "Aging allows surface adsorption equilibrium and improved colloid stability.",
      },
      {
        id: "s4",
        title: "UV-Vis characterization",
        detail:
          "Acquire UV-Vis spectrum from 400-800 nm. Confirm surface plasmon resonance peak near 520 nm.",
        quantity: "3 replicates",
        duration: "30 min",
        source: "Open literature",
        sourceTitle: "Optical signatures of citrate-capped AuNP",
        sourceUri: "https://pubmed.ncbi.nlm.nih.gov/17658745/",
        riskLevel: "low",
        riskNote: "Dirty cuvettes can shift baseline and distort peak intensity.",
        validationChecks: ["Peak at 518-525 nm", "Replicate variance < 3 nm"],
        decisionGate: "Proceed to storage or application only if SPR peak is in expected band.",
        stepMaterials: ["AuNP colloid", "Quartz cuvette"],
        rationale: "SPR peak position is a rapid proxy for size and monodispersity.",
      },
      {
        id: "s5",
        title: "Stability check (7 days)",
        detail:
          "Store at 4 C and room temperature. Re-check UV-Vis and visible aggregation on day 7.",
        quantity: "2 storage conditions",
        duration: "7 days",
        source: "Internal QC",
        sourceTitle: "Colloid stability assessment",
        riskLevel: "med",
        riskNote: "Ionic contamination may trigger delayed aggregation.",
        validationChecks: ["No major peak red-shift (>5 nm)", "No visible sediment"],
        decisionGate: "Accept batch only when stability criteria pass in both storage conditions.",
        stepMaterials: ["AuNP aliquots", "Storage vials"],
        rationale: "Short-term stability confirms practical usability beyond immediate synthesis.",
      },
    ],
    timeline: [
      { phase: "Preparation", durationDays: 1, dependsOn: [], owner: "Scientist", deliverable: "Calibrated precursor/citrate stocks" },
      { phase: "Synthesis Run", durationDays: 1, dependsOn: ["Preparation"], owner: "Scientist", deliverable: "Fresh AuNP colloid" },
      { phase: "Characterization", durationDays: 1, dependsOn: ["Synthesis Run"], owner: "Scientist", deliverable: "UV-Vis data and pass/fail decision" },
      { phase: "Stability Monitoring", durationDays: 7, dependsOn: ["Characterization"], owner: "Scientist", deliverable: "Day-7 stability report" },
    ],
    budget: {
      reagentsUsd: 195,
      equipmentUsd: 220,
      shippingUsd: 35,
      laborUsd: 180,
      contingencyUsd: 63,
      totalUsd: 693,
      budgetCapUsd: 900,
      savedUsd: 207,
      reliability: "High reliability for reference evaluation; values represent realistic pilot-scale costs.",
      assumptions: [
        "UV-Vis instrument is institution-owned.",
        "Single 100 mL batch with triplicate characterization.",
      ],
      lineItems: [
        { label: "Gold precursor", amountUsd: 145, category: "reagents", note: "HAuCl4 trihydrate" },
        { label: "Citrate + consumables", amountUsd: 50, category: "reagents" },
        { label: "Heating/stirring setup usage", amountUsd: 90, category: "equipment" },
        { label: "UV-Vis usage", amountUsd: 130, category: "equipment" },
        { label: "Shipping", amountUsd: 35, category: "shipping" },
        { label: "Scientist time", amountUsd: 180, category: "labor" },
        { label: "Contingency", amountUsd: 63, category: "contingency" },
      ],
    },
    benchmark: [
      { label: "Manual baseline protocol", time: "12 days", cost: 820, sustainability: 65, ours: false },
      { label: "This reference plan", time: "10 days", cost: 693, sustainability: 76, ours: true },
    ],
    validation: {
      primaryMetric: "UV-Vis SPR peak position",
      successCriteria: "SPR peak at 518-525 nm with no visible aggregation and day-7 stability retained.",
      failureCriteria: [
        "Peak outside acceptance band",
        "Visible precipitation or strong red-shift after storage",
        "Replicate spectral inconsistency",
      ],
      decisionGates: [
        "Ruby-red colloid after reduction",
        "SPR peak within 518-525 nm",
        "No major day-7 instability",
      ],
    },
    reviewAdaptations: [
      {
        section: "Synthesis",
        change: "Added explicit rolling-boil condition and citrate injection timing.",
        impact: "Improves reproducibility across operators.",
      },
      {
        section: "Validation",
        change: "Added day-7 stability gate.",
        impact: "Ensures colloid quality for practical downstream use.",
      },
    ],
    sources: [
      { title: "The chemistry of the citrate process of gold nanoparticle synthesis", source: "PubMed", uri: "https://pubmed.ncbi.nlm.nih.gov/17658745/" },
      { title: "Mechanistic study of Turkevich synthesis", source: "DOI", uri: "https://doi.org/10.1039/C3NR02121A" },
      { title: "Protocol templates for AuNP synthesis", source: "protocols.io", uri: "https://www.protocols.io/" },
    ],
    compoundMap: [
      {
        name: "Hydrogen tetrachloroaurate(III)",
        role: "reagent",
        rationale: "Gold precursor in Turkevich reaction.",
        pubchemCid: 28103,
        molecularFormula: "AuCl4H",
        molecularWeight: 339.79,
        sourceUri: "https://pubchem.ncbi.nlm.nih.gov/compound/28103",
      },
      {
        name: "Trisodium citrate",
        role: "reagent",
        rationale: "Reductant and capping ligand.",
        pubchemCid: 6224,
        molecularFormula: "C6H5Na3O7",
        molecularWeight: 258.06,
        sourceUri: "https://pubchem.ncbi.nlm.nih.gov/compound/6224",
      },
      {
        name: "Gold nanoparticles",
        role: "product",
        rationale: "Target colloidal product.",
        pubchemCid: 23985,
        molecularFormula: "Au",
        molecularWeight: 196.97,
        sourceUri: "https://pubchem.ncbi.nlm.nih.gov/compound/23985",
      },
    ],
    targetCompound: {
      name: "Gold nanoparticles",
      pubchemCid: 23985,
      molecularFormula: "Au",
      molecularWeight: 196.97,
      iupacName: "gold",
      note: "Final colloidal product targeted by this reference workflow.",
      literatureRef: {
        title: "The chemistry of the citrate process of gold nanoparticle synthesis",
        uri: "https://pubmed.ncbi.nlm.nih.gov/17658745/",
      },
    },
  };

  const reviews: ReviewRecord[] = [
    {
      experimentId: plan.id,
      section: "Validation",
      reviewer: "Reference QA Reviewer",
      correction: "Track replicate peak variance and not only mean peak position.",
      severity: "medium",
    },
  ];

  return { project, plan, reviews };
}

const PROJECTS_STORAGE_KEY = "agentic-labmate-projects";
const PLANS_STORAGE_KEY = "agentic-labmate-plans";
const ACTIVE_PROJECT_STORAGE_KEY = "agentic-labmate-active-project";
const BUDGET_REGION_STORAGE_KEY = "agentic-labmate-budget-region";

type MainTab = "protocol" | "budget" | "timeline" | "validation";

const TAB_CONFIG: { id: MainTab; label: string; icon: ReactNode }[] = [
  { id: "protocol",   label: "Protocol",         icon: <TestTube2 className="size-3.5" /> },
  { id: "budget",     label: "Budget & Compare",  icon: <DollarSign className="size-3.5" /> },
  { id: "timeline",   label: "Timeline",          icon: <Timer className="size-3.5" /> },
  { id: "validation", label: "Validation",        icon: <ShieldCheck className="size-3.5" /> },
];

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

const Index = () => {
  const [projects, setProjects] = useState<LabProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [plansByProject, setPlansByProject] = useState<Record<string, ExperimentPlan>>({});
  const [reviewsByProject, setReviewsByProject] = useState<Record<string, ReviewRecord[]>>({});
  const [agentLogs, setAgentLogs] = useState<AgentLogItem[]>([]);
  const [composerOpen, setComposerOpen] = useState(true);
  const [draftName, setDraftName] = useState("");
  const [draftHypothesis, setDraftHypothesis] = useState("");
  const [activeTab, setActiveTab] = useState<MainTab>("protocol");
  const [budgetRegion, setBudgetRegion] = useState<BudgetRegion>(budgetRegionByCode("DE"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [activeHypothesisDraft, setActiveHypothesisDraft] = useState("");
  const logIntervalRef = useRef<number | null>(null);
  // Prevents save effects from overwriting localStorage before the initial load has completed.
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    try {
      const storedProjects = localStorage.getItem(PROJECTS_STORAGE_KEY);
      const storedActiveId = localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
      const storedPlans = localStorage.getItem(PLANS_STORAGE_KEY);

      if (storedProjects) {
        const parsed = JSON.parse(storedProjects) as LabProject[];
        setProjects(parsed);
        if (parsed.length > 0) {
          setComposerOpen(false);
        }
      }

      if (storedPlans) {
        setPlansByProject(JSON.parse(storedPlans) as Record<string, ExperimentPlan>);
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
    } finally {
      setInitialized(true);
    }
  }, []);

  useEffect(() => {
    if (!initialized) return;
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  }, [initialized, projects]);

  useEffect(() => {
    if (!initialized) return;
    localStorage.setItem(PLANS_STORAGE_KEY, JSON.stringify(plansByProject));
  }, [initialized, plansByProject]);

  useEffect(() => {
    if (!initialized) return;
    if (activeProjectId) {
      localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, activeProjectId);
    } else {
      localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
    }
  }, [initialized, activeProjectId]);

  useEffect(() => {
    if (!initialized) return;
    localStorage.setItem(BUDGET_REGION_STORAGE_KEY, budgetRegion.code);
  }, [initialized, budgetRegion]);

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
    setActiveHypothesisDraft(activeProject?.hypothesis || "");
  }, [activeProject?.id]);

  // Auto-generate when project has no plan (new project or plan was lost).
  useEffect(() => {
    if (activeProject && !plansByProject[activeProject.id] && activeProject.hypothesis && !loading) {
      void generateForProject(activeProject.id, activeProject.hypothesis);
    }
    // generateForProject is intentionally excluded to avoid retrigger loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, plansByProject, loading]);

  // Load reviews from server whenever the active plan changes (covers page reloads).
  useEffect(() => {
    if (!activePlan || !activeProject) return;
    fetchReviews(activePlan.id)
      .then((reviews) => setReviewsByProject((curr) => ({ ...curr, [activeProject.id]: reviews })))
      .catch(() => {/* server may be offline — reviews will load on next successful call */});
    // fetchReviews is a stable import; activePlan.id + activeProject.id are the only relevant deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlan?.id]);

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
    // Refresh the reviews panel without regenerating the full plan.
    // Users can click "Regenerate" explicitly if they want the plan updated.
    try {
      const planId = plansByProject[activeProject.id]?.id;
      if (planId) {
        const updatedReviews = await fetchReviews(planId);
        setReviewsByProject((current) => ({ ...current, [activeProject.id]: updatedReviews }));
      }
    } catch {
      // Server may be offline — review was already saved; UI will refresh on reconnect.
    }
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

  function loadReferenceProject() {
    const reference = buildReferenceProjectBundle();

    setProjects((current) => {
      const withoutReference = current.filter((item) => item.id !== REFERENCE_PROJECT_ID);
      return [reference.project, ...withoutReference];
    });

    setPlansByProject((current) => ({
      ...current,
      [REFERENCE_PROJECT_ID]: reference.plan,
    }));

    setReviewsByProject((current) => ({
      ...current,
      [REFERENCE_PROJECT_ID]: reference.reviews,
    }));

    setActiveProjectId(REFERENCE_PROJECT_ID);
    setComposerOpen(false);
    setError(null);
    setActiveTab("protocol");
    setActiveHypothesisDraft(reference.project.hypothesis);
    setAgentLogs([
      createLog("reference-loaded", "Loaded full reference project with compounds, protocol, budget, timeline, and validation.", "done"),
    ]);
  }

  const workspaceEmpty = !activeProject;

  return (
    <div className="min-h-screen bg-background flex relative overflow-hidden">

      {/* ── Subtle background gradient ── */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top_left,_hsl(var(--primary-soft))_0%,_transparent_40%),radial-gradient(ellipse_at_bottom_right,_hsl(var(--accent-soft))_0%,_transparent_40%)] opacity-60" />

      {/* ── Mobile nav backdrop ── */}
      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setNavOpen(false)}
        />
      )}

      {/* ── Left navigator (slide-in on mobile) ── */}
      <div className={`fixed inset-y-0 left-0 z-40 transition-transform duration-300 ease-in-out lg:relative lg:z-auto lg:translate-x-0 ${navOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <Navigator
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={(id) => { selectProject(id); setNavOpen(false); }}
          onCreateProject={() => { resetDraftProject(); setComposerOpen(true); setNavOpen(false); }}
          onDeleteProject={handleDeleteProject}
          agentLogs={agentLogs}
        />
      </div>

      <main className="flex-1 flex min-w-0 flex-col overflow-hidden">
        <header className="border-b border-border bg-panel/95 px-4 py-3 backdrop-blur-sm sm:px-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {/* Hamburger — visible below lg */}
              <button
                type="button"
                onClick={() => setNavOpen(true)}
                className="flex size-9 items-center justify-center rounded-xl border border-border bg-muted/40 text-muted-foreground hover:bg-muted lg:hidden"
                aria-label="Open navigation"
              >
                <Menu className="size-4" />
              </button>
              <div className="min-w-0">
                <div className="truncate text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium">
                  {activeProject ? `${activeProject.domain || "Custom"} · ${activeProject.name}` : "Scientific Planning Workbench"}
                </div>
                <h1 className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                  <span className="text-primary">Agentic</span> Lab<span className="text-accent">Mate</span>
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <PhaseTracker
                projectReady={Boolean(activeProject)}
                noveltyReady={Boolean(activePlan?.novelty)}
                planReady={Boolean(activePlan)}
                loading={loading}
                error={Boolean(error)}
              />
              {/* Context panel toggle — visible below xl when plan is ready */}
              {activePlan && (
                <button
                  type="button"
                  onClick={() => setContextOpen((v) => !v)}
                  className="flex size-9 items-center justify-center rounded-xl border border-border bg-muted/40 text-muted-foreground hover:bg-muted xl:hidden"
                  aria-label="Toggle context panel"
                >
                  <PanelRightOpen className="size-4" />
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto max-w-[1400px] space-y-4 sm:space-y-5">
            {(composerOpen || workspaceEmpty) && (
              <section className="overflow-hidden rounded-[28px] border border-border bg-[radial-gradient(circle_at_top_left,_hsl(var(--accent-soft)),_transparent_35%),linear-gradient(180deg,hsl(var(--panel)),hsl(var(--surface)))] shadow-sm">
                <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
                  <div className="p-5 lg:p-8">
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
                        <button
                          type="button"
                          onClick={loadReferenceProject}
                          className="inline-flex items-center gap-2 rounded-2xl border border-accent/30 bg-accent-soft px-5 py-3 text-sm font-medium text-accent-foreground shadow-sm hover:bg-accent-soft/70"
                        >
                          Load full reference project
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

                  <div className="border-t border-border bg-panel/70 p-5 lg:border-l lg:border-t-0 lg:p-8">
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
                {/* ── Project header bar ── */}
                <section className="rounded-2xl border border-border bg-panel shadow-sm overflow-hidden">
                  <div className="flex flex-col gap-0">
                    {/* Top row: identity + metrics */}
                    <div className="flex flex-col gap-3 px-5 pt-5 pb-4 lg:flex-row lg:items-center lg:justify-between bg-[radial-gradient(ellipse_at_top_right,_hsl(var(--primary-soft)),_transparent_50%)]">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="rounded-full border border-primary/25 bg-primary px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-foreground">
                            {activeProject.domain || "Custom"}
                          </span>
                          {activeProject.novelty && (
                            <span className="rounded-full border border-accent/30 bg-accent-soft px-2.5 py-1 text-[10px] font-medium text-accent-foreground">
                              ✦ {activeProject.novelty}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            Updated {formatProjectTime(activeProject.updatedAt)}
                          </span>
                        </div>
                        <h2 className="text-lg font-bold leading-tight tracking-tight">{activeProject.name}</h2>
                        {activePlan?.plainEnglish && (
                          <p className="mt-1 text-xs text-muted-foreground leading-relaxed max-w-2xl line-clamp-2">
                            {activePlan.plainEnglish}
                          </p>
                        )}
                      </div>
                      {activePlan && (
                        <div className="flex gap-2 shrink-0">
                          {[
                            { label: "Confidence", value: activePlan.metrics.confidence, icon: <ShieldCheck className="size-3" />, cls: "border-primary/20 bg-primary-soft text-primary" },
                            { label: "Novelty",    value: activePlan.metrics.novelty,    icon: <Sparkles className="size-3" />,    cls: "border-accent/20 bg-accent-soft text-accent-foreground" },
                            { label: "Sustain.",   value: activePlan.metrics.sustainability, icon: <Leaf className="size-3" />,    cls: "border-success/20 bg-success-soft text-success" },
                          ].map(({ label, value, icon, cls }) => (
                            <div key={label} className={`flex flex-col items-center rounded-xl border px-3 py-2 text-center ${cls}`}>
                              <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide opacity-70 mb-0.5">{icon}{label}</div>
                              <div className="text-sm font-bold leading-tight">{value}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Stats strip */}
                    {activePlan && (
                      <div className="grid grid-cols-4 divide-x divide-border border-t border-border text-center">
                        {[
                          { label: "Steps",    value: String(activePlan.steps.length) },
                          { label: "Materials", value: String(activePlan.materials.length) },
                          { label: "Gates",     value: String(activePlan.validation.decisionGates.length) },
                          { label: "Reviews",   value: String(activeReviews.length) },
                        ].map(({ label, value }) => (
                          <div key={label} className="py-2.5 px-2">
                            <div className="text-base font-bold text-foreground">{value}</div>
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Hypothesis editor + actions */}
                    <div className="border-t border-border px-5 py-4 bg-muted/20">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:gap-3">
                        <textarea
                          value={activeHypothesisDraft}
                          onChange={(event) => setActiveHypothesisDraft(event.target.value)}
                          rows={2}
                          className="flex-1 rounded-xl border border-border bg-panel px-3 py-2.5 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                          placeholder="Scientific hypothesis…"
                        />
                        <div className="flex gap-2 lg:flex-col lg:w-36">
                          <button
                            type="button"
                            onClick={() =>
                              updateProject(activeProject.id, (project) => ({
                                ...project,
                                hypothesis: activeHypothesisDraft,
                                updatedAt: new Date().toISOString(),
                              }))
                            }
                            disabled={activeHypothesisDraft.trim().length === 0}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-primary-soft px-3 py-2 text-xs font-semibold text-primary disabled:opacity-50"
                          >
                            Apply
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const hypothesis = activeHypothesisDraft.trim();
                              if (!hypothesis) return;
                              updateProject(activeProject.id, (project) => ({
                                ...project,
                                hypothesis,
                                updatedAt: new Date().toISOString(),
                              }));
                              void generateForProject(activeProject.id, hypothesis);
                            }}
                            disabled={loading}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm disabled:opacity-60"
                          >
                            {loading ? <Loader2 className="size-3 animate-spin" /> : <Wand2 className="size-3" />}
                            {loading ? "Running…" : "Run Agent"}
                          </button>
                          <button
                            type="button"
                            onClick={() => { resetDraftProject(); setComposerOpen(true); }}
                            className="rounded-xl border border-border bg-panel px-3 py-2 text-xs font-medium hover:bg-muted"
                          >
                            New
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteProject(activeProject.id)}
                            className="inline-flex items-center justify-center rounded-xl border border-danger/20 bg-danger-soft px-3 py-2 text-xs font-medium text-danger hover:bg-danger hover:text-white"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              </>
            )}

            {loading && (
              <section className="rounded-xl border border-border bg-panel p-4 shadow-sm">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  Planning agent is running retrieval, novelty QC and operational assembly…
                </div>
              </section>
            )}

            {error && (
              <section className="rounded-xl border border-danger/20 bg-danger-soft/30 p-4 text-xs text-danger shadow-sm">
                {error}
              </section>
            )}

            {activePlan && (
              <>
                {/* ── Tab bar ── */}
                <div className="flex gap-1 rounded-2xl border border-border bg-panel p-1.5 shadow-sm">
                  {TAB_CONFIG.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[11px] font-semibold transition-all ${
                        activeTab === tab.id
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      }`}
                    >
                      {tab.icon}
                      <span className="hidden sm:inline">{tab.label}</span>
                    </button>
                  ))}
                </div>

                {/* ── Tab panels ── */}
                {activeTab === "protocol" && (
                  <div className="space-y-4">
                    <MoleculeCard plan={activePlan} />
                    <ProtocolCard planId={activePlan.id} steps={activePlan.steps} materials={activePlan.materials} />
                  </div>
                )}
                {activeTab === "budget" && (
                  <div className="space-y-4">
                    <SupplyChainCard plan={activePlan} budgetRegion={budgetRegion} />
                    <ComparisonCard rows={activePlan.benchmark} budgetRegion={budgetRegion} />
                  </div>
                )}
                {activeTab === "timeline" && (
                  <TimelineCard phases={activePlan.timeline} />
                )}
                {activeTab === "validation" && (
                  <ValidationCard validation={activePlan.validation} />
                )}
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
          {/* ── Right context panel backdrop (mobile/tablet) ── */}
          {contextOpen && (
            <div
              className="fixed inset-0 z-30 bg-black/40 xl:hidden"
              onClick={() => setContextOpen(false)}
            />
          )}
          {/* ── Context panel wrapper ── */}
          <div className={`fixed inset-y-0 right-0 z-40 flex flex-col transition-transform duration-300 ease-in-out xl:relative xl:z-auto xl:translate-x-0 ${contextOpen ? "translate-x-0" : "translate-x-full"}`}>
            <div className="flex items-center justify-between border-b border-border bg-panel/95 px-4 py-2 xl:hidden">
              <span className="text-sm font-semibold">Lab Context</span>
              <button
                type="button"
                onClick={() => setContextOpen(false)}
                className="flex size-7 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <ContextStore
              plan={activePlan}
              reviews={activeReviews}
              onReviewAdded={handleReviewAdded}
              budgetRegion={budgetRegion}
              onBudgetRegionChange={(code) => setBudgetRegion(budgetRegionByCode(code))}
            />
          </div>
          <Chatbot experimentId={activePlan.id} hypothesis={activeProject.hypothesis} plan={activePlan} reviews={activeReviews} />
        </>
      )}
    </div>
  );
};

export default Index;

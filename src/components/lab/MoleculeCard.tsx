import { useEffect, useMemo, useRef, useState } from "react";
import { Atom, ExternalLink, FlaskConical, Orbit, Plus, RotateCw, Info, CheckCircle2, ShieldCheck } from "lucide-react";
import { moleculeForPlan, type ExperimentPlan, type MoleculeModel } from "@/lib/labApi";

const elementColor: Record<string, string> = {
  C:  "bg-slate-700 text-white",
  O:  "bg-rose-500 text-white",
  N:  "bg-sky-500 text-white",
  S:  "bg-amber-500 text-slate-950",
  H:  "bg-slate-200 text-slate-950",
  Fe: "bg-orange-600 text-white",
  Cl: "bg-emerald-600 text-white",
  P:  "bg-orange-400 text-slate-950",
};

const elementFullName: Record<string, string> = {
  C:  "Carbon",
  O:  "Oxygen",
  N:  "Nitrogen",
  S:  "Sulphur",
  H:  "Hydrogen",
  Fe: "Iron (Fe²⁺/Fe³⁺ redox centre)",
  Cl: "Chlorine",
  P:  "Phosphorus",
};

function rotateAtom(atom: MoleculeModel["atoms"][number], rotation: number) {
  const radians = (rotation * Math.PI) / 180;
  return {
    ...atom,
    x: atom.x * Math.cos(radians) - atom.z * Math.sin(radians),
    z: atom.x * Math.sin(radians) + atom.z * Math.cos(radians),
  };
}

function planKeywords(plan: ExperimentPlan) {
  return [
    plan.project,
    plan.hypothesis,
    plan.plainEnglish,
    plan.domain,
    ...plan.materials.map((m) => m.name),
  ]
    .join(" ")
    .toLowerCase();
}

function comparatorModelsForPlan(plan: ExperimentPlan, base: MoleculeModel) {
  const domain = plan.domain.toLowerCase();
  const keywords = planKeywords(plan);

  if (domain.includes("cell biology")) {
    return [
      base,
      {
        name: "DMSO control",
        formula: "C2H6OS",
        note: "Control cryoprotectant for comparing osmotic and membrane-stabilization assumptions against trehalose.",
        editableHint: "Compare the intervention against the standard DMSO control and record whether the hypothesis should change.",
        atoms: [
          { id: "s1", element: "S", x: 0, y: 0, z: 0.2 },
          { id: "o1", element: "O", x: 1.1, y: -0.4, z: 0.3 },
          { id: "c1", element: "C", x: -1.1, y: -0.2, z: -0.1 },
          { id: "c2", element: "C", x: 0.1, y: 1.2, z: -0.2 },
        ],
        bonds: [
          { from: "s1", to: "o1" },
          { from: "s1", to: "c1" },
          { from: "s1", to: "c2" },
        ],
      },
    ];
  }

  if (domain.includes("diagnostics")) {
    const isBiosensor =
      keywords.includes("biosensor") ||
      keywords.includes("electrochemical") ||
      keywords.includes("crp") ||
      keywords.includes("c-reactive protein") ||
      keywords.includes("antibod");

    if (isBiosensor) {
      // Comparator: Ferrocene (PubChem CID 7692) — the amperometric redox reporter
      // that generates the Faradaic current attenuated by CRP binding.
      return [
        base,
        {
          name: "Ferrocene (redox reporter)",
          formula: "C₁₀H₁₀Fe · PubChem CID 7692",
          note: "The reversible Fe²⁺/Fe³⁺ redox couple (E° ≈ +0.40 V vs. SCE) that generates the amperometric signal. Current decreases as CRP binds and blocks electron transfer between the Cp ring and the electrode surface.",
          editableHint: "The Fe sandwich between two cyclopentadienyl (Cp) rings provides the redox readout. Use the 3D view to reason about how the bulky CRP binding event sterically blocks the Fe centre from the electrode surface, attenuating current.",
          atoms: [
            { id: "fe1", element: "Fe", x:  0.00, y:  0.00, z:  0.00 },
            // Upper Cp ring (z = +1.65 Å)
            { id: "c1",  element: "C",  x:  0.70, y:  0.00, z:  1.65 },
            { id: "c2",  element: "C",  x:  0.22, y:  0.68, z:  1.65 },
            { id: "c3",  element: "C",  x: -0.58, y:  0.42, z:  1.65 },
            { id: "c4",  element: "C",  x: -0.58, y: -0.42, z:  1.65 },
            { id: "c5",  element: "C",  x:  0.22, y: -0.68, z:  1.65 },
            // Lower Cp ring (z = −1.65 Å, staggered 36°)
            { id: "c6",  element: "C",  x:  0.58, y:  0.42, z: -1.65 },
            { id: "c7",  element: "C",  x: -0.22, y:  0.68, z: -1.65 },
            { id: "c8",  element: "C",  x: -0.70, y:  0.00, z: -1.65 },
            { id: "c9",  element: "C",  x: -0.22, y: -0.68, z: -1.65 },
            { id: "c10", element: "C",  x:  0.58, y: -0.42, z: -1.65 },
          ],
          bonds: [
            { from: "c1",  to: "c2"  }, { from: "c2",  to: "c3"  },
            { from: "c3",  to: "c4"  }, { from: "c4",  to: "c5"  },
            { from: "c5",  to: "c1"  },
            { from: "c6",  to: "c7"  }, { from: "c7",  to: "c8"  },
            { from: "c8",  to: "c9"  }, { from: "c9",  to: "c10" },
            { from: "c10", to: "c6"  },
            { from: "fe1", to: "c1"  }, { from: "fe1", to: "c8"  },
          ],
        },
      ];
    }

    // Generic diagnostics interferent for non-biosensor plans
    return [
      base,
      {
        name: "Whole-blood interferent cue",
        formula: "Matrix control",
        note: "Use this control view to reason about whole-blood matrix interference against the intended assay binding surface.",
        editableHint: "Compare target and interferent arrangements while discussing selectivity and non-specific binding risk.",
        atoms: [
          { id: "n1", element: "N", x: -0.8, y: -0.5, z: 0.1 },
          { id: "c1", element: "C", x:  0.2, y: -0.1, z: -0.1 },
          { id: "o1", element: "O", x:  1.3, y: -0.7, z: 0.2 },
          { id: "s1", element: "S", x:  0.7, y:  1.1, z: 0.1 },
        ],
        bonds: [
          { from: "n1", to: "c1" },
          { from: "c1", to: "o1" },
          { from: "c1", to: "s1" },
        ],
      },
    ];
  }

  if (domain.includes("electrochemistry")) {
    return [
      base,
      {
        name: "CO2 feed cue",
        formula: "CO2",
        note: "Compare the substrate cue against the acetate product when discussing electron transfer and benchmarking logic.",
        editableHint: "Switch between feed and product views to test whether the mechanistic story in the plan actually makes sense.",
        atoms: [
          { id: "o1", element: "O", x: -1.1, y: 0, z: 0.1 },
          { id: "c1", element: "C", x: 0, y: 0, z: -0.1 },
          { id: "o2", element: "O", x: 1.1, y: 0, z: 0.1 },
        ],
        bonds: [
          { from: "o1", to: "c1" },
          { from: "c1", to: "o2" },
        ],
      },
    ];
  }

  return [
    base,
    {
      name: "Mechanistic control cue",
      formula: "Control state",
      note: "Use this comparison state to sketch a control or competing mechanism beside the main representative molecule.",
      editableHint: "Scientists can compare intervention and control sketches to decide whether the hypothesis has a defensible mechanistic contrast.",
      atoms: [
        { id: "c1", element: "C", x: -0.8, y: 0.2, z: 0 },
        { id: "o1", element: "O", x: 0.1, y: -0.7, z: 0.2 },
        { id: "n1", element: "N", x: 1.0, y: 0.3, z: -0.1 },
      ],
      bonds: [
        { from: "c1", to: "o1" },
        { from: "o1", to: "n1" },
      ],
    },
  ];
}

function protocolContextForPlan(plan: ExperimentPlan) {
  const protocolSource = plan.sources.find((source) => source.source.toLowerCase().includes("protocols.io"));
  const protocolStep = plan.steps.find((step) => step.source.toLowerCase().includes("protocol"));

  return {
    hasProtocolSource: Boolean(protocolSource || protocolStep),
    label: protocolSource?.title || protocolStep?.title || "Protocol-linked plan context",
    source: protocolSource?.source || protocolStep?.source || null,
  };
}

/** Molecule role derived from its known name */
function roleLabel(name: string): { label: string; color: string } {
  const n = name.toLowerCase();
  if (n.includes("3-mercapto") || n.includes("sam linker") || n.includes("linker"))
    return { label: "Electrode SAM linker", color: "text-amber-700 bg-amber-50 border-amber-200" };
  if (n.includes("ferrocene") || n.includes("redox reporter"))
    return { label: "Redox reporter", color: "text-orange-700 bg-orange-50 border-orange-200" };
  if (n.includes("dmso") || n.includes("control"))
    return { label: "Control compound", color: "text-slate-600 bg-slate-50 border-slate-200" };
  if (n.includes("trehalose") || n.includes("cryoprotectant"))
    return { label: "Cryoprotectant", color: "text-sky-700 bg-sky-50 border-sky-200" };
  if (n.includes("acetate") || n.includes("co2"))
    return { label: "Metabolite", color: "text-emerald-700 bg-emerald-50 border-emerald-200" };
  return { label: "Key compound", color: "text-primary bg-primary-soft border-primary/20" };
}

/** PubChem CID for known molecules when server doesn't embed it in materials */
const KNOWN_PUBCHEM: Record<string, { cid: number; name: string }> = {
  "3-mercaptopropionic acid": { cid: 75763, name: "3-Mercaptopropionic acid" },
  "sam linker":               { cid: 75763, name: "3-Mercaptopropionic acid" },
  ferrocene:                  { cid: 7692,  name: "Ferrocene" },
  trehalose:                  { cid: 7427,  name: "Trehalose" },
  dmso:                       { cid: 679,   name: "Dimethyl sulfoxide" },
  acetate:                    { cid: 175,   name: "Acetic acid / Acetate" },
};

function pubchemForModel(model: MoleculeModel): { cid: number; name: string } | null {
  const n = model.name.toLowerCase();
  for (const [key, val] of Object.entries(KNOWN_PUBCHEM)) {
    if (n.includes(key)) return val;
  }
  return null;
}

export function MoleculeCard({ plan }: { plan: ExperimentPlan }) {
  const knownCid = useMemo(() => pubchemForModel(moleculeForPlan(plan)), [plan]);
  const presets = useMemo(() => comparatorModelsForPlan(plan, moleculeForPlan(plan)), [plan]);
  const protocolContext = useMemo(() => protocolContextForPlan(plan), [plan]);
  const primaryCompound = useMemo(() => plan.materials.find((item) => item.pubchemCid), [plan]);
  const [presetIndex, setPresetIndex] = useState(0);
  const [mode, setMode] = useState<"2d" | "3d">("3d");
  const [rotation, setRotation] = useState(18);
  const [spread, setSpread] = useState(18);
  const [model, setModel] = useState(presets[0]);
  const [selectedAtomId, setSelectedAtomId] = useState(presets[0].atoms[0]?.id ?? null);
  const [annotation, setAnnotation] = useState("");
  const canvasRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const current = presets[presetIndex] || presets[0];
    setModel(current);
    setSelectedAtomId(current.atoms[0]?.id ?? null);
    setRotation(18);
    setSpread(18);
  }, [presetIndex, presets]);

  useEffect(() => {
    const stored = window.localStorage.getItem(`agentic-labmate-molecule-note-${plan.id}`);
    setAnnotation(stored || "");
  }, [plan.id]);

  useEffect(() => {
    window.localStorage.setItem(`agentic-labmate-molecule-note-${plan.id}`, annotation);
  }, [plan.id, annotation]);

  const projectedAtoms = useMemo(
    () =>
      model.atoms.map((atom) => {
        const rotated = mode === "3d" ? rotateAtom(atom, rotation) : atom;
        const depth = mode === "3d" ? (rotated.z + 2.2) / 4.4 : 0.5;
        return {
          ...rotated,
          depth,
          left: 50 + rotated.x * spread,
          top: 50 + rotated.y * spread,
          size: 18 + depth * 14,
        };
      }),
    [mode, model.atoms, rotation, spread],
  );

  const selectedAtom = model.atoms.find((atom) => atom.id === selectedAtomId) ?? null;

  function updateAtom(atomId: string, next: Partial<MoleculeModel["atoms"][number]>) {
    setModel((current) => ({
      ...current,
      atoms: current.atoms.map((atom) => (atom.id === atomId ? { ...atom, ...next } : atom)),
    }));
  }

  function handleCanvasMove(event: React.PointerEvent<HTMLDivElement>, atomId: string) {
    if (!canvasRef.current) {
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * (100 / spread);
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * (100 / spread);
    updateAtom(atomId, {
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
    });
  }

  function addAtom() {
    const nextId = `x${model.atoms.length + 1}`;
    setModel((current) => ({
      ...current,
      atoms: [...current.atoms, { id: nextId, element: "C", x: 0, y: 0, z: 0 }],
      bonds: current.atoms[0] ? [...current.bonds, { from: current.atoms[0].id, to: nextId }] : current.bonds,
    }));
    setSelectedAtomId(nextId);
  }

  return (
    <section className="rounded-2xl border border-border bg-panel p-4 shadow-sm">
      {/* ── Section header ── */}
      <header className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              {mode === "3d" ? <Orbit className="size-3.5" /> : <Atom className="size-3.5" />}
            </div>
            <div>
              <h3 className="text-sm font-semibold leading-tight">Compound Reference</h3>
              <p className="text-[11px] text-muted-foreground">Project-linked structural context for planning</p>
            </div>
          </div>
          {protocolContext.hasProtocolSource && (
            <span className="rounded-full border border-primary/20 bg-primary-soft px-2.5 py-1 text-[11px] text-primary">
              Protocol-linked
            </span>
          )}
        </div>
      </header>

      {/* ── COMPOUND REFERENCE PANEL — primary visual for project creators ── */}
      {presetIndex === 0 && (primaryCompound?.pubchemCid || knownCid) ? (() => {
        const displayCid = primaryCompound?.pubchemCid ?? knownCid!.cid;
        const displayName = primaryCompound?.name ?? knownCid!.name;
        const isKnownFallback = !primaryCompound?.pubchemCid && !!knownCid;
        return (
          <div className="mb-4 rounded-xl border-2 border-primary/20 bg-primary-soft/30 p-4">
            <div className="mb-2 flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                <FlaskConical className="size-3" />
                Key project compound — PubChem verified
              </div>
              {isKnownFallback && (
                <span className="rounded-full border border-amber-400/30 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  Local CID lookup
                </span>
              )}
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="shrink-0">
                <img
                  src={`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${displayCid}/PNG?image_size=large`}
                  alt={`${displayName} 2D structure`}
                  className="h-36 w-36 rounded-xl border border-border bg-white object-contain shadow-sm"
                />
              </div>
              <div className="flex-1 space-y-1.5 text-xs text-foreground">
                <div className="text-sm font-semibold">{displayName}</div>
                {primaryCompound?.molecularFormula && (
                  <div className="font-mono text-xs text-muted-foreground">{primaryCompound.molecularFormula}</div>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1 text-[11px] text-muted-foreground">
                  {typeof primaryCompound?.molecularWeight === "number" && (
                    <>
                      <span className="font-medium text-foreground/75">MW</span>
                      <span>{primaryCompound.molecularWeight.toFixed(2)} g/mol</span>
                    </>
                  )}
                  {primaryCompound?.iupacName && (
                    <>
                      <span className="font-medium text-foreground/75">IUPAC</span>
                      <span className="truncate">{primaryCompound.iupacName}</span>
                    </>
                  )}
                  <span className="font-medium text-foreground/75">CID</span>
                  <span>{displayCid}</span>
                </div>
                <a
                  href={primaryCompound?.sourceUri || `https://pubchem.ncbi.nlm.nih.gov/compound/${displayCid}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary-soft px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                >
                  <ExternalLink className="size-3" />
                  Open PubChem record
                </a>
              </div>
            </div>
          </div>
        );
      })() : (
        <div className="mb-4 rounded-xl border border-dashed border-border bg-muted/20 p-4 text-center">
          <FlaskConical className="mx-auto mb-2 size-7 text-muted-foreground/50" />
          <div className="text-xs font-medium text-foreground/70">
            {plan.materials[0]?.name || "Project compound"}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            No PubChem structure available for this compound. Use the sketch canvas below to visualise the hypothesis.
          </div>
        </div>
      )}

      {/* ── Preset selector with role labels —— */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {presets.map((preset, index) => {
          const roleInfo = roleLabel(preset.name);
          return (
            <button
              key={`${preset.name}-${index}`}
              type="button"
              onClick={() => setPresetIndex(index)}
              className={`group flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                presetIndex === index
                  ? "border-primary/25 bg-primary-soft text-primary"
                  : "border-border bg-panel text-foreground/75 hover:bg-muted/40"
              }`}
            >
              <span className={`size-2 rounded-full ${presetIndex === index ? "bg-primary" : "bg-border"}`} />
              <span className="text-[10px] font-semibold uppercase tracking-wide opacity-60">{index === 0 ? "INT" : "CMP"}</span>
              {preset.name.split("(")[0].trim()}
            </button>
          );
        })}
      </div>

      {/* ── HYPOTHESIS EXPLORATION CANVAS ── */}
      <div className="rounded-xl border border-border bg-muted/20 p-3 mb-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Info className="size-3.5 text-muted-foreground" />
            <span className="text-[11px] font-semibold text-foreground/75">Hypothesis Exploration Canvas</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-full border border-border bg-panel p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setMode("2d")}
                className={`rounded-full px-2.5 py-1 transition-colors ${mode === "2d" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                2D
              </button>
              <button
                type="button"
                onClick={() => setMode("3d")}
                className={`rounded-full px-2.5 py-1 transition-colors ${mode === "3d" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                3D
              </button>
            </div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mb-2">
          Drag atoms · planning tool only — not a structural database record.
        </p>

        {/* Atom canvas — controls moved below to prevent overlap */}
        <div
          ref={canvasRef}
          className="relative h-56 overflow-hidden rounded-xl border border-border bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.96),rgba(224,234,248,0.88))]"
        >
          <div className="absolute inset-0 bg-[linear-gradient(transparent_95%,rgba(100,120,150,0.07)_95%),linear-gradient(90deg,transparent_95%,rgba(100,120,150,0.07)_95%)] bg-[size:28px_28px]" />
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {model.bonds.map((bond) => {
              const from = projectedAtoms.find((atom) => atom.id === bond.from);
              const to = projectedAtoms.find((atom) => atom.id === bond.to);
              if (!from || !to) return null;
              return (
                <g key={`${bond.from}-${bond.to}`}>
                  <line
                    x1={from.left}
                    y1={from.top}
                    x2={to.left}
                    y2={to.top}
                    stroke="rgba(55,75,100,0.4)"
                    strokeWidth={mode === "3d" ? 1.8 + from.depth : 1.8}
                    strokeLinecap="round"
                  />
                </g>
              );
            })}
          </svg>
          {projectedAtoms.map((atom) => (
            <button
              key={atom.id}
              type="button"
              onPointerDown={(event) => {
                setSelectedAtomId(atom.id);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (event.buttons === 1) handleCanvasMove(event, atom.id);
              }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border shadow-md transition-shadow ${
                elementColor[atom.element] || "bg-slate-500 text-white"
              } ${
                selectedAtomId === atom.id ? "border-primary ring-2 ring-primary/40" : "border-white/50"
              }`}
              style={{
                left: `${atom.left}%`,
                top: `${atom.top}%`,
                width: atom.size,
                height: atom.size,
                opacity: 0.85 + atom.depth * 0.15,
                transform: `translate(-50%, -50%) scale(${mode === "3d" ? 0.9 + atom.depth * 0.25 : 1})`,
              }}
              title={`${atom.element} — ${elementFullName[atom.element] ?? atom.element} (${atom.id})`}
            >
              <span className="text-[9px] font-bold">{atom.element}</span>
            </button>
          ))}
          {/* Top-right info badge */}
          <div className="absolute right-2.5 top-2.5 rounded-lg border border-border bg-panel/90 px-2.5 py-1.5 text-[11px] shadow-sm">
            <div className="font-medium text-foreground">{model.atoms.length} atoms · {model.bonds.length} bonds</div>
            <div className="text-muted-foreground">Drag to reposition</div>
          </div>
          {/* Bottom-left element legend */}
          {(() => {
            const presentElements = [...new Set(model.atoms.map((a) => a.element))];
            return presentElements.length > 0 ? (
              <div className="absolute bottom-2 left-2.5 flex flex-wrap gap-1">
                {presentElements.map((el) => (
                  <span
                    key={el}
                    className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold shadow-sm ${
                      elementColor[el] || "bg-slate-500 text-white"
                    }`}
                    title={elementFullName[el] ?? el}
                  >
                    {el}
                  </span>
                ))}
              </div>
            ) : null;
          })()}
        </div>
      </div>

      {/* ── Canvas controls — below canvas to prevent any overlap ── */}
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground flex-1 min-w-[120px]">
          <span className="shrink-0 w-14">Rotation</span>
          <input type="range" min="-180" max="180" value={rotation} onChange={(event) => setRotation(Number(event.target.value))} className="w-full accent-primary" />
        </label>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground flex-1 min-w-[120px]">
          <span className="shrink-0 w-10">Spread</span>
          <input type="range" min="12" max="26" value={spread} onChange={(event) => setSpread(Number(event.target.value))} className="w-full accent-primary" />
        </label>
        <div className="flex gap-1.5 shrink-0">
          <button
            type="button"
            onClick={addAtom}
            className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary-soft px-2.5 py-1 text-[11px] text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            <Plus className="size-3" />
            Atom
          </button>
          <button
            type="button"
            onClick={() => { setModel(presets[presetIndex] || presets[0]); setRotation(18); setSpread(18); }}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-panel px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 transition-colors"
          >
            <RotateCw className="size-3" />
            Reset
          </button>
        </div>
      </div>

      {/* ── Protocol & experimental context ── */}
      <div className="grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
              <FlaskConical className="size-3.5 text-primary" />
              Experimental implication
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{model.note}</p>
            {protocolContext.hasProtocolSource && (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Anchored to protocol: <span className="font-medium text-foreground/75">{protocolContext.label}</span>
              </p>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {model.editableHint || "Drag atoms on the canvas or tune their coordinates to test alternate structural arrangements during planning."}
            </p>
          </div>

          {/* Validation gate display linked to molecules */}
          {plan.validation && plan.validation.decisionGates && plan.validation.decisionGates.length > 0 && (
            <div className="rounded-xl border border-primary/20 bg-primary-soft/40 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-primary">
                <ShieldCheck className="size-3.5" />
                Compound-level gates
              </div>
              <ul className="space-y-1.5">
                {plan.validation.decisionGates.slice(0, 3).map((gate) => (
                  <li key={gate} className="flex items-start gap-2 text-[11px] leading-relaxed text-foreground/80">
                    <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-success" />
                    {gate}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <div className="mb-2 text-[11px] font-semibold text-foreground">Scientist annotation</div>
            <textarea
              value={annotation}
              onChange={(event) => setAnnotation(event.target.value)}
              placeholder="Record how this structural view changes hypothesis, control choice, assay readout, or procurement decision..."
              className="min-h-20 w-full rounded-lg border border-border bg-panel px-3 py-2 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>

        <div className="space-y-3">
          {selectedAtom && (
            <div className="rounded-xl border border-border bg-muted/20 p-3 text-[11px]">
              <div className="mb-2 font-semibold text-foreground">Selected: {selectedAtom.id} ({selectedAtom.element})</div>
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <div className="mb-1 text-muted-foreground">Element</div>
                  <input
                    value={selectedAtom.element}
                    onChange={(event) => updateAtom(selectedAtom.id, { element: event.target.value.toUpperCase().slice(0, 2) })}
                    className="w-full rounded-lg border border-border bg-panel px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </label>
                <label>
                  <div className="mb-1 text-muted-foreground">Depth (Z)</div>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedAtom.z}
                    onChange={(event) => updateAtom(selectedAtom.id, { z: Number(event.target.value) })}
                    className="w-full rounded-lg border border-border bg-panel px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </label>
                <label>
                  <div className="mb-1 text-muted-foreground">X</div>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedAtom.x}
                    onChange={(event) => updateAtom(selectedAtom.id, { x: Number(event.target.value) })}
                    className="w-full rounded-lg border border-border bg-panel px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </label>
                <label>
                  <div className="mb-1 text-muted-foreground">Y</div>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedAtom.y}
                    onChange={(event) => updateAtom(selectedAtom.id, { y: Number(event.target.value) })}
                    className="w-full rounded-lg border border-border bg-panel px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </label>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border bg-muted/20 p-3 text-[11px]">
            <div className="mb-2 font-semibold text-foreground">Atom coordinates</div>
            <div className="max-h-36 overflow-y-auto rounded-lg border border-border bg-panel">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-panel">
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="px-2 py-1.5">Atom</th>
                    <th className="px-2 py-1.5">El</th>
                    <th className="px-2 py-1.5">X</th>
                    <th className="px-2 py-1.5">Y</th>
                    <th className="px-2 py-1.5">Z</th>
                  </tr>
                </thead>
                <tbody>
                  {model.atoms.map((atom) => (
                    <tr key={atom.id} className="border-b border-border/60 last:border-b-0 hover:bg-muted/20">
                      <td className="px-2 py-1 font-medium">{atom.id}</td>
                      <td className="px-2 py-1">{atom.element}</td>
                      <td className="px-2 py-1">{atom.x.toFixed(1)}</td>
                      <td className="px-2 py-1">{atom.y.toFixed(1)}</td>
                      <td className="px-2 py-1">{atom.z.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

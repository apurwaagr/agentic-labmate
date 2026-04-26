import { useEffect, useMemo, useRef, useState } from "react";
import { Atom, FlaskConical, Orbit, Plus, RotateCw } from "lucide-react";
import { moleculeForPlan, type ExperimentPlan, type MoleculeModel } from "@/lib/labApi";

const elementColor: Record<string, string> = {
  C: "bg-slate-700 text-white",
  O: "bg-rose-500 text-white",
  N: "bg-sky-500 text-white",
  S: "bg-amber-500 text-slate-950",
  H: "bg-slate-200 text-slate-950",
};

function rotateAtom(atom: MoleculeModel["atoms"][number], rotation: number) {
  const radians = (rotation * Math.PI) / 180;
  return {
    ...atom,
    x: atom.x * Math.cos(radians) - atom.z * Math.sin(radians),
    z: atom.x * Math.sin(radians) + atom.z * Math.cos(radians),
  };
}

function comparatorModelsForPlan(plan: ExperimentPlan, base: MoleculeModel) {
  const domain = plan.domain.toLowerCase();

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
    return [
      base,
      {
        name: "Whole-blood interferent cue",
        formula: "Matrix control",
        note: "Use this control view to reason about whole-blood matrix interference against the intended CRP binding surface.",
        editableHint: "Scientists can compare target and interferent arrangements while discussing selectivity risk.",
        atoms: [
          { id: "n1", element: "N", x: -0.8, y: -0.5, z: 0.1 },
          { id: "c1", element: "C", x: 0.2, y: -0.1, z: -0.1 },
          { id: "o1", element: "O", x: 1.3, y: -0.7, z: 0.2 },
          { id: "s1", element: "S", x: 0.7, y: 1.1, z: 0.1 },
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

export function MoleculeCard({ plan }: { plan: ExperimentPlan }) {
  const primaryModel = useMemo(() => moleculeForPlan(plan), [plan]);
  const presets = useMemo(() => comparatorModelsForPlan(plan, primaryModel), [plan, primaryModel]);
  const protocolContext = useMemo(() => protocolContextForPlan(plan), [plan]);
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
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {mode === "3d" ? <Orbit className="size-4 text-primary" /> : <Atom className="size-4 text-primary" />}
          <div>
            <h3 className="text-sm font-semibold">Molecular Workspace</h3>
            <p className="text-[11px] text-muted-foreground">
              {model.name} · {model.formula}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {protocolContext.hasProtocolSource && (
            <div className="rounded-full border border-primary/20 bg-primary-soft px-2.5 py-1 text-[11px] text-primary">
              Protocol source: {protocolContext.source}
            </div>
          )}
          <div className="flex rounded-full border border-border bg-muted/40 p-1 text-[11px]">
            <button
              type="button"
              onClick={() => setMode("2d")}
              className={`rounded-full px-2.5 py-1 ${mode === "2d" ? "bg-panel shadow-sm" : "text-muted-foreground"}`}
            >
              2D
            </button>
            <button
              type="button"
              onClick={() => setMode("3d")}
              className={`rounded-full px-2.5 py-1 ${mode === "3d" ? "bg-panel shadow-sm" : "text-muted-foreground"}`}
            >
              3D
            </button>
          </div>
        </div>
      </header>

      <div className="mb-3 grid gap-2">
        <div className="flex flex-wrap gap-2">
          {presets.map((preset, index) => (
            <button
              key={`${preset.name}-${index}`}
              type="button"
              onClick={() => setPresetIndex(index)}
              className={`rounded-full border px-3 py-1.5 text-[11px] ${presetIndex === index ? "border-primary/25 bg-primary-soft text-primary" : "border-border bg-panel"}`}
            >
              {index === 0 ? "Intervention" : "Comparator"}: {preset.name}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="rounded-xl border border-border bg-muted/20 px-3 py-2 text-[11px]">
            <div className="mb-1 text-muted-foreground">Rotation</div>
            <input type="range" min="-180" max="180" value={rotation} onChange={(event) => setRotation(Number(event.target.value))} className="w-full" />
          </label>
          <label className="rounded-xl border border-border bg-muted/20 px-3 py-2 text-[11px]">
            <div className="mb-1 text-muted-foreground">Spread</div>
            <input type="range" min="12" max="26" value={spread} onChange={(event) => setSpread(Number(event.target.value))} className="w-full" />
          </label>
          <div className="flex items-center justify-end gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2">
            <button
              type="button"
              onClick={addAtom}
              className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary-soft px-2.5 py-1 text-[11px] text-primary"
            >
              <Plus className="size-3" />
              Add atom
            </button>
            <button
              type="button"
              onClick={() => {
                setModel(presets[presetIndex] || presets[0]);
                setRotation(18);
                setSpread(18);
              }}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-panel px-2.5 py-1 text-[11px]"
            >
              <RotateCw className="size-3" />
              Reset
            </button>
          </div>
        </div>
      </div>

      <div
        ref={canvasRef}
        className="relative h-72 overflow-hidden rounded-2xl border border-border bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.96),rgba(228,236,248,0.88))]"
      >
        <div className="absolute inset-0 bg-[linear-gradient(transparent_95%,rgba(120,136,160,0.08)_95%),linear-gradient(90deg,transparent_95%,rgba(120,136,160,0.08)_95%)] bg-[size:32px_32px]" />
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {model.bonds.map((bond) => {
            const from = projectedAtoms.find((atom) => atom.id === bond.from);
            const to = projectedAtoms.find((atom) => atom.id === bond.to);
            if (!from || !to) {
              return null;
            }
            return (
              <g key={`${bond.from}-${bond.to}`}>
                <line
                  x1={from.left}
                  y1={from.top}
                  x2={to.left}
                  y2={to.top}
                  stroke="rgba(71,85,105,0.45)"
                  strokeWidth={mode === "3d" ? 1.8 + from.depth : 1.8}
                  strokeLinecap="round"
                />
                <text x={(from.left + to.left) / 2} y={(from.top + to.top) / 2 - 1.2} fontSize="2.6" textAnchor="middle" fill="rgba(71,85,105,0.7)">
                  bond
                </text>
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
              if (event.buttons === 1) {
                handleCanvasMove(event, atom.id);
              }
            }}
            className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border shadow-md ${elementColor[atom.element] || "bg-slate-500 text-white"} ${
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
            title={`${atom.element} (${atom.id})`}
          >
            <span className="text-[9px] font-semibold">{atom.element}</span>
          </button>
        ))}
        <div className="absolute right-3 top-3 rounded-xl border border-border bg-panel/90 px-3 py-2 text-[11px] shadow-sm">
          <div className="font-medium text-foreground">{model.atoms.length} atoms · {model.bonds.length} bonds</div>
          <div className="text-muted-foreground">Drag atoms to sketch changes</div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-foreground">
              <FlaskConical className="size-3.5 text-primary" />
              Experimental implication
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{model.note}</p>
            {protocolContext.hasProtocolSource && (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                This view is anchored to the active protocol context: {protocolContext.label}.
              </p>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {model.editableHint || "Drag atoms on the canvas or tune their coordinates to test alternate structural arrangements during planning."}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <div className="mb-2 text-[11px] font-medium text-foreground">Scientist annotation</div>
            <textarea
              value={annotation}
              onChange={(event) => setAnnotation(event.target.value)}
              placeholder="Record whether this structural view changes the hypothesis, control choice, assay readout, or procurement decision..."
              className="min-h-28 w-full rounded-lg border border-border bg-panel px-3 py-2 text-xs leading-relaxed"
            />
          </div>
        </div>

        <div className="space-y-3">
          {selectedAtom && (
            <div className="rounded-xl border border-border bg-muted/20 p-3 text-[11px]">
              <div className="mb-2 font-medium text-foreground">Selected atom: {selectedAtom.id}</div>
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <div className="mb-1 text-muted-foreground">Element</div>
                  <input
                    value={selectedAtom.element}
                    onChange={(event) => updateAtom(selectedAtom.id, { element: event.target.value.toUpperCase().slice(0, 2) })}
                    className="w-full rounded-lg border border-border bg-panel px-2 py-1.5 text-xs"
                  />
                </label>
                <label>
                  <div className="mb-1 text-muted-foreground">Depth</div>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedAtom.z}
                    onChange={(event) => updateAtom(selectedAtom.id, { z: Number(event.target.value) })}
                    className="w-full rounded-lg border border-border bg-panel px-2 py-1.5 text-xs"
                  />
                </label>
                <label>
                  <div className="mb-1 text-muted-foreground">X</div>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedAtom.x}
                    onChange={(event) => updateAtom(selectedAtom.id, { x: Number(event.target.value) })}
                    className="w-full rounded-lg border border-border bg-panel px-2 py-1.5 text-xs"
                  />
                </label>
                <label>
                  <div className="mb-1 text-muted-foreground">Y</div>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedAtom.y}
                    onChange={(event) => updateAtom(selectedAtom.id, { y: Number(event.target.value) })}
                    className="w-full rounded-lg border border-border bg-panel px-2 py-1.5 text-xs"
                  />
                </label>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border bg-muted/20 p-3 text-[11px]">
            <div className="mb-2 font-medium text-foreground">Coordinate table</div>
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
                    <tr key={atom.id} className="border-b border-border/60 last:border-b-0">
                      <td className="px-2 py-1.5 font-medium">{atom.id}</td>
                      <td className="px-2 py-1.5">{atom.element}</td>
                      <td className="px-2 py-1.5">{atom.x.toFixed(1)}</td>
                      <td className="px-2 py-1.5">{atom.y.toFixed(1)}</td>
                      <td className="px-2 py-1.5">{atom.z.toFixed(1)}</td>
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

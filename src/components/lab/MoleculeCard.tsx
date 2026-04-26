import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FlaskConical, Loader2, RotateCw } from "lucide-react";
import type { ExperimentPlan } from "@/lib/labApi";
import { Molecule3DViewer } from "@/components/lab/Molecule3DViewer";

// ─── Static lookup: common lab chemicals → PubChem CID
// Avoids hitting PubChem API for well-known compounds (rate-limit bypass)
const KNOWN_CIDS: Record<string, number> = {
  // Cryoprotectants / sugars
  "trehalose": 7427,
  "alpha,alpha-trehalose": 7427,
  "d-trehalose": 7427,
  "sucrose": 5988,
  "glucose": 5793,
  "glycerol": 753,
  "dmso": 679,
  "dimethyl sulfoxide": 679,
  "dmso, cell culture grade": 679,
  "pvp": 50155966,
  // Gold nanoparticle synthesis
  "haucl4": 28103,
  "hydrogen tetrachloroaurate": 28103,
  "chloroauric acid": 28103,
  "gold(iii) chloride": 72313068,
  "trisodium citrate": 16211978,
  "sodium citrate": 68641,
  "ascorbic acid": 54670067,
  "sodium borohydride": 4311764,
  "gold": 23985,
  "gold nanoparticles": 23985,
  "aunp": 23985,
  // Electrochemistry
  "3-mercaptopropionic acid": 2703,
  "mpa": 2703,
  "ferrocene": 9914,
  "edc": 2723794,
  "sulfo-nhs": 123595,
  "n-hydroxysuccinimide": 80170,
  "nhs": 80170,
  // Cell biology / diagnostics
  "fitc": 9880,
  "fluorescein isothiocyanate": 9880,
  "fitc-dextran": 9880,
  "dextran": 23615,
  "bsa": 16211978,
  "c-reactive protein": 10769,
  "crp": 10769,
  "acetate": 175,
  "acetic acid": 176,
  "carbon dioxide": 280,
  "co2": 280,
  // Solvents / reagents
  "ethanol": 702,
  "methanol": 887,
  "isopropanol": 3776,
  "isopropyl alcohol": 3776,
  "acetonitrile": 6342,
  "chloroform": 6212,
  "dichloromethane": 6344,
  "toluene": 1140,
  "hexane": 8058,
  "acetone": 180,
  "water": 962,
  "hydrogen peroxide": 784,
  "hydrochloric acid": 313,
  "sodium hydroxide": 14798,
  "potassium chloride": 4873,
  "sodium chloride": 5234,
  "phosphoric acid": 1004,
  "sulfuric acid": 1118,
  "nitric acid": 944,
  "ammonia": 222,
  // Other common lab chemicals
  "tween 20": 443314,
  "triton x-100": 5590,
  "pbs": 24978853,
  "tris": 64799,
  "hepes": 23831,
  "edta": 6049,
  "trypsin": 23682,
  "formalin": 712,
};

function knownCidLookup(name: string): number | null {
  const key = name.trim().toLowerCase();
  if (KNOWN_CIDS[key] != null) return KNOWN_CIDS[key];
  // Try stripping common qualifiers: "cell culture grade", "analytical grade", etc.
  const stripped = key
    .replace(/[,;].*$/, "")
    .replace(/\s+(grade|cell culture|anhydrous|reagent|analytical|technical|ultrapure|hplc|sterile|pure|feed|target|substrate|assembly|kit)\b.*/g, "")
    .trim();
  return KNOWN_CIDS[stripped] ?? null;
}

// ─── PubChem direct lookups (rate-limited — use knownCidLookup first) ─────────

let _pubchemQueue: (() => void)[] = [];
let _pubchemActive = 0;
const PUBCHEM_CONCURRENCY = 2;
const PUBCHEM_DELAY_MS = 500;

function pubchemThrottle<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    _pubchemQueue.push(() => {
      fn().then(resolve, reject).finally(() => {
        _pubchemActive--;
        setTimeout(_drainPubChem, PUBCHEM_DELAY_MS);
      });
    });
    _drainPubChem();
  });
}

function _drainPubChem() {
  while (_pubchemActive < PUBCHEM_CONCURRENCY && _pubchemQueue.length > 0) {
    const task = _pubchemQueue.shift()!;
    _pubchemActive++;
    task();
  }
}

async function pubchemCidByName(name: string): Promise<number | null> {
  // Static table first — no network call needed
  const static_cid = knownCidLookup(name);
  if (static_cid != null) return static_cid;

  return pubchemThrottle(async () => {
    try {
      const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/cids/JSON`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as { IdentifierList?: { CID?: number[] } };
      return data?.IdentifierList?.CID?.[0] ?? null;
    } catch {
      return null;
    }
  });
}

// ─── Image sources (waterfall: CID fast → CID PUG → name PUG → Cactus) ──────

function imgByCid(cid: number) {
  return `https://pubchem.ncbi.nlm.nih.gov/image/imgsrv.fcgi?cid=${cid}&t=l`;
}
function imgByCidPug(cid: number) {
  return `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/PNG?image_size=large`;
}
function imgByNamePubchem(name: string) {
  return `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/PNG?image_size=large`;
}
function imgByNameCactus(name: string) {
  return `https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(name)}/image`;
}
function imageSources(name: string, cid: number | null): string[] {
  const list: string[] = [];
  // Prefer CID-based URLs (stable, no name-resolution needed)
  const effectiveCid = cid ?? knownCidLookup(name);
  if (effectiveCid) { list.push(imgByCid(effectiveCid), imgByCidPug(effectiveCid)); }
  // Name-based fallbacks (only if no CID, to reduce PubChem traffic)
  if (!effectiveCid) {
    list.push(imgByNamePubchem(name), imgByNameCactus(name));
  }
  return Array.from(new Set(list));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolvedKey(name: string) { return name.trim().toLowerCase(); }

function likelyHas3D(name: string, formula?: string) {
  const n = name.toLowerCase();
  if (n.includes("nanoparticle") || n.includes("polymer") || n.includes("protein") || n.includes("antibody")) return false;
  const f = (formula ?? "").toUpperCase().trim();
  if (["AU", "AG", "PT", "FE", "CU", "ZN"].includes(f)) return false;
  return true;
}

function domainVisual(domain: string) {
  const d = domain.toLowerCase();
  if (d.includes("diagnostic") || d.includes("biosensor") || d.includes("immunoassay"))
    return { bg: "from-sky-50 to-indigo-50", icon: "🔬", label: "Diagnostic / Biosensor", accent: "text-sky-700" };
  if (d.includes("electrochemistry") || d.includes("electrode") || d.includes("electrosynthesis"))
    return { bg: "from-amber-50 to-orange-50", icon: "⚡", label: "Electrochemistry", accent: "text-amber-700" };
  if (d.includes("cell biology") || d.includes("cryopreservation") || d.includes("tissue"))
    return { bg: "from-emerald-50 to-teal-50", icon: "🧬", label: "Cell Biology", accent: "text-emerald-700" };
  if (d.includes("organic") || d.includes("synthesis") || d.includes("chemistry"))
    return { bg: "from-violet-50 to-purple-50", icon: "⚗️", label: "Organic Chemistry", accent: "text-violet-700" };
  if (d.includes("microbiome") || d.includes("microbiolog") || d.includes("gut"))
    return { bg: "from-lime-50 to-green-50", icon: "🦠", label: "Microbiology", accent: "text-lime-700" };
  if (d.includes("drug") || d.includes("pharmacol") || d.includes("therapeut"))
    return { bg: "from-rose-50 to-pink-50", icon: "💊", label: "Drug Discovery", accent: "text-rose-700" };
  if (d.includes("genomic") || d.includes("sequencing") || d.includes("pcr") || d.includes("dna"))
    return { bg: "from-cyan-50 to-blue-50", icon: "🧪", label: "Genomics / Mol. Biology", accent: "text-cyan-700" };
  return { bg: "from-slate-50 to-zinc-50", icon: "🔭", label: "Life Science", accent: "text-slate-600" };
}

// ─── StructureImage ───────────────────────────────────────────────────────────

function StructureImage({ name, cid, alt, className }: { name: string; cid?: number | null; alt: string; className: string }) {
  const sources = useMemo(() => imageSources(name, cid ?? null), [name, cid]);
  const [index, setIndex] = useState(0);
  useEffect(() => { setIndex(0); }, [name, cid]);

  if (index >= sources.length) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-muted/20">
        <FlaskConical className="size-5 text-muted-foreground/25" />
        <span className="text-[9px] text-muted-foreground/40 text-center px-1">No structure</span>
      </div>
    );
  }
  return (
    <img
      src={sources[index]}
      alt={alt}
      onError={() => setIndex(i => i + 1)}
      className={className}
      loading="lazy"
    />
  );
}

export function MoleculeCard({ plan }: { plan: ExperimentPlan }) {
  // CIDs resolved directly from PubChem REST API (no backend needed)
  const [resolvedCids, setResolvedCids] = useState<Record<string, number>>({}); // key = resolvedKey(name)
  const [resolvingNames, setResolvingNames] = useState<Set<string>>(new Set());
  const [active3D, setActive3D] = useState<{ cid: number; name: string } | null>(null);
  const [annotation, setAnnotation] = useState(() => {
    try { return localStorage.getItem(`mol-note-${plan.id}`) || ""; } catch { return ""; }
  });

  const visual = domainVisual(plan.domain);
  const materials = plan.materials;

  // Resolve CIDs: skip names already covered by the static lookup table
  useEffect(() => {
    let active = true;
    // Only hit PubChem for names NOT in the static table and NOT in the plan response
    const toResolve = materials
      .filter(m => !m.pubchemCid && knownCidLookup(m.name) == null)
      .map(m => m.name);
    if (!toResolve.length) return;

    setResolvingNames(new Set(toResolve));

    Promise.all(
      toResolve.map(async name => {
        const cid = await pubchemCidByName(name);
        return cid ? ([resolvedKey(name), cid] as const) : null;
      })
    ).then(results => {
      if (!active) return;
      setResolvingNames(new Set());
      setResolvedCids(prev => {
        const next = { ...prev };
        for (const r of results) if (r) next[r[0]] = r[1];
        return next;
      });
    });
    return () => { active = false; };
  }, [plan.id, materials]);

  // Merge: plan CID → static table → runtime resolved
  const enriched = useMemo(() => materials.map(m => {
    const cid = m.pubchemCid ?? knownCidLookup(m.name) ?? resolvedCids[resolvedKey(m.name)] ?? null;
    return { ...m, cid };
  }), [materials, resolvedCids]);

  // Only show spinner for names that aren't in the static table
  const isResolving = resolvingNames.size > 0;

  // Best compound for 3D viewer: first small molecule with a confirmed CID
  const best3DCompound = useMemo(() => {
    return enriched.find(m => m.cid != null && likelyHas3D(m.name, m.molecularFormula)) ?? null;
  }, [enriched]);

  const current3D = active3D ?? (best3DCompound ? { cid: best3DCompound.cid!, name: best3DCompound.name } : null);

  return (
    <section className="rounded-2xl border border-border bg-panel shadow-sm overflow-hidden">
      {/* Domain header */}
      <div className={`bg-gradient-to-r ${visual.bg} border-b border-border px-5 py-4`}>
        <div className="flex items-center gap-3">
          <span className="text-2xl select-none">{visual.icon}</span>
          <div className="min-w-0 flex-1">
            <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${visual.accent}`}>{visual.label}</span>
            <h3 className="mt-0.5 text-sm font-semibold leading-snug line-clamp-2">{plan.project}</h3>
            {plan.plainEnglish && (
              <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{plan.plainEnglish}</p>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* 3D Viewer — full width, shows best available compound */}
        {current3D ? (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/70">3D Molecular Structure</span>
                <span className="rounded-full border border-primary/20 bg-primary-soft px-2 py-0.5 text-[10px] text-primary font-medium">
                  {current3D.name}
                </span>
              </div>
              {best3DCompound && current3D.name !== best3DCompound.name && (
                <button
                  type="button"
                  onClick={() => setActive3D(null)}
                  className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                >
                  <RotateCw className="size-3" /> Reset
                </button>
              )}
            </div>
            <Molecule3DViewer cid={current3D.cid} label={current3D.name} className="w-full" />
            <p className="mt-1.5 text-[10px] text-muted-foreground/60">
              Click any compound tile below to switch the 3D view · Drag to rotate · Scroll to zoom
            </p>
          </div>
        ) : isResolving ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-5 flex items-center justify-center gap-3">
            <Loader2 className="size-4 animate-spin text-primary" />
            <p className="text-[11px] text-muted-foreground">Resolving compound identities from PubChem…</p>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-5 text-center">
            <FlaskConical className="mx-auto mb-2 size-7 text-muted-foreground/30" />
            <p className="text-[11px] text-muted-foreground">
              No 3D structure available — compound names could not be resolved in PubChem.
            </p>
          </div>
        )}

        {/* Compound tiles */}
        {enriched.length > 0 && (
          <div>
            <div className="mb-2.5 flex items-center gap-2">
              <FlaskConical className="size-3.5 text-primary" />
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/70">Experiment Compounds</span>
              <span className="rounded-full border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">{enriched.length}</span>
            </div>

            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
              {enriched.map((material) => {
                const isActive = current3D?.name === material.name;
                const canView3D = Boolean(material.cid && likelyHas3D(material.name, material.molecularFormula));
                const href = material.cid
                  ? `https://pubchem.ncbi.nlm.nih.gov/compound/${material.cid}`
                  : `https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(material.name)}`;
                return (
                  <div
                    key={`${material.name}-${material.cid ?? "x"}`}
                    className={`group rounded-xl border bg-panel overflow-hidden transition-all ${
                      isActive
                        ? "border-primary shadow-md ring-2 ring-primary/20"
                        : "border-border hover:border-primary/40 hover:shadow-sm"
                    }`}
                  >
                    {/* Structure image — clickable to switch 3D */}
                    <button
                      type="button"
                      disabled={!canView3D}
                      onClick={() => canView3D && setActive3D({ cid: material.cid!, name: material.name })}
                      className="block w-full h-28 bg-white border-b border-border overflow-hidden relative"
                      title={canView3D ? `View ${material.name} in 3D` : undefined}
                    >
                      <StructureImage
                        name={material.name}
                        cid={material.cid}
                        alt={`${material.name} structure`}
                        className="h-full w-full object-contain"
                      />
                      {canView3D && !isActive && (
                        <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/5 transition-colors flex items-end justify-center pb-1 opacity-0 group-hover:opacity-100">
                          <span className="rounded-full bg-primary/90 px-2 py-0.5 text-[9px] text-white font-medium">View in 3D</span>
                        </div>
                      )}
                      {isActive && (
                        <div className="absolute top-1 right-1 rounded-full bg-primary px-1.5 py-0.5 text-[8px] text-white font-bold">3D</div>
                      )}
                    </button>

                    {/* Info */}
                    <div className="p-2">
                      <div className="text-[11px] font-semibold leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                        {material.name}
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-1">
                        {material.molecularFormula
                          ? <span className="font-mono text-[9px] text-muted-foreground">{material.molecularFormula}</span>
                          : <span />}
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-0.5 text-[9px] text-primary hover:underline"
                        >
                          {material.cid ? `CID ${material.cid}` : "Search"}
                          <ExternalLink className="size-2.5" />
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {enriched.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-5 text-center">
            <FlaskConical className="mx-auto mb-2 size-7 text-muted-foreground/30" />
            <p className="text-xs font-medium text-foreground/60">No compounds yet</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Compounds will appear once the plan is generated.</p>
          </div>
        )}

        <textarea
          value={annotation}
          onChange={e => {
            setAnnotation(e.target.value);
            try { localStorage.setItem(`mol-note-${plan.id}`, e.target.value); } catch { /* ignore */ }
          }}
          placeholder="Scientist note — structural observations, alternative compounds, concerns…"
          rows={2}
          className="w-full rounded-xl border border-border bg-panel px-3 py-2.5 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
        />
      </div>
    </section>
  );
}



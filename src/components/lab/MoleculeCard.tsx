import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FlaskConical, Loader2, RotateCw } from "lucide-react";
import type { ExperimentPlan } from "@/lib/labApi";
import { Molecule3DViewer } from "@/components/lab/Molecule3DViewer";

// ─── PubChem direct lookups (no backend needed) ───────────────────────────────

async function pubchemCidByName(name: string): Promise<number | null> {
  try {
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/cids/JSON`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as { IdentifierList?: { CID?: number[] } };
    return data?.IdentifierList?.CID?.[0] ?? null;
  } catch {
    return null;
  }
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
  if (cid) { list.push(imgByCid(cid), imgByCidPug(cid)); }
  list.push(imgByNamePubchem(name), imgByNameCactus(name));
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
      crossOrigin="anonymous"
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

  // Resolve CIDs directly from PubChem for any material missing one
  useEffect(() => {
    let active = true;
    const toResolve = materials.filter(m => !m.pubchemCid).map(m => m.name);
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

  // Merge static CIDs from plan with dynamically resolved ones
  const enriched = useMemo(() => materials.map(m => {
    const cid = m.pubchemCid ?? resolvedCids[resolvedKey(m.name)] ?? null;
    return { ...m, cid };
  }), [materials, resolvedCids]);

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



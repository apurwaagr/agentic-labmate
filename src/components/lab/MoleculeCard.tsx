import { useEffect, useMemo, useState } from "react";
import { BookOpen, CheckCircle2, ExternalLink, FlaskConical, Search, ShieldCheck, Sparkles } from "lucide-react";
import { fetchCompoundResolution, type CompoundResolution, type ExperimentPlan } from "@/lib/labApi";
import { Molecule3DViewer } from "@/components/lab/Molecule3DViewer";

function compoundDbLinks(name: string) {
  const q = encodeURIComponent(name);
  return [
    { label: "PubChem", href: `https://pubchem.ncbi.nlm.nih.gov/compound/${q}` },
    { label: "ChEMBL", href: `https://www.ebi.ac.uk/chembl/compound_report_card/search/?q=${q}` },
    { label: "ChemSpider", href: `https://www.chemspider.com/Search.aspx?q=${q}` },
    { label: "KEGG", href: `https://www.genome.jp/dbget-bin/www_bfind_sub?mode=bfind&max_hit=10&dbkey=compound&keywords=${q}` },
  ];
}

function domainVisual(domain: string) {
  const d = domain.toLowerCase();
  if (d.includes("diagnostic") || d.includes("biosensor") || d.includes("immunoassay")) {
    return { bg: "from-sky-50 to-indigo-50", icon: "", label: "Diagnostic / Biosensor", subtitle: "Electrochemical surface functionalisation antibody-antigen binding", accent: "text-sky-700" };
  }
  if (d.includes("electrochemistry") || d.includes("electrode") || d.includes("electrosynthesis")) {
    return { bg: "from-amber-50 to-orange-50", icon: "", label: "Electrochemistry", subtitle: "Electron transfer catalytic reduction bioelectrosynthesis", accent: "text-amber-700" };
  }
  if (d.includes("cell biology") || d.includes("cryopreservation") || d.includes("tissue")) {
    return { bg: "from-emerald-50 to-teal-50", icon: "", label: "Cell Biology", subtitle: "Membrane stabilisation osmotic stress cryoprotection", accent: "text-emerald-700" };
  }
  if (d.includes("organic") || d.includes("synthesis") || d.includes("chemistry")) {
    return { bg: "from-violet-50 to-purple-50", icon: "", label: "Organic Chemistry", subtitle: "Reaction design reagent stoichiometry yield optimisation", accent: "text-violet-700" };
  }
  if (d.includes("microbiome") || d.includes("microbiolog") || d.includes("gut")) {
    return { bg: "from-lime-50 to-green-50", icon: "", label: "Microbiology", subtitle: "Microbial culture colonisation barrier integrity", accent: "text-lime-700" };
  }
  if (d.includes("drug") || d.includes("pharmacol") || d.includes("therapeut")) {
    return { bg: "from-rose-50 to-pink-50", icon: "", label: "Drug Discovery", subtitle: "Target engagement in-vitro ADMET hit-to-lead", accent: "text-rose-700" };
  }
  if (d.includes("genomic") || d.includes("sequencing") || d.includes("pcr") || d.includes("dna")) {
    return { bg: "from-cyan-50 to-blue-50", icon: "", label: "Genomics / Molecular Biology", subtitle: "Nucleic acid amplification sequencing primer design", accent: "text-cyan-700" };
  }
  return { bg: "from-slate-50 to-zinc-50", icon: "", label: "Life Science", subtitle: "Hypothesis-driven experimental design", accent: "text-slate-600" };
}

function structureImageUrl(cid: number) {
  return `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/PNG?image_size=large`;
}

function resolvedKey(name: string) {
  return name.trim().toLowerCase();
}

export function MoleculeCard({ plan }: { plan: ExperimentPlan }) {
  const [annotation, setAnnotation] = useState(() => {
    try {
      return localStorage.getItem(`agentic-labmate-molecule-note-${plan.id}`) || "";
    } catch {
      return "";
    }
  });
  const [activeTargetTab, setActiveTargetTab] = useState<"image" | "view3d">("image");
  const [resolvedByName, setResolvedByName] = useState<Record<string, CompoundResolution>>({});

  function saveAnnotation(value: string) {
    setAnnotation(value);
    try {
      localStorage.setItem(`agentic-labmate-molecule-note-${plan.id}`, value);
    } catch {
      // ignore localStorage errors
    }
  }

  const visual = domainVisual(plan.domain);
  const allMaterials = plan.materials;

  useEffect(() => {
    let active = true;

    const namesToResolve = new Set<string>();
    for (const material of plan.materials) {
      if (!material.pubchemCid) {
        namesToResolve.add(material.name);
      }
    }
    if (plan.targetCompound && !plan.targetCompound.pubchemCid) {
      namesToResolve.add(plan.targetCompound.name);
    }

    if (namesToResolve.size === 0) {
      return;
    }

    async function resolveMissingCompounds() {
      const requests = Array.from(namesToResolve).map(async (name) => {
        try {
          const result = await fetchCompoundResolution(name);
          return [resolvedKey(name), result] as const;
        } catch {
          return null;
        }
      });

      const results = await Promise.all(requests);
      if (!active) {
        return;
      }

      setResolvedByName((current) => {
        const next = { ...current };
        for (const item of results) {
          if (item) {
            next[item[0]] = item[1];
          }
        }
        return next;
      });
    }

    void resolveMissingCompounds();

    return () => {
      active = false;
    };
  }, [plan.id, plan.materials, plan.targetCompound]);

  const targetResolution = useMemo(() => {
    if (!plan.targetCompound) {
      return null;
    }
    return resolvedByName[resolvedKey(plan.targetCompound.name)] || null;
  }, [plan.targetCompound, resolvedByName]);

  const targetCid = plan.targetCompound?.pubchemCid ?? targetResolution?.pubchemCid ?? null;
  const pubchemMaterials = allMaterials.filter((material) => {
    const resolved = resolvedByName[resolvedKey(material.name)];
    return Boolean(material.pubchemCid || resolved?.pubchemCid);
  });

  return (
    <section className="rounded-2xl border border-border bg-panel shadow-sm overflow-hidden">
      <div className={`bg-gradient-to-r ${visual.bg} border-b border-border px-5 py-4`}>
        <div className="flex items-start gap-3">
          <div className="text-3xl leading-none select-none">{visual.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${visual.accent}`}>{visual.label}</span>
              <span className="text-[10px] text-muted-foreground">{visual.subtitle}</span>
            </div>
            <h3 className="mt-1 text-sm font-semibold leading-snug line-clamp-2">{plan.project}</h3>
            {plan.plainEnglish && (
              <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{plan.plainEnglish}</p>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {plan.targetCompound && (
          <div className="rounded-xl border-2 border-accent/30 bg-accent-soft/30 p-3.5">
            <div className="mb-2.5 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-foreground">
                <Sparkles className="size-3" />
                Target / Final Compound
              </div>
              {targetCid ? (
                <a
                  href={`https://pubchem.ncbi.nlm.nih.gov/compound/${targetCid}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-panel px-2 py-0.5 text-[10px] text-accent-foreground hover:bg-accent-soft transition-colors"
                >
                  <ExternalLink className="size-2.5" />
                  PubChem CID {targetCid}
                </a>
              ) : (
                <div className="flex gap-1 flex-wrap">
                  {compoundDbLinks(plan.targetCompound.name).map((db) => (
                    <a
                      key={db.label}
                      href={db.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-panel px-2 py-0.5 text-[10px] text-accent-foreground hover:bg-accent-soft transition-colors"
                    >
                      <Search className="size-2.5" />
                      {db.label}
                    </a>
                  ))}
                </div>
              )}
            </div>

            <div className="mb-2 inline-flex rounded-md border border-border bg-panel p-0.5">
              <button
                type="button"
                onClick={() => setActiveTargetTab("image")}
                className={`px-2.5 py-1 text-[10px] rounded ${activeTargetTab === "image" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                Compound Image
              </button>
              <button
                type="button"
                onClick={() => setActiveTargetTab("view3d")}
                className={`px-2.5 py-1 text-[10px] rounded ${activeTargetTab === "view3d" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                3D View
              </button>
            </div>

            <div className="flex gap-3 items-start">
              {activeTargetTab === "image" ? (
                targetCid ? (
                  <a href={`https://pubchem.ncbi.nlm.nih.gov/compound/${targetCid}`} target="_blank" rel="noreferrer" className="shrink-0">
                    <img
                      src={structureImageUrl(targetCid)}
                      alt={`${plan.targetCompound.name} 2D structure`}
                      className="h-28 w-28 rounded-xl border border-border bg-white object-contain shadow-sm hover:shadow-md transition-shadow"
                    />
                  </a>
                ) : (
                  <div className="shrink-0 flex h-28 w-28 items-center justify-center rounded-xl border border-dashed border-accent/30 bg-muted/20">
                    <FlaskConical className="size-8 text-accent/40" />
                  </div>
                )
              ) : targetCid ? (
                <Molecule3DViewer cid={targetCid} className="shrink-0 w-44" />
              ) : (
                <div className="shrink-0 w-44 h-44 rounded-xl border border-dashed border-accent/30 bg-muted/20 flex items-center justify-center text-[11px] text-muted-foreground text-center px-3">
                  3D view is unavailable until a resolvable structure ID is found.
                </div>
              )}

              <div className="space-y-1.5 text-xs min-w-0 flex-1">
                <div className="font-semibold text-sm leading-snug">{plan.targetCompound.name}</div>
                {plan.targetCompound.molecularFormula && (
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {plan.targetCompound.molecularFormula}
                    {plan.targetCompound.molecularWeight ? ` ${plan.targetCompound.molecularWeight.toFixed(1)} g/mol` : ""}
                  </div>
                )}
                {plan.targetCompound.iupacName && (
                  <div className="text-[11px] text-muted-foreground line-clamp-2 leading-snug" title={plan.targetCompound.iupacName}>
                    {plan.targetCompound.iupacName}
                  </div>
                )}
                {targetResolution?.usedAi && targetResolution?.resolvedName && (
                  <div className="text-[10px] text-muted-foreground rounded-md border border-border bg-panel px-2 py-1">
                    AI-resolved name: {targetResolution.resolvedName}
                  </div>
                )}
                {plan.targetCompound.literatureRef?.uri && (
                  <a
                    href={plan.targetCompound.literatureRef.uri}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary-soft px-2 py-0.5 text-[10px] text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                  >
                    <BookOpen className="size-2.5" />
                    <span className="max-w-[200px] truncate">{plan.targetCompound.literatureRef.title}</span>
                    <ExternalLink className="size-2.5 opacity-60" />
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {allMaterials.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <FlaskConical className="size-3 text-primary" />
              Project Compounds ({allMaterials.length})
              {pubchemMaterials.length > 0 && (
                <span className="text-[10px] font-normal text-muted-foreground/60">· {pubchemMaterials.length} structure-resolved</span>
              )}
            </div>

            <div className="flex gap-2.5 overflow-x-auto pb-1">
              {allMaterials.map((material) => {
                const resolved = resolvedByName[resolvedKey(material.name)];
                const cid = material.pubchemCid ?? resolved?.pubchemCid ?? null;
                return cid ? (
                  <a
                    key={`${material.name}-${cid}`}
                    href={material.sourceUri || `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-xl border border-border bg-panel p-2.5 w-[148px] hover:border-primary/40 hover:bg-primary-soft/20 hover:shadow-sm transition-all group"
                  >
                    <img
                      src={structureImageUrl(cid)}
                      alt={`${material.name} structure`}
                      className="mb-1.5 h-20 w-full rounded-lg border border-border bg-white object-contain group-hover:border-primary/30 transition-colors"
                    />
                    <div className="text-[11px] font-semibold leading-tight line-clamp-2 group-hover:text-primary transition-colors">{material.name}</div>
                    {material.molecularFormula && <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{material.molecularFormula}</div>}
                    <div className="mt-1 flex items-center justify-between gap-1">
                      {material.molecularWeight ? <span className="text-[10px] text-muted-foreground">{material.molecularWeight.toFixed(0)} g/mol</span> : <span />}
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-primary">CID {cid} <ExternalLink className="size-2.5" /></span>
                    </div>
                  </a>
                ) : (
                  <div key={material.name} className="shrink-0 rounded-xl border border-dashed border-border bg-muted/10 p-2.5 w-[148px]">
                    <div className="mb-1.5 flex h-20 w-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/20">
                      <FlaskConical className="size-6 text-muted-foreground/30" />
                    </div>
                    <div className="text-[11px] font-semibold leading-tight line-clamp-2">{material.name}</div>
                    {material.molecularFormula && <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{material.molecularFormula}</div>}
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {compoundDbLinks(material.name).slice(0, 2).map((db) => (
                        <a
                          key={db.label}
                          href={db.href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 rounded-full border border-primary/20 bg-primary-soft/30 px-1.5 py-0.5 text-[9px] text-primary hover:bg-primary-soft transition-colors"
                        >
                          <Search className="size-2" />
                          {db.label}
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {allMaterials.length === 0 && !plan.targetCompound && (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-center">
            <FlaskConical className="mx-auto mb-1.5 size-7 text-muted-foreground/40" />
            <div className="text-xs font-medium text-foreground/70">No compounds specified yet</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">Compound identities will appear here once the plan is generated.</div>
          </div>
        )}

        {plan.validation?.decisionGates && plan.validation.decisionGates.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <ShieldCheck className="size-3 text-primary" /> Compound Gates
            </div>
            <div className="flex flex-wrap gap-1.5">
              {plan.validation.decisionGates.slice(0, 4).map((gate) => (
                <span
                  key={gate}
                  title={gate}
                  className="inline-flex items-center gap-1 rounded-full border border-success/25 bg-success-soft px-2.5 py-1 text-[10px] text-success"
                >
                  <CheckCircle2 className="size-2.5 shrink-0" />
                  {gate.split(" ").slice(0, 6).join(" ")}
                </span>
              ))}
            </div>
          </div>
        )}

        <textarea
          value={annotation}
          onChange={(event) => saveAnnotation(event.target.value)}
          placeholder="Scientist note on compound context, structural concerns, or synthesis alternatives"
          rows={2}
          className="w-full rounded-lg border border-border bg-muted/20 px-2.5 py-2 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
        />
      </div>
    </section>
  );
}

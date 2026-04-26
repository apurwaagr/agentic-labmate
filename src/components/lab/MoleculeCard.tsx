import { useEffect, useMemo, useState } from "react";
import { BookOpen, CheckCircle2, ExternalLink, FlaskConical, Search, ShieldCheck, Sparkles } from "lucide-react";
import { fetchCompoundResolution, type CompoundResolution, type ExperimentPlan } from "@/lib/labApi";
import { Molecule3DViewer } from "@/components/lab/Molecule3DViewer";

function compoundDbLinks(name: string) {
  const q = encodeURIComponent(name);
  return [
    { label: "PubChem", href: `https://pubchem.ncbi.nlm.nih.gov/#query=${q}` },
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

function structureImageUrlFast(cid: number) {
  return `https://pubchem.ncbi.nlm.nih.gov/image/imgsrv.fcgi?cid=${cid}&t=l`;
}

function structureImageByNameUrl(name: string) {
  return `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/PNG?image_size=large`;
}

function structureImageByNameCactus(name: string) {
  return `https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(name)}/image`;
}

function likelyHas3D(name: string, formula?: string) {
  const n = name.toLowerCase();
  if (n.includes("nanoparticle") || n.includes("nanoparticles")) {
    return false;
  }
  const f = (formula || "").toUpperCase().trim();
  if (f === "AU" || f === "AG" || f === "PT") {
    return false;
  }
  return true;
}

function pubchemRef(name: string, cid?: number | null) {
  if (cid) {
    return `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`;
  }
  return `https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(name)}`;
}

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function StructureImage({
  name,
  cid,
  alt,
  className,
}: {
  name: string;
  cid?: number | null;
  alt: string;
  className: string;
}) {
  // Priority: imgsrv (fastest) → PUG PNG → name-based PUG → NCI Cactus (most reliable fallback)
  const sources = uniq([
    cid ? structureImageUrlFast(cid) : "",
    cid ? structureImageUrl(cid) : "",
    structureImageByNameUrl(name),
    structureImageByNameCactus(name),
  ]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [name, cid]);

  if (sources.length === 0 || index >= sources.length) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/30">
        <FlaskConical className="size-5 text-muted-foreground/30" />
        <span className="text-[9px] text-muted-foreground/50 px-2 text-center leading-tight">Structure unavailable</span>
      </div>
    );
  }

  return (
    <img
      src={sources[index]}
      alt={alt}
      onError={() => setIndex((current) => current + 1)}
      className={className}
      loading="lazy"
      crossOrigin="anonymous"
    />
  );
}

function resolvedKey(name: string) {
  return name.trim().toLowerCase();
}

function roleTone(role: string) {
  if (role === "product") {
    return "border-success/25 bg-success-soft text-success";
  }
  if (role === "intermediate") {
    return "border-warning/25 bg-warning-soft text-warning";
  }
  return "border-primary/25 bg-primary-soft text-primary";
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
  const compoundMap = plan.compoundMap || [];

  useEffect(() => {
    let active = true;

    const namesToResolve = new Set<string>();
    for (const material of plan.materials) {
      if (!material.pubchemCid) {
        namesToResolve.add(material.name);
      }
    }
    for (const item of compoundMap) {
      if (!item.pubchemCid) {
        namesToResolve.add(item.name);
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
  }, [plan.id, plan.materials, plan.targetCompound, compoundMap]);

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
  const compoundReferences = useMemo(() => {
    const rows: Array<{ name: string; role: string; href: string }> = [];
    const seen = new Set<string>();

    for (const material of allMaterials) {
      const resolved = resolvedByName[resolvedKey(material.name)];
      const cid = material.pubchemCid ?? resolved?.pubchemCid ?? null;
      const key = `material:${material.name.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ name: material.name, role: "material", href: material.sourceUri || pubchemRef(material.name, cid) });
      }
    }

    for (const item of compoundMap) {
      const resolved = resolvedByName[resolvedKey(item.name)];
      const cid = item.pubchemCid ?? resolved?.pubchemCid ?? null;
      const key = `map:${item.name.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ name: item.name, role: item.role, href: item.sourceUri || pubchemRef(item.name, cid) });
      }
    }

    if (plan.targetCompound?.name) {
      const resolved = resolvedByName[resolvedKey(plan.targetCompound.name)];
      const cid = plan.targetCompound.pubchemCid ?? resolved?.pubchemCid ?? null;
      const key = `target:${plan.targetCompound.name.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ name: plan.targetCompound.name, role: "target", href: pubchemRef(plan.targetCompound.name, cid) });
      }
    }

    return rows;
  }, [allMaterials, compoundMap, plan.targetCompound, resolvedByName]);

  const best3D = useMemo(() => {
    const candidates: Array<{ cid: number; name: string; formula?: string }> = [];

    if (plan.targetCompound?.name && targetCid) {
      candidates.push({
        cid: targetCid,
        name: plan.targetCompound.name,
        formula: plan.targetCompound.molecularFormula,
      });
    }

    for (const item of compoundMap) {
      const resolved = resolvedByName[resolvedKey(item.name)];
      const cid = item.pubchemCid ?? resolved?.pubchemCid ?? null;
      if (cid) {
        candidates.push({ cid, name: item.name, formula: item.molecularFormula });
      }
    }

    for (const material of allMaterials) {
      const resolved = resolvedByName[resolvedKey(material.name)];
      const cid = material.pubchemCid ?? resolved?.pubchemCid ?? null;
      if (cid) {
        candidates.push({ cid, name: material.name, formula: material.molecularFormula });
      }
    }

    return candidates.find((entry) => likelyHas3D(entry.name, entry.formula)) || candidates[0] || null;
  }, [allMaterials, compoundMap, plan.targetCompound, resolvedByName, targetCid]);

  return (
    <section className="rounded-2xl border border-border bg-panel shadow-sm overflow-hidden">
      {/* Domain header — gradient accent strip */}
      <div className={`bg-gradient-to-r ${visual.bg} border-b border-border px-5 py-4`}>
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/60 bg-white/70 shadow-sm text-lg select-none">{visual.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-bold uppercase tracking-[0.18em] ${visual.accent}`}>{visual.label}</span>
              <span className="text-[9px] text-muted-foreground/70 hidden sm:inline">{visual.subtitle}</span>
            </div>
            <h3 className="mt-0.5 text-sm font-semibold leading-snug line-clamp-2">{plan.project}</h3>
            {plan.plainEnglish && (
              <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{plan.plainEnglish}</p>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-5">
        {plan.targetCompound && (
          <div className="rounded-2xl border-2 border-accent/40 bg-accent-soft/20 overflow-hidden">
            {/* Target compound header row */}
            <div className="flex items-center justify-between gap-2 flex-wrap border-b border-accent/20 bg-accent-soft/30 px-4 py-2.5">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-accent">
                <Sparkles className="size-3" />
                Target / Final Compound
              </div>
              {targetCid ? (
                <a
                  href={`https://pubchem.ncbi.nlm.nih.gov/compound/${targetCid}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-white/60 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent hover:text-accent-foreground transition-colors"
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
                      className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-white/60 px-2 py-0.5 text-[10px] text-accent hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      <Search className="size-2.5" />
                      {db.label}
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Tab toggle */}
            <div className="flex border-b border-accent/15">
              <button
                type="button"
                onClick={() => setActiveTargetTab("image")}
                className={`flex-1 py-2 text-[11px] font-medium transition-colors ${
                  activeTargetTab === "image"
                    ? "bg-white text-accent border-b-2 border-accent"
                    : "text-muted-foreground hover:text-foreground bg-accent-soft/10"
                }`}
              >
                Structure Image
              </button>
              <button
                type="button"
                onClick={() => setActiveTargetTab("view3d")}
                className={`flex-1 py-2 text-[11px] font-medium transition-colors ${
                  activeTargetTab === "view3d"
                    ? "bg-white text-accent border-b-2 border-accent"
                    : "text-muted-foreground hover:text-foreground bg-accent-soft/10"
                }`}
              >
                3D Viewer
              </button>
            </div>

            {/* Content area */}
            <div className="p-3.5">
              {activeTargetTab === "image" ? (
                <div className="flex gap-4 items-start">
                  {/* Image */}
                  <div className="shrink-0">
                    {targetCid ? (
                      <a href={`https://pubchem.ncbi.nlm.nih.gov/compound/${targetCid}`} target="_blank" rel="noreferrer">
                        <StructureImage
                          name={plan.targetCompound.name}
                          cid={targetCid}
                          alt={`${plan.targetCompound.name} 2D structure`}
                          className="h-40 w-40 rounded-xl border border-border bg-white object-contain shadow-md hover:shadow-lg transition-shadow"
                        />
                      </a>
                    ) : (
                      <a href={`https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(plan.targetCompound.name)}`} target="_blank" rel="noreferrer">
                        <StructureImage
                          name={plan.targetCompound.name}
                          alt={`${plan.targetCompound.name} structure`}
                          className="h-40 w-40 rounded-xl border border-border bg-white object-contain shadow-md hover:shadow-lg transition-shadow"
                        />
                      </a>
                    )}
                  </div>

                  {/* Compound metadata */}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="font-semibold text-sm leading-snug">{plan.targetCompound.name}</div>
                    {plan.targetCompound.molecularFormula && (
                      <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1">
                        <span className="font-mono text-[11px] font-semibold text-foreground">{plan.targetCompound.molecularFormula}</span>
                        {plan.targetCompound.molecularWeight && (
                          <span className="text-[10px] text-muted-foreground">{plan.targetCompound.molecularWeight.toFixed(1)} g/mol</span>
                        )}
                      </div>
                    )}
                    {plan.targetCompound.iupacName && (
                      <div className="text-[10px] text-muted-foreground leading-snug line-clamp-3" title={plan.targetCompound.iupacName}>
                        <span className="font-medium text-muted-foreground/80">IUPAC: </span>{plan.targetCompound.iupacName}
                      </div>
                    )}
                    {targetResolution?.usedAi && targetResolution?.resolvedName && (
                      <div className="text-[10px] text-muted-foreground rounded-md border border-border bg-panel px-2 py-1">
                        AI-resolved: {targetResolution.resolvedName}
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
                        <span className="max-w-[180px] truncate">{plan.targetCompound.literatureRef.title}</span>
                        <ExternalLink className="size-2.5 opacity-60" />
                      </a>
                    )}
                  </div>
                </div>
              ) : best3D?.cid ? (
                <div>
                  <Molecule3DViewer
                    cid={best3D.cid}
                    label={best3D.name}
                    className="w-full"
                  />
                  {plan.targetCompound?.name !== best3D.name && (
                    <div className="mt-1.5 text-[10px] text-muted-foreground/70">
                      Showing conformer for {best3D.name} (best resolvable compound for this project)
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-44 rounded-xl border border-dashed border-accent/30 bg-muted/20 flex flex-col items-center justify-center gap-2 text-[11px] text-muted-foreground text-center px-3">
                  <div className="text-2xl">🧪</div>
                  3D view is unavailable until a resolvable structure ID is found.
                </div>
              )}
            </div>
          </div>
        )}

        {allMaterials.length > 0 && (
          <div>
            <div className="mb-2.5 flex items-center gap-1.5">
              <FlaskConical className="size-3.5 text-primary" />
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/70">Project Compounds</span>
              <span className="rounded-full border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">{allMaterials.length}</span>
              {pubchemMaterials.length > 0 && (
                <span className="hidden sm:inline text-[10px] text-muted-foreground/60">{pubchemMaterials.length} structure-resolved</span>
              )}
            </div>

            <div className="flex gap-3 overflow-x-auto pb-2">
              {allMaterials.map((material) => {
                const resolved = resolvedByName[resolvedKey(material.name)];
                const cid = material.pubchemCid ?? resolved?.pubchemCid ?? null;
                const href = material.sourceUri || (cid ? `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}` : `https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(material.name)}`);
                return (
                  <a
                    key={`${material.name}-${cid ?? "noid"}`}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="group shrink-0 w-[160px] rounded-xl border border-border bg-panel p-2.5 hover:border-primary/40 hover:shadow-md transition-all"
                  >
                    <div className="mb-2 h-24 w-full overflow-hidden rounded-lg border border-border bg-white shadow-sm group-hover:border-primary/30 transition-colors">
                      <StructureImage
                        name={material.name}
                        cid={cid}
                        alt={`${material.name} structure`}
                        className="h-full w-full object-contain"
                      />
                    </div>
                    <div className="text-[11px] font-semibold leading-tight line-clamp-2 group-hover:text-primary transition-colors">{material.name}</div>
                    <div className="mt-1 flex items-center justify-between gap-1">
                      {material.molecularFormula
                        ? <span className="font-mono text-[10px] text-muted-foreground">{material.molecularFormula}</span>
                        : <span />}
                      {cid
                        ? <span className="inline-flex items-center gap-0.5 text-[10px] text-primary">CID {cid} <ExternalLink className="size-2.5" /></span>
                        : <span className="inline-flex items-center gap-0.5 text-[10px] text-primary"><Search className="size-2.5" />Search</span>}
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {compoundMap.length > 0 && (
          <div>
            <div className="mb-2.5 flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-primary" />
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/70">Hypothesis Compound Map</span>
              <span className="rounded-full border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">{compoundMap.length}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {compoundMap.map((item) => {
                const resolved = resolvedByName[resolvedKey(item.name)];
                const cid = item.pubchemCid ?? resolved?.pubchemCid ?? null;
                const href = cid
                  ? `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`
                  : `https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(item.name)}`;
                return (
                  <a
                    key={`${item.role}-${item.name}`}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="group rounded-xl border border-border bg-panel overflow-hidden hover:border-primary/30 hover:shadow-md transition-all"
                  >
                    {/* Image header */}
                    <div className="h-28 w-full border-b border-border bg-white flex items-center justify-center overflow-hidden">
                      <StructureImage
                        name={item.name}
                        cid={cid}
                        alt={`${item.name} structure`}
                        className="h-full w-full object-contain"
                      />
                    </div>
                    {/* Info footer */}
                    <div className="p-2.5">
                      <div className="mb-1 flex items-center justify-between gap-1">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${roleTone(item.role)}`}>
                          {item.role}
                        </span>
                        {cid && (
                          <span className="text-[10px] text-muted-foreground">CID {cid}</span>
                        )}
                      </div>
                      <div className="text-[11px] font-semibold leading-snug line-clamp-2 group-hover:text-primary transition-colors">{item.name}</div>
                      {item.molecularFormula && (
                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{item.molecularFormula}</div>
                      )}
                      {item.rationale && (
                        <div className="mt-1 text-[10px] text-muted-foreground/80 leading-relaxed line-clamp-2">{item.rationale}</div>
                      )}
                    </div>
                  </a>
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
            <div className="mb-2 flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-success" />
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/70">Compound Gates</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {plan.validation.decisionGates.slice(0, 4).map((gate) => (
                <span
                  key={gate}
                  title={gate}
                  className="inline-flex items-center gap-1 rounded-full border border-success/25 bg-success-soft px-2.5 py-1 text-[10px] font-medium text-success"
                >
                  <CheckCircle2 className="size-2.5 shrink-0" />
                  {gate.split(" ").slice(0, 6).join(" ")}
                </span>
              ))}
            </div>
          </div>
        )}

        {compoundReferences.length > 0 && (
          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <BookOpen className="size-3.5 text-primary" />
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/70">Compound References</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {compoundReferences.slice(0, 12).map((ref) => (
                <a
                  key={`${ref.role}-${ref.name}`}
                  href={ref.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-panel px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary hover:text-primary-foreground transition-colors shadow-sm"
                  title={`${ref.role}: ${ref.name}`}
                >
                  <span className="max-w-[160px] truncate">{ref.name}</span>
                  <ExternalLink className="size-2.5 shrink-0" />
                </a>
              ))}
            </div>
          </div>
        )}

        <textarea
          value={annotation}
          onChange={(event) => saveAnnotation(event.target.value)}
          placeholder="Scientist note — compound context, structural concerns or synthesis alternatives…"
          rows={2}
          className="w-full rounded-xl border border-border bg-panel px-3 py-2.5 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none shadow-sm"
        />
      </div>
    </section>
  );
}

import { useEffect, useRef, useState, useCallback } from "react";
import { RotateCcw, Pause, Play, Maximize2, ZoomIn } from "lucide-react";

type ViewerStyle = "ballstick" | "stick" | "sphere";

declare global {
  interface Window {
    $3Dmol?: {
      createViewer: (element: HTMLElement, config: { backgroundColor: string }) => Viewer3D;
    };
  }
}

interface Viewer3D {
  clear: () => void;
  addModel: (data: string, format: string) => void;
  setStyle: (selection: Record<string, never>, style: Record<string, unknown>) => void;
  zoomTo: () => void;
  spin: (enabled: boolean | string, speed?: number) => void;
  render: () => void;
  resize: () => void;
}

let scriptPromise: Promise<void> | null = null;

function ensure3DmolLoaded() {
  if (window.$3Dmol) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://3dmol.org/build/3Dmol-min.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load 3Dmol"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

function styleConfig(style: ViewerStyle): Record<string, unknown> {
  if (style === "sphere") return { sphere: { colorscheme: "Jmol", scale: 0.45 } };
  if (style === "stick") return { stick: { colorscheme: "Jmol", radius: 0.15 } };
  // ball-and-stick (default)
  return {
    stick: { colorscheme: "Jmol", radius: 0.12 },
    sphere: { colorscheme: "Jmol", scale: 0.32 },
  };
}

function normalizedCompoundName(label?: string): string {
  if (!label) return "";
  const cleaned = label
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[,;].*$/, "")
    .replace(/\b(cell culture|analytical|anhydrous|reagent|grade|technical|ultrapure|hplc|sterile|pure)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned === "dmso") return "dimethyl sulfoxide";
  return cleaned;
}

function no3dReason(label?: string): { title: string; detail: string } {
  const name = (label || "").toLowerCase();

  if (/dextran|polymer|peg|pvp|nanoparticle|aunp|colloid/.test(name)) {
    return {
      title: "3D structure unavailable for this material.",
      detail: "Polymeric or colloidal materials often do not have a single canonical small-molecule 3D conformer.",
    };
  }

  if (/protein|antibody|cell|hela|culture|bacteria|microbe/.test(name)) {
    return {
      title: "3D structure unavailable for this material.",
      detail: "Biological entities are typically not represented as one small-molecule conformer in PubChem-style 3D viewers.",
    };
  }

  if (/carbon dioxide|\bco2\b/.test(name)) {
    return {
      title: "3D structure temporarily unavailable from external providers.",
      detail: "This is a valid small molecule. If PubChem is rate-limited, retry shortly and the viewer should recover.",
    };
  }

  return {
    title: "3D structure unavailable for this compound.",
    detail: "If this is a nanoparticle, polymer, or biologic material, a rotatable small-molecule conformer may not exist.",
  };
}

function staticSdfFallback(cid: number, label?: string): string | null {
  const name = (label || "").toLowerCase();

  // Stable fallback for common gases when upstream SDF providers are rate-limited.
  if (cid === 280 || /carbon dioxide|\bco2\b/.test(name)) {
    return [
      "Carbon dioxide",
      "  Copilot-Static-2D",
      "",
      "  3  2  0  0  0  0            999 V2000",
      "   -1.2990    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
      "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    1.2990    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  2  2  0  0  0  0",
      "  2  3  2  0  0  0  0",
      "M  END",
      "$$$$",
    ].join("\n");
  }

  return null;
}

export function Molecule3DViewer({
  cid,
  className,
  label,
}: {
  cid: number;
  className?: string;
  label?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer3D | null>(null);
  const sdfRef = useRef<string>("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [spinning, setSpinning] = useState(false);
  const [viewStyle, setViewStyle] = useState<ViewerStyle>("ballstick");
  const [used3D, setUsed3D] = useState(false);

  // Apply current style without re-fetching SDF
  const applyStyle = useCallback((v: Viewer3D, style: ViewerStyle) => {
    v.setStyle({} as Record<string, never>, styleConfig(style));
    v.render();
  }, []);

  // Build / rebuild viewer whenever cid changes
  useEffect(() => {
    let active = true;
    setStatus("loading");
    setSpinning(false);
    setUsed3D(false);
    viewerRef.current = null;
    sdfRef.current = "";

    async function render3D() {
      try {
        await ensure3DmolLoaded();

        // Route through local API proxy first (cached, avoids browser rate-limits on PubChem).
        // Falls back through NCI Cactus, then direct PubChem.
        const normalizedLabel = normalizedCompoundName(label);
        const labelCandidates = [label?.trim() || "", normalizedLabel].filter(Boolean);
        const encodedLabelCandidates = Array.from(new Set(labelCandidates.map((n) => encodeURIComponent(n))));
        const urlList: { url: string; is3d: boolean }[] = [
          ...encodedLabelCandidates.map((encodedName) => ({
            url: `/api/compound/sdf?cid=${cid}&type=3d&name=${encodedName}`,
            is3d: true,
          })),
          ...encodedLabelCandidates.map((encodedName) => ({
            url: `/api/compound/sdf?cid=${cid}&name=${encodedName}`,
            is3d: false,
          })),
          ...encodedLabelCandidates.map((encodedName) => ({
            url: `https://cactus.nci.nih.gov/chemical/structure/${encodedName}/sdf`,
            is3d: true,
          })),
          { url: `/api/compound/sdf?cid=${cid}&type=3d`, is3d: true },
          { url: `/api/compound/sdf?cid=${cid}`, is3d: false },
          { url: `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF?record_type=3d`, is3d: true },
          { url: `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF`, is3d: false },
        ];

        let sdf = "";
        let got3D = false;
        for (const entry of urlList) {
          try {
            const res = await fetch(entry.url);
            if (!res.ok) continue;
            const text = await res.text();
            // Reject HTML error pages or JSON error objects; valid SDF must contain newlines
            if (!text || text.trim().startsWith("<") || text.trim().startsWith("{")) continue;
            if (!text.includes("\n")) continue;
            sdf = text;
            got3D = entry.is3d;
            break;
          } catch {
            continue;
          }
        }

        if (!sdf) {
          const fallbackSdf = staticSdfFallback(cid, label);
          if (fallbackSdf) {
            sdf = fallbackSdf;
            got3D = false;
          }
        }

        if (!sdf) throw new Error("No SDF available");
        if (!active || !hostRef.current || !window.$3Dmol) return;

        sdfRef.current = sdf;
        // Dark navy background - professional mol-vis standard
        const viewer = window.$3Dmol.createViewer(hostRef.current, {
          backgroundColor: "#0d1117",
        });
        viewer.clear();
        viewer.addModel(sdf, "sdf");
        applyStyle(viewer, "ballstick");
        viewer.zoomTo();
        viewer.spin(false);
        viewer.render();
        viewerRef.current = viewer;
        setUsed3D(got3D);
        setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    }

    void render3D();
    return () => { active = false; };
  }, [cid, applyStyle]);

  // Style toggle (no re-fetch)
  function cycleStyle() {
    const order: ViewerStyle[] = ["ballstick", "stick", "sphere"];
    const next = order[(order.indexOf(viewStyle) + 1) % order.length];
    setViewStyle(next);
    if (viewerRef.current) applyStyle(viewerRef.current, next);
  }

  // Spin toggle
  function toggleSpin() {
    const next = !spinning;
    setSpinning(next);
    viewerRef.current?.spin(next ? "y" : false);
    viewerRef.current?.render();
  }

  // Reset view
  function resetView() {
    viewerRef.current?.zoomTo();
    viewerRef.current?.render();
  }

  const styleLabel = { ballstick: "Ball & Stick", stick: "Stick", sphere: "Space Fill" }[viewStyle];
  const unavailable = no3dReason(label);

  return (
    <div className={`relative overflow-hidden rounded-xl ${className ?? ""}`}>
      {/* Viewer canvas */}
      <div
        ref={hostRef}
        className="w-full h-60 rounded-xl bg-[#0d1117]"
        style={{ minHeight: "15rem" }}
      />

      {/* Loading overlay */}
      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-[#0d1117]">
          <div className="mb-2 h-8 w-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
          <span className="text-[11px] text-slate-400">Loading 3D conformer…</span>
        </div>
      )}

      {/* Error overlay */}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-[#0d1117]">
          <div className="text-2xl">🧪</div>
          <span className="text-[11px] text-slate-400 text-center px-4">
            {unavailable.title}
            <br />
            {unavailable.detail}
          </span>
        </div>
      )}

      {/* Controls bar (shown when ready) */}
      {status === "ready" && (
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-1 rounded-b-xl bg-gradient-to-t from-[#0d1117]/90 to-transparent px-2.5 py-2">
          {/* Left: CID + conformer badge */}
          <div className="flex items-center gap-1.5 min-w-0">
            {label && (
              <span className="truncate max-w-[120px] text-[10px] text-slate-300 font-medium">{label}</span>
            )}
            {used3D && (
              <span className="shrink-0 rounded-full bg-emerald-500/20 border border-emerald-500/30 px-1.5 py-0.5 text-[9px] text-emerald-400">3D</span>
            )}
          </div>

          {/* Right: controls */}
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={cycleStyle}
              title={`Style: ${styleLabel}`}
              className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-300 hover:bg-white/15 transition-colors"
            >
              <ZoomIn className="size-2.5" />
              {styleLabel}
            </button>
            <button
              type="button"
              onClick={resetView}
              title="Reset view"
              className="flex size-6 items-center justify-center rounded-md border border-white/10 bg-white/5 text-slate-300 hover:bg-white/15 transition-colors"
            >
              <RotateCcw className="size-3" />
            </button>
            <button
              type="button"
              onClick={toggleSpin}
              title={spinning ? "Stop rotation" : "Auto-rotate"}
              className={`flex size-6 items-center justify-center rounded-md border transition-colors ${
                spinning
                  ? "border-primary/40 bg-primary/20 text-primary"
                  : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/15"
              }`}
            >
              {spinning ? <Pause className="size-3" /> : <Play className="size-3" />}
            </button>
          </div>
        </div>
      )}

      {/* Top-right: resize hint */}
      {status === "ready" && (
        <div className="absolute top-2 right-2 pointer-events-none">
          <Maximize2 className="size-3 text-white/20" />
        </div>
      )}
    </div>
  );
}

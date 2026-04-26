import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    $3Dmol?: {
      createViewer: (element: HTMLElement, config: { backgroundColor: string }) => {
        clear: () => void;
        addModel: (data: string, format: string) => void;
        setStyle: (selection: Record<string, never>, style: Record<string, unknown>) => void;
        zoomTo: () => void;
        spin: (enabled: boolean) => void;
        render: () => void;
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function ensure3DmolLoaded() {
  if (window.$3Dmol) {
    return Promise.resolve();
  }

  if (scriptPromise) {
    return scriptPromise;
  }

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://3dmol.org/build/3Dmol-min.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load 3Dmol viewer library"));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export function Molecule3DViewer({ cid, className }: { cid: number; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [used3DConformer, setUsed3DConformer] = useState(false);

  useEffect(() => {
    let active = true;

    async function render3D() {
      try {
        setStatus("loading");
        setUsed3DConformer(false);
        await ensure3DmolLoaded();

        const urls = [
          `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF?record_type=3d`,
          `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF`,
        ];

        let sdf = "";
        let got3D = false;
        for (const [index, url] of urls.entries()) {
          const response = await fetch(url);
          if (!response.ok) {
            continue;
          }
          sdf = await response.text();
          got3D = index === 0;
          break;
        }

        if (!sdf) {
          throw new Error("No model available");
        }

        if (!active || !hostRef.current || !window.$3Dmol) {
          return;
        }

        const viewer = window.$3Dmol.createViewer(hostRef.current, { backgroundColor: "white" });
        viewer.clear();
        viewer.addModel(sdf, "sdf");
        viewer.setStyle({}, { stick: { radius: 0.18 }, sphere: { scale: 0.3 } });
        viewer.zoomTo();
        viewer.spin(false);
        viewer.render();
        setUsed3DConformer(got3D);
        setStatus("ready");
      } catch {
        if (active) {
          setStatus("error");
        }
      }
    }

    void render3D();

    return () => {
      active = false;
    };
  }, [cid]);

  return (
    <div className={className}>
      <div ref={hostRef} className="h-44 w-full rounded-xl border border-border bg-white" />
      {status === "loading" && <div className="mt-1 text-[10px] text-muted-foreground">Loading 3D structure...</div>}
      {status === "error" && <div className="mt-1 text-[10px] text-warning">3D structure is not available for this compound.</div>}
      {status === "ready" && (
        <div className="mt-1 text-[10px] text-muted-foreground">
          {used3DConformer
            ? "Interactive 3D conformer loaded. Drag to rotate and scroll to zoom."
            : "Interactive model loaded from available structural record (full 3D conformer was not provided)."}
        </div>
      )}
    </div>
  );
}

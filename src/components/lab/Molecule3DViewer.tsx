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

  useEffect(() => {
    let active = true;

    async function render3D() {
      try {
        setStatus("loading");
        await ensure3DmolLoaded();

        const response = await fetch(
          `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF?record_type=3d`,
        );

        if (!response.ok) {
          throw new Error("3D conformer not available");
        }

        const sdf = await response.text();
        if (!active || !hostRef.current || !window.$3Dmol) {
          return;
        }

        const viewer = window.$3Dmol.createViewer(hostRef.current, { backgroundColor: "white" });
        viewer.clear();
        viewer.addModel(sdf, "sdf");
        viewer.setStyle({}, { stick: { radius: 0.16 }, sphere: { scale: 0.22 } });
        viewer.zoomTo();
        viewer.spin(true);
        viewer.render();
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
      {status === "ready" && <div className="mt-1 text-[10px] text-muted-foreground">Interactive model loaded. Drag to rotate and scroll to zoom.</div>}
    </div>
  );
}

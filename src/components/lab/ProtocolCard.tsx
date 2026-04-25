import { useState } from "react";
import { AlertTriangle, BookOpen, ChevronDown, Sparkles } from "lucide-react";

type Step = {
  n: number;
  action: string;
  detail: string;
  qty: string;
  duration: string;
  source: string;
  risk?: { level: "low" | "med" | "high"; note: string };
};

const steps: Step[] = [
  {
    n: 1,
    action: "Prepare LB broth medium",
    detail: "Dissolve 25 g LB powder in 1 L deionized water; autoclave 121 °C / 20 min.",
    qty: "1 L",
    duration: "30 min",
    source: "Sambrook, 2012",
  },
  {
    n: 2,
    action: "Inoculate E. coli BL21 culture",
    detail: "Add 10 µL glycerol stock to 5 mL LB + 50 µg/mL kanamycin. Incubate 37 °C, 220 rpm.",
    qty: "5 mL",
    duration: "12 h",
    source: "Protocols.io, 2024",
    risk: { level: "low", note: "Sterile technique required (BSL-1)." },
  },
  {
    n: 3,
    action: "Centrifuge culture",
    detail: "Pellet cells at 4000 rpm for 10 min at 4 °C.",
    qty: "50 mL tubes",
    duration: "15 min",
    source: "Nature Methods, 2023",
    risk: { level: "med", note: "Ensure rotor balance — verify counterweight before spin." },
  },
  {
    n: 4,
    action: "Lyse cells via sonication",
    detail: "Resuspend pellet in lysis buffer; sonicate 6 × 15 s with 30 s rest on ice.",
    qty: "20 mL",
    duration: "20 min",
    source: "Cell Reports, 2024",
    risk: { level: "high", note: "Hearing protection + ice bath. Sample heating risk." },
  },
];

const riskColor = {
  low: "bg-success-soft text-success border-success/30",
  med: "bg-warning-soft text-warning border-warning/30",
  high: "bg-danger-soft text-danger border-danger/30",
};

export function ProtocolCard() {
  const [open, setOpen] = useState<number | null>(2);

  return (
    <section className="rounded-xl bg-panel border border-border shadow-sm">
      <header className="flex items-center justify-between p-5 border-b border-border">
        <div>
          <h3 className="text-base font-semibold">Experiment Protocol</h3>
          <p className="text-xs text-muted-foreground">
            12 steps · grounded in 14 sources · click any step for AI rationale
          </p>
        </div>
        <button className="text-xs text-primary hover:underline flex items-center gap-1">
          <Sparkles className="size-3.5" /> Suggest alternative
        </button>
      </header>
      <ol className="divide-y divide-border">
        {steps.map((s) => {
          const isOpen = open === s.n;
          return (
            <li key={s.n} className="px-5 py-3">
              <div
                className="flex items-start gap-3 cursor-pointer"
                onClick={() => setOpen(isOpen ? null : s.n)}
              >
                <div className="size-7 rounded-md bg-primary-soft text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                  {s.n}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{s.action}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                      {s.qty}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {s.duration}
                    </span>
                    {s.risk && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${riskColor[s.risk.level]}`}
                      >
                        <AlertTriangle className="size-2.5" /> {s.risk.level.toUpperCase()}
                      </span>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-primary/30 text-primary flex items-center gap-1">
                      <BookOpen className="size-2.5" /> {s.source}
                    </span>
                  </div>
                </div>
                <ChevronDown
                  className={`size-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </div>
              {isOpen && (
                <div className="ml-10 mt-2 space-y-2">
                  <p className="text-xs text-foreground/80 leading-relaxed">{s.detail}</p>
                  {s.risk && (
                    <div className={`text-xs rounded-md border px-2.5 py-1.5 ${riskColor[s.risk.level]}`}>
                      <strong>Safety:</strong> {s.risk.note}
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted">
                      Why this step?
                    </button>
                    <button className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted">
                      Suggest alternative
                    </button>
                    <button className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted">
                      Add correction
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

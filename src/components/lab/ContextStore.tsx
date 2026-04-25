import { BookOpen, DollarSign, MessageSquareWarning, ExternalLink, Send } from "lucide-react";

const papers = [
  { title: "High-yield expression of recombinant proteins in BL21(DE3)", venue: "Nature Methods, 2024", cite: 142, fresh: "3d" },
  { title: "Optimized Ni-NTA purification at low imidazole", venue: "Protein Expr. Purif., 2023", cite: 87, fresh: "2w" },
  { title: "Sustainable lab practices for E. coli cultivation", venue: "ACS Sustain. Chem., 2024", cite: 23, fresh: "5d" },
];

const corrections = [
  { user: "Dr. Patel", note: "Reduce sonication to 5×15 s — cavitation overheats sample.", step: "Step 4", time: "2h ago" },
  { user: "M. Chen", note: "BL21 stock from -80 °C box B, slot 14.", step: "Step 2", time: "1d ago" },
];

export function ContextStore() {
  return (
    <aside className="w-[340px] shrink-0 flex flex-col gap-4 p-4 border-l border-border bg-surface overflow-y-auto">
      {/* Novelty */}
      <div className="rounded-xl bg-panel border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Novelty Signal</h3>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-success-soft text-success border border-success/30">
            Live · Semantic Scholar
          </span>
        </div>
        <ul className="space-y-2.5">
          {papers.map((p) => (
            <li key={p.title} className="text-xs">
              <a className="font-medium text-foreground hover:text-primary leading-snug flex items-start gap-1">
                {p.title} <ExternalLink className="size-3 mt-0.5 shrink-0" />
              </a>
              <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
                <span>{p.venue}</span>
                <span>·</span>
                <span>{p.cite} cites</span>
                <span className="ml-auto px-1.5 py-0.5 rounded bg-accent-soft text-[10px]">{p.fresh}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Budget */}
      <div className="rounded-xl bg-panel border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <DollarSign className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Operational Budget</h3>
          </div>
          <span className="text-xs font-semibold text-primary">$779 / $2,000</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden mb-3">
          <div className="h-full bg-gradient-to-r from-primary to-accent" style={{ width: "39%" }} />
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
          <div className="p-2 rounded-md bg-muted/60">
            <div className="font-semibold text-sm">$779</div>
            <div className="text-muted-foreground">Reagents</div>
          </div>
          <div className="p-2 rounded-md bg-muted/60">
            <div className="font-semibold text-sm">$0</div>
            <div className="text-muted-foreground">Equipment</div>
          </div>
          <div className="p-2 rounded-md bg-muted/60">
            <div className="font-semibold text-sm">$1,221</div>
            <div className="text-success">Saved</div>
          </div>
        </div>
      </div>

      {/* Corrections (HITL) */}
      <div className="rounded-xl bg-panel border border-border p-4 flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <MessageSquareWarning className="size-4 text-accent" />
            <h3 className="text-sm font-semibold">Human-in-the-Loop</h3>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-soft border border-accent/30 text-accent-foreground">
            Self-improving
          </span>
        </div>
        <ul className="space-y-2 flex-1">
          {corrections.map((c) => (
            <li key={c.note} className="text-xs p-2.5 rounded-md border border-border bg-muted/30">
              <div className="flex items-center gap-2 mb-1">
                <div className="size-5 rounded-full bg-primary-soft text-primary text-[10px] font-semibold flex items-center justify-center">
                  {c.user.charAt(0)}
                </div>
                <span className="font-medium">{c.user}</span>
                <span className="text-[10px] text-muted-foreground">· {c.time}</span>
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-primary-soft text-primary">
                  {c.step}
                </span>
              </div>
              <p className="text-foreground/80 leading-snug">{c.note}</p>
            </li>
          ))}
        </ul>
        <form className="mt-3 flex items-center gap-2">
          <input
            placeholder="Log a correction…"
            className="flex-1 text-xs px-2.5 py-1.5 rounded-md border border-border bg-panel focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button type="button" className="size-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90">
            <Send className="size-3.5" />
          </button>
        </form>
      </div>
    </aside>
  );
}

import { Trophy, Leaf } from "lucide-react";

const rows = [
  { label: "This Plan (AI)", time: "9 d", cost: 779, sustain: 82, ours: true },
  { label: "Lab baseline", time: "14 d", cost: 1240, sustain: 61, ours: false },
  { label: "Published (Nature, 2023)", time: "11 d", cost: 980, sustain: 70, ours: false },
  { label: "Commercial kit (Thermo)", time: "7 d", cost: 1850, sustain: 54, ours: false },
];

export function ComparisonCard() {
  return (
    <section className="rounded-xl bg-panel border border-border shadow-sm p-5">
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trophy className="size-4 text-accent" />
          <h3 className="text-base font-semibold">Benchmark vs. Alternatives</h3>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-soft text-accent-foreground border border-accent/30">
          37% cheaper · 35% faster
        </span>
      </header>
      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.label}
            className={`grid grid-cols-12 items-center gap-2 px-3 py-2 rounded-md border text-xs ${
              r.ours ? "border-primary/40 bg-primary-soft" : "border-border"
            }`}
          >
            <div className={`col-span-4 font-medium ${r.ours ? "text-primary" : ""}`}>{r.label}</div>
            <div className="col-span-2 text-muted-foreground">⏱ {r.time}</div>
            <div className="col-span-2 text-muted-foreground">${r.cost}</div>
            <div className="col-span-4 flex items-center gap-2">
              <Leaf className="size-3 text-success" />
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-success" style={{ width: `${r.sustain}%` }} />
              </div>
              <span className="text-[11px] font-mono w-8 text-right">{r.sustain}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

import { Leaf, Trophy } from "lucide-react";
import type { BenchmarkRow } from "@/lib/labApi";

export function ComparisonCard({ rows }: { rows: BenchmarkRow[] }) {
  const ours = rows.find((row) => row.ours);
  const competitor = rows.find((row) => !row.ours);
  const cheaper = ours && competitor ? Math.max(Math.round(((competitor.cost - ours.cost) / competitor.cost) * 100), 0) : 0;

  return (
    <section className="rounded-xl bg-panel border border-border shadow-sm p-5">
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trophy className="size-4 text-accent" />
          <h3 className="text-base font-semibold">Benchmark vs. Alternatives</h3>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-soft text-accent-foreground border border-accent/30">
          {cheaper}% cheaper when the reference plan is the baseline
        </span>
      </header>
      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className={`grid grid-cols-12 items-center gap-2 px-3 py-2 rounded-md border text-xs ${
              row.ours ? "border-primary/40 bg-primary-soft" : "border-border"
            }`}
          >
            <div className={`col-span-4 font-medium ${row.ours ? "text-primary" : ""}`}>{row.label}</div>
            <div className="col-span-2 text-muted-foreground">{row.time}</div>
            <div className="col-span-2 text-muted-foreground">${row.cost}</div>
            <div className="col-span-4 flex items-center gap-2">
              <Leaf className="size-3 text-success" />
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-success" style={{ width: `${row.sustainability}%` }} />
              </div>
              <span className="text-[11px] font-mono w-8 text-right">{row.sustainability}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

import { Clock3, DollarSign, Leaf, Trophy } from "lucide-react";
import { adjustedBudgetAmount, formatCurrency, type BenchmarkRow, type BudgetRegion } from "@/lib/labApi";

function daysValue(time: string) {
  const match = time.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

export function ComparisonCard({ rows, budgetRegion }: { rows: BenchmarkRow[]; budgetRegion: BudgetRegion }) {
  const ours = rows.find((row) => row.ours);

  return (
    <section className="rounded-2xl bg-panel border border-border shadow-sm p-5">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="size-4 text-accent" />
          <div>
            <h3 className="text-base font-semibold">Benchmark vs. Alternatives</h3>
            <p className="text-xs text-muted-foreground">Compare runtime, budget, and sustainability against practical alternatives. Budget figures are region-adjusted planning estimates, not vendor quotes.</p>
          </div>
        </div>
      </header>

      <div className="mt-4 grid gap-3">
        {rows.map((row) => {
          const timeDelta = ours && !row.ours ? daysValue(row.time) - daysValue(ours.time) : 0;
          const costDelta = ours && !row.ours ? row.cost - ours.cost : 0;
          const adjustedCost = adjustedBudgetAmount(row.cost, budgetRegion, "total");

          return (
            <article
              key={row.label}
              className={`rounded-2xl border p-4 ${
                row.ours ? "border-primary/40 bg-primary-soft" : "border-border bg-muted/15"
              }`}
            >
              <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr_0.8fr_1fr] xl:items-center">
                <div>
                  <div className={`text-sm font-semibold ${row.ours ? "text-primary" : ""}`}>{row.label}</div>
                  {!row.ours && ours && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {timeDelta > 0 ? `${timeDelta} days slower` : timeDelta < 0 ? `${Math.abs(timeDelta)} days faster` : "Same speed"} ·{" "}
                      {costDelta > 0
                        ? `${formatCurrency(adjustedBudgetAmount(costDelta, budgetRegion, "total"), budgetRegion)} more expensive`
                        : costDelta < 0
                          ? `${formatCurrency(adjustedBudgetAmount(Math.abs(costDelta), budgetRegion, "total"), budgetRegion)} cheaper`
                          : "Same cost"}
                    </div>
                  )}
                </div>

                <div className="rounded-xl bg-panel/80 px-3 py-2 text-xs">
                  <div className="mb-1 flex items-center gap-1 text-muted-foreground">
                    <Clock3 className="size-3" />
                    Time
                  </div>
                  <div className="text-sm font-semibold">{row.time}</div>
                </div>

                <div className="rounded-xl bg-panel/80 px-3 py-2 text-xs">
                  <div className="mb-1 flex items-center gap-1 text-muted-foreground">
                    <DollarSign className="size-3" />
                    Budget
                  </div>
                  <div className="text-sm font-semibold">{formatCurrency(adjustedCost, budgetRegion)}</div>
                </div>

                <div className="rounded-xl bg-panel/80 px-3 py-2 text-xs">
                  <div className="mb-1 flex items-center gap-1 text-muted-foreground">
                    <Leaf className="size-3 text-success" />
                    Sustainability
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-success" style={{ width: `${row.sustainability}%` }} />
                    </div>
                    <span className="w-8 text-right font-mono text-[11px]">{row.sustainability}</span>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

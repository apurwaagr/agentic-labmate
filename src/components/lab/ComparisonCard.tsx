import { Clock3, DollarSign, Leaf, Trophy } from "lucide-react";
import { adjustedBudgetAmount, formatCurrency, type BenchmarkRow, type BudgetRegion } from "@/lib/labApi";

function daysValue(time: string) {
  const match = time.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

export function ComparisonCard({ rows, budgetRegion }: { rows: BenchmarkRow[]; budgetRegion: BudgetRegion }) {
  const ours = rows.find((row) => row.ours);

  return (
    <section className="rounded-2xl bg-panel border border-border shadow-sm overflow-hidden">
      <header className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Trophy className="size-4 text-accent" />
          <div>
            <h3 className="text-base font-semibold">Benchmark vs. Alternatives</h3>
            <p className="text-xs text-muted-foreground">Region-adjusted planning estimates — not vendor quotes.</p>
          </div>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left">
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Method</th>
              <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Clock3 className="size-3" />Time</span>
              </th>
              <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><DollarSign className="size-3" />Budget</span>
              </th>
              <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Leaf className="size-3 text-success" />Sustain.</span>
              </th>
              <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-[0.18em] text-muted-foreground">vs. Ours</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const timeDelta = ours && !row.ours ? daysValue(row.time) - daysValue(ours.time) : 0;
              const costDelta = ours && !row.ours ? row.cost - ours.cost : 0;
              const adjustedCost = adjustedBudgetAmount(row.cost, budgetRegion, "total");

              return (
                <tr
                  key={row.label}
                  className={`transition-colors ${row.ours ? "bg-primary-soft/40" : "hover:bg-muted/20"}`}
                >
                  <td className="px-4 py-2.5">
                    <div className={`flex items-center gap-1.5 font-medium ${row.ours ? "text-primary" : ""}`}>
                      {row.ours && <span className="inline-block size-1.5 rounded-full bg-primary" />}
                      {row.label}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-medium">{row.time}</td>
                  <td className="px-3 py-2.5 font-medium">{formatCurrency(adjustedCost, budgetRegion)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-success" style={{ width: `${row.sustainability}%` }} />
                      </div>
                      <span className="font-mono text-[10px]">{row.sustainability}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[11px]">
                    {!row.ours && ours ? (
                      <div className="flex flex-wrap gap-1">
                        <span className={`rounded-full px-1.5 py-0.5 font-medium ${costDelta > 0 ? "bg-danger-soft text-danger" : costDelta < 0 ? "bg-success-soft text-success" : "text-muted-foreground"}`}>
                          {costDelta > 0 ? "+" : ""}{formatCurrency(adjustedBudgetAmount(Math.abs(costDelta), budgetRegion, "total"), budgetRegion)}
                        </span>
                        {timeDelta !== 0 && (
                          <span className={`rounded-full px-1.5 py-0.5 font-medium ${timeDelta > 0 ? "bg-warning-soft text-warning" : "bg-success-soft text-success"}`}>
                            {timeDelta > 0 ? `+${timeDelta}d` : `${timeDelta}d`}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">Ours</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

import { Check, Package, Truck } from "lucide-react";
import { adjustedBudgetAmount, formatCurrency, type BudgetRegion, type ExperimentPlan } from "@/lib/labApi";

const statusBadge: Record<string, string> = {
  owned: "bg-success-soft text-success border-success/30",
  "in-stock": "bg-primary-soft text-primary border-primary/30",
  order: "bg-warning-soft text-warning border-warning/30",
};

export function SupplyChainCard({ plan, budgetRegion }: { plan: ExperimentPlan; budgetRegion: BudgetRegion }) {
  return (
    <section className="rounded-2xl bg-panel border border-border shadow-sm overflow-hidden">
      <header className="flex flex-col gap-2 border-b border-border p-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-2">
          <Package className="size-4 text-primary" />
          <div>
            <h3 className="text-base font-semibold">Supply Chain</h3>
            <p className="text-xs text-muted-foreground">Critical reagents, status, lead time, and spend</p>
          </div>
        </div>
        <div className="rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
          Total {formatCurrency(adjustedBudgetAmount(plan.budget.totalUsd, budgetRegion, "total"), budgetRegion)}
        </div>
      </header>

      {/* Compact table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left">
              <th className="px-4 py-2.5 font-semibold text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Reagent</th>
              <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Supplier · Cat#</th>
              <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Qty</th>
              <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Lead</th>
              <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-[0.18em] text-muted-foreground text-right">Unit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {plan.materials.map((item) => (
              <tr key={`${item.catalogNumber}-${item.name}`} className="hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{item.name}</span>
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${statusBadge[item.status]}`}>
                      {item.status === "owned" && <Check className="size-2" />}
                      {item.status.replace("-", " ")}
                    </span>
                  </div>
                  {item.notes && <div className="mt-0.5 text-[10px] text-muted-foreground line-clamp-1">{item.notes}</div>}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  <div>{item.supplier}</div>
                  <div className="font-mono text-[10px]">{item.catalogNumber}</div>
                </td>
                <td className="px-3 py-2.5 text-foreground/80">{item.quantity}</td>
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Truck className="size-2.5" />{item.leadTime}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right font-semibold text-foreground">
                  {formatCurrency(adjustedBudgetAmount(item.unitCostUsd, budgetRegion, "reagents"), budgetRegion)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

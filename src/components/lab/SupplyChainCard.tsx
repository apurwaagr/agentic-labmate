import { Check, Package, Truck } from "lucide-react";
import type { ExperimentPlan } from "@/lib/labApi";

const statusBadge: Record<string, string> = {
  owned: "bg-success-soft text-success border-success/30",
  "in-stock": "bg-primary-soft text-primary border-primary/30",
  order: "bg-warning-soft text-warning border-warning/30",
};

export function SupplyChainCard({ plan }: { plan: ExperimentPlan }) {
  return (
    <section className="rounded-xl bg-panel border border-border shadow-sm">
      <header className="flex items-center justify-between p-5 border-b border-border">
        <div className="flex items-center gap-2">
          <Package className="size-4 text-primary" />
          <h3 className="text-base font-semibold">Supply Chain</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-success-soft text-success border border-success/30">
            Domain-aware sourcing
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          Total: <span className="font-semibold text-foreground">${plan.budget.totalUsd.toLocaleString()}</span>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="px-5 py-2 font-medium">Item</th>
              <th className="px-3 py-2 font-medium">Catalog #</th>
              <th className="px-3 py-2 font-medium">Qty</th>
              <th className="px-3 py-2 font-medium text-right">Cost</th>
              <th className="px-3 py-2 font-medium">Lead</th>
              <th className="px-5 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {plan.materials.map((item) => (
              <tr key={`${item.catalogNumber}-${item.name}`} className="border-b border-border last:border-0 hover:bg-muted/40">
                <td className="px-5 py-2.5">
                  <div className="font-medium text-sm">{item.name}</div>
                  <div className="text-[11px] text-muted-foreground">{item.supplier}</div>
                  {item.notes && <div className="text-[11px] text-muted-foreground mt-0.5">{item.notes}</div>}
                </td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">{item.catalogNumber}</td>
                <td className="px-3 py-2.5 text-xs">{item.quantity}</td>
                <td className="px-3 py-2.5 text-right font-medium text-sm">${item.unitCostUsd}</td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Truck className="size-3" /> {item.leadTime}
                  </div>
                </td>
                <td className="px-5 py-2.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1 w-fit ${statusBadge[item.status]}`}>
                    {item.status === "owned" && <Check className="size-2.5" />}
                    {item.status.replace("-", " ")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

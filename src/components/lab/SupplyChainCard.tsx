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

      <div className="grid gap-3 p-4">
        {plan.materials.map((item) => (
          <article key={`${item.catalogNumber}-${item.name}`} className="rounded-2xl border border-border bg-muted/20 p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold">{item.name}</h4>
                  <span className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusBadge[item.status]}`}>
                    {item.status === "owned" && <Check className="size-2.5" />}
                    {item.status.replace("-", " ")}
                  </span>
                </div>
                <div className="mt-2 grid gap-2 text-xs text-foreground/80 xl:grid-cols-2">
                  <div className="rounded-xl bg-panel px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Supplier</div>
                    <div className="mt-1 font-medium">{item.supplier}</div>
                  </div>
                  <div className="rounded-xl bg-panel px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Catalog number</div>
                    <div className="mt-1 font-mono text-[11px]">{item.catalogNumber}</div>
                  </div>
                  <div className="rounded-xl bg-panel px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Quantity</div>
                    <div className="mt-1 font-medium">{item.quantity}</div>
                  </div>
                  <div className="rounded-xl bg-panel px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Lead time</div>
                    <div className="mt-1 inline-flex items-center gap-1 font-medium">
                      <Truck className="size-3" />
                      {item.leadTime}
                    </div>
                  </div>
                </div>
                {item.notes && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{item.notes}</p>}
                {(item.molecularFormula || item.pubchemCid || item.iupacName) && (
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    {item.molecularFormula && <span className="rounded-full bg-panel px-2 py-1">Formula {item.molecularFormula}</span>}
                    {typeof item.molecularWeight === "number" && <span className="rounded-full bg-panel px-2 py-1">MW {item.molecularWeight.toFixed(2)}</span>}
                    {item.pubchemCid && (
                      <a
                        href={item.sourceUri || `https://pubchem.ncbi.nlm.nih.gov/compound/${item.pubchemCid}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full bg-panel px-2 py-1 hover:text-foreground"
                      >
                        PubChem CID {item.pubchemCid}
                      </a>
                    )}
                    {item.iupacName && <span className="rounded-full bg-panel px-2 py-1">{item.iupacName}</span>}
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-border bg-panel px-4 py-3 text-center xl:w-28">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Unit cost</div>
                <div className="mt-1 text-lg font-semibold">{formatCurrency(adjustedBudgetAmount(item.unitCostUsd, budgetRegion, "reagents"), budgetRegion)}</div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

import { Check, Package, Truck } from "lucide-react";

const items = [
  { name: "LB Broth, Miller", catalog: "L3522-1KG", vendor: "Sigma", qty: "1 kg", unit: 78, lead: "2 d", status: "in-stock" },
  { name: "Kanamycin sulfate", catalog: "K1377-5G", vendor: "Sigma", qty: "5 g", unit: 42, lead: "in lab", status: "owned" },
  { name: "BL21(DE3) Comp. cells", catalog: "C2527H", vendor: "NEB", qty: "6 × 50 µL", unit: 124, lead: "1 d", status: "in-stock" },
  { name: "Lysis buffer kit", catalog: "78501", vendor: "Thermo", qty: "1 kit", unit: 215, lead: "3 d", status: "order" },
  { name: "Ni-NTA resin", catalog: "30210", vendor: "Qiagen", qty: "25 mL", unit: 320, lead: "5 d", status: "order" },
];

const total = items.reduce((s, i) => s + i.unit, 0);

const statusBadge: Record<string, string> = {
  owned: "bg-success-soft text-success border-success/30",
  "in-stock": "bg-primary-soft text-primary border-primary/30",
  order: "bg-warning-soft text-warning border-warning/30",
};

export function SupplyChainCard() {
  return (
    <section className="rounded-xl bg-panel border border-border shadow-sm">
      <header className="flex items-center justify-between p-5 border-b border-border">
        <div className="flex items-center gap-2">
          <Package className="size-4 text-primary" />
          <h3 className="text-base font-semibold">Supply Chain</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-success-soft text-success border border-success/30">
            Inventory-aware
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          Total: <span className="font-semibold text-foreground">${total.toLocaleString()}</span>
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
            {items.map((it) => (
              <tr key={it.catalog} className="border-b border-border last:border-0 hover:bg-muted/40">
                <td className="px-5 py-2.5">
                  <div className="font-medium text-sm">{it.name}</div>
                  <div className="text-[11px] text-muted-foreground">{it.vendor}</div>
                </td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">{it.catalog}</td>
                <td className="px-3 py-2.5 text-xs">{it.qty}</td>
                <td className="px-3 py-2.5 text-right font-medium text-sm">${it.unit}</td>
                <td className="px-3 py-2.5 text-xs flex items-center gap-1 text-muted-foreground">
                  <Truck className="size-3" /> {it.lead}
                </td>
                <td className="px-5 py-2.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1 w-fit ${statusBadge[it.status]}`}>
                    {it.status === "owned" && <Check className="size-2.5" />}
                    {it.status.replace("-", " ")}
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

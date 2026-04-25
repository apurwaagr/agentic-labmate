import { Navigator } from "@/components/lab/Navigator";
import { ContextStore } from "@/components/lab/ContextStore";
import { ProtocolCard } from "@/components/lab/ProtocolCard";
import { SupplyChainCard } from "@/components/lab/SupplyChainCard";
import { TimelineCard } from "@/components/lab/TimelineCard";
import { ComparisonCard } from "@/components/lab/ComparisonCard";
import { Chatbot } from "@/components/lab/Chatbot";
import { PhaseTracker } from "@/components/lab/PhaseTracker";
import { ShieldCheck, Sparkles, Leaf } from "lucide-react";

const Index = () => {
  return (
    <div className="min-h-screen bg-background flex">
      <Navigator />

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-panel">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Project · CRISPR-Cas9 Scaffolding
            </div>
            <h1 className="text-xl font-semibold">Protocol Workbench</h1>
          </div>
          <PhaseTracker />
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Hypothesis hero */}
          <section className="rounded-xl border border-border bg-gradient-to-br from-panel to-primary-soft p-6 shadow-sm">
            <div className="flex items-start justify-between gap-6">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="size-4 text-primary" />
                  <span className="text-[11px] uppercase tracking-wider text-primary font-semibold">
                    Hypothesis
                  </span>
                </div>
                <h2 className="text-lg font-semibold leading-snug max-w-3xl">
                  Recombinant expression of a novel sgRNA scaffold variant in <em>E. coli</em> BL21(DE3)
                  improves CRISPR-Cas9 cleavage efficiency at low-GC loci by ≥15%.
                </h2>
                <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
                  Plan generated from 14 grounded sources · validated against your lab inventory and budget.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3 shrink-0">
                <Metric label="Confidence" value="87.2%" tone="primary" icon={<ShieldCheck className="size-3.5" />} />
                <Metric label="Novelty" value="High" tone="accent" icon={<Sparkles className="size-3.5" />} />
                <Metric label="Sustainability" value="82" tone="success" icon={<Leaf className="size-3.5" />} />
              </div>
            </div>
          </section>

          {/* Protocol */}
          <ProtocolCard />

          {/* Two columns */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <SupplyChainCard />
            <TimelineCard />
          </div>

          {/* Benchmark */}
          <ComparisonCard />
        </div>
      </main>

      <ContextStore />
      <Chatbot />
    </div>
  );
};

const toneMap: Record<string, string> = {
  primary: "bg-primary-soft text-primary border-primary/30",
  accent: "bg-accent-soft text-accent-foreground border-accent/30",
  success: "bg-success-soft text-success border-success/30",
};

function Metric({ label, value, tone, icon }: { label: string; value: string; tone: string; icon: React.ReactNode }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${toneMap[tone]}`}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-80">
        {icon} {label}
      </div>
      <div className="text-lg font-bold leading-tight">{value}</div>
    </div>
  );
}

export default Index;

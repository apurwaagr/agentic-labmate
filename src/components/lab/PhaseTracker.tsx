import { Check, Loader2 } from "lucide-react";

const phases = [
  { id: 1, name: "Hypothesis Input", state: "done" },
  { id: 2, name: "Literature Novelty QC", state: "done" },
  { id: 3, name: "Operational Plan", state: "active" },
];

export function PhaseTracker() {
  return (
    <div className="flex items-center gap-2 text-xs">
      {phases.map((p, i) => (
        <div key={p.id} className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${
              p.state === "done"
                ? "bg-success-soft border-success/30 text-success"
                : p.state === "active"
                ? "bg-primary-soft border-primary/30 text-primary"
                : "bg-muted border-border text-muted-foreground"
            }`}
          >
            {p.state === "done" ? (
              <Check className="size-3" />
            ) : p.state === "active" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <span className="size-3 rounded-full border border-current" />
            )}
            <span className="font-medium">{p.name}</span>
          </div>
          {i < phases.length - 1 && <span className="w-6 h-px bg-border" />}
        </div>
      ))}
    </div>
  );
}

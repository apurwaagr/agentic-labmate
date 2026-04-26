import { Check, Loader2 } from "lucide-react";

type PhaseState = "done" | "active" | "pending" | "error";

function toneForState(state: PhaseState) {
  if (state === "done") {
    return "bg-success-soft border-success/30 text-success";
  }
  if (state === "active") {
    return "bg-primary-soft border-primary/30 text-primary";
  }
  if (state === "error") {
    return "bg-danger-soft border-danger/30 text-danger";
  }
  return "bg-muted border-border text-muted-foreground";
}

export function PhaseTracker({
  projectReady,
  noveltyReady,
  planReady,
  loading,
  error,
}: {
  projectReady: boolean;
  noveltyReady: boolean;
  planReady: boolean;
  loading: boolean;
  error: boolean;
}) {
  const phases: { id: number; name: string; state: PhaseState }[] = [
    {
      id: 1,
      name: "Project",
      state: error ? "error" : projectReady ? "done" : "pending",
    },
    {
      id: 2,
      name: "Novelty QC",
      state: error ? "error" : noveltyReady ? "done" : loading && projectReady ? "active" : "pending",
    },
    {
      id: 3,
      name: "Operational Plan",
      state: error ? "error" : planReady ? "done" : loading && projectReady ? "active" : "pending",
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {phases.map((phase, index) => (
        <div key={phase.id} className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${toneForState(phase.state)}`}>
            {phase.state === "done" ? (
              <Check className="size-3" />
            ) : phase.state === "active" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : phase.state === "error" ? (
              <span className="text-[10px] font-bold">!</span>
            ) : (
              <span className="size-3 rounded-full border border-current" />
            )}
            <span className="font-medium">{phase.name}</span>
          </div>
          {index < phases.length - 1 && <span className="h-px w-5 bg-border" />}
        </div>
      ))}
    </div>
  );
}

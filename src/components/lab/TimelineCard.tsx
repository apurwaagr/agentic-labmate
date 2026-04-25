import { Calendar } from "lucide-react";
import type { TimelinePhase } from "@/lib/labApi";

export function TimelineCard({ phases }: { phases: TimelinePhase[] }) {
  const totalDays = phases.reduce((sum, phase) => sum + phase.durationDays, 0);
  const days = Array.from({ length: Math.max(totalDays, 1) }, (_, index) => `D${index + 1}`);
  let cursor = 0;

  const positioned = phases.map((phase) => {
    const row = { ...phase, start: cursor };
    cursor += phase.durationDays;
    return row;
  });

  return (
    <section className="rounded-xl bg-panel border border-border shadow-sm p-5">
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar className="size-4 text-primary" />
          <h3 className="text-base font-semibold">Timeline</h3>
        </div>
        <div className="text-xs text-muted-foreground">
          Total: <span className="font-semibold text-foreground">{totalDays} days</span>
        </div>
      </header>

      <div className="space-y-1.5">
        <div className={`grid gap-1 text-[10px] text-muted-foreground font-mono pl-44`} style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map((day) => (
            <div key={day} className="text-center">
              {day}
            </div>
          ))}
        </div>
        {positioned.map((phase) => (
          <div key={phase.phase} className="flex items-center gap-2">
            <div className="w-44">
              <div className="text-xs text-foreground/80 truncate">{phase.phase}</div>
              <div className="text-[10px] text-muted-foreground">{phase.owner}</div>
            </div>
            <div className={`flex-1 grid gap-1`} style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
              {days.map((_, index) => {
                const inSpan = index >= phase.start && index < phase.start + phase.durationDays;
                return <div key={index} className={`h-5 rounded ${inSpan ? "bg-primary" : "bg-muted/60"}`} />;
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

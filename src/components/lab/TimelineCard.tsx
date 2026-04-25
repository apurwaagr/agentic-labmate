import { Calendar } from "lucide-react";

const tasks = [
  { name: "Media prep & autoclave", start: 0, len: 1, color: "bg-primary" },
  { name: "Overnight culture", start: 1, len: 2, color: "bg-primary/70" },
  { name: "Induction & expression", start: 3, len: 2, color: "bg-accent" },
  { name: "Cell harvest & lysis", start: 5, len: 1, color: "bg-primary" },
  { name: "Purification (Ni-NTA)", start: 6, len: 2, color: "bg-primary/70" },
  { name: "SDS-PAGE & QC", start: 8, len: 1, color: "bg-success" },
];

const days = Array.from({ length: 10 }, (_, i) => `D${i + 1}`);

export function TimelineCard() {
  return (
    <section className="rounded-xl bg-panel border border-border shadow-sm p-5">
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar className="size-4 text-primary" />
          <h3 className="text-base font-semibold">Timeline</h3>
        </div>
        <div className="text-xs text-muted-foreground">
          Total: <span className="font-semibold text-foreground">9 days</span>
        </div>
      </header>

      <div className="space-y-1.5">
        <div className="grid grid-cols-10 gap-1 text-[10px] text-muted-foreground font-mono pl-40">
          {days.map((d) => (
            <div key={d} className="text-center">{d}</div>
          ))}
        </div>
        {tasks.map((t) => (
          <div key={t.name} className="flex items-center gap-2">
            <div className="w-40 text-xs text-foreground/80 truncate">{t.name}</div>
            <div className="flex-1 grid grid-cols-10 gap-1">
              {days.map((_, i) => {
                const inSpan = i >= t.start && i < t.start + t.len;
                return (
                  <div
                    key={i}
                    className={`h-5 rounded ${inSpan ? t.color : "bg-muted/60"}`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

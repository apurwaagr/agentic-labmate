import { FlaskConical, FolderKanban, Activity, History, Settings, Plus, CircleDot } from "lucide-react";

const projects = [
  { name: "CRISPR-Cas9 Scaffolding", active: true, phase: "Plan Generation" },
  { name: "Photocatalyst Screening", active: false, phase: "Novelty QC" },
  { name: "Polymer Degradation Study", active: false, phase: "Hypothesis" },
];

const agentLogs = [
  { t: "12:04:21", msg: "Searching protocols.io…", state: "done" },
  { t: "12:04:38", msg: "Cross-referencing 14 papers", state: "done" },
  { t: "12:05:02", msg: "Estimating reagent costs", state: "done" },
  { t: "12:05:19", msg: "Finalizing timeline", state: "active" },
];

export function Navigator() {
  return (
    <aside className="w-64 shrink-0 flex flex-col gap-5 px-3 py-4 border-r border-border bg-panel">
      <div className="flex items-center gap-2 px-2">
        <div className="size-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
          <FlaskConical className="size-4" />
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">Agentic Lab</div>
          <div className="text-[11px] text-muted-foreground">Scientific OS</div>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5 text-sm">
        <a className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-primary-soft text-primary font-medium">
          <FolderKanban className="size-4" /> Projects
        </a>
        <a className="flex items-center gap-2 px-2 py-1.5 rounded-md text-muted-foreground hover:bg-muted">
          <Activity className="size-4" /> Agent Logs
        </a>
        <a className="flex items-center gap-2 px-2 py-1.5 rounded-md text-muted-foreground hover:bg-muted">
          <History className="size-4" /> History
        </a>
        <a className="flex items-center gap-2 px-2 py-1.5 rounded-md text-muted-foreground hover:bg-muted">
          <Settings className="size-4" /> Settings
        </a>
      </nav>

      <div>
        <div className="flex items-center justify-between px-2 mb-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Projects</span>
          <button className="text-muted-foreground hover:text-primary">
            <Plus className="size-3.5" />
          </button>
        </div>
        <ul className="flex flex-col gap-1">
          {projects.map((p) => (
            <li
              key={p.name}
              className={`px-2 py-2 rounded-md text-sm cursor-pointer ${
                p.active ? "bg-surface border border-border" : "hover:bg-muted"
              }`}
            >
              <div className="flex items-center gap-2">
                <CircleDot className={`size-3 ${p.active ? "text-accent" : "text-muted-foreground"}`} />
                <span className="font-medium truncate">{p.name}</span>
              </div>
              <div className="text-[11px] text-muted-foreground ml-5">{p.phase}</div>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto rounded-lg border border-border bg-surface p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="size-2 rounded-full bg-success animate-pulse" />
          <span className="text-xs font-semibold">Agent Live</span>
        </div>
        <ul className="space-y-1.5 max-h-40 overflow-auto text-[11px] font-mono">
          {agentLogs.map((l) => (
            <li key={l.t} className="flex gap-2">
              <span className="text-muted-foreground">{l.t}</span>
              <span className={l.state === "active" ? "text-primary" : "text-foreground/70"}>
                {l.msg}
                {l.state === "active" && "…"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

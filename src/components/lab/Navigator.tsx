import { Activity, FlaskConical, FolderKanban, Plus, Sparkles, Trash2 } from "lucide-react";

export type ProjectListItem = {
  id: string;
  name: string;
  status: "draft" | "analyzing" | "planned" | "error";
  domain?: string;
  updatedAt: string;
};

export type AgentLogItem = {
  id: string;
  time: string;
  message: string;
  state: "done" | "active" | "pending" | "error";
};

const statusTone = {
  draft: "text-muted-foreground bg-muted",
  analyzing: "text-primary bg-primary-soft",
  planned: "text-success bg-success-soft",
  error: "text-danger bg-danger-soft",
};

export function Navigator({
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  agentLogs,
}: {
  projects: ProjectListItem[];
  activeProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (projectId: string) => void;
  agentLogs: AgentLogItem[];
}) {
  const liveAgentCount = agentLogs.filter((log) => log.state === "active").length;

  return (
    <aside className="w-[300px] shrink-0 border-r border-border bg-[radial-gradient(circle_at_top,_hsl(var(--primary-soft)),_transparent_45%),linear-gradient(180deg,hsl(var(--panel)),hsl(var(--surface)))]">
      <div className="flex h-full flex-col gap-5 px-4 py-5">
        <div className="rounded-2xl border border-border bg-panel/90 p-4 shadow-sm backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <FlaskConical className="size-5" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">Agentic Labmate</div>
              <div className="text-[11px] text-muted-foreground">Hypothesis to runnable experiment</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl border border-border bg-muted/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Projects</div>
              <div className="mt-1 text-lg font-semibold">{projects.length}</div>
            </div>
            <div className="rounded-xl border border-border bg-muted/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Live agents</div>
              <div className="mt-1 text-lg font-semibold">{liveAgentCount}</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-panel/90 p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderKanban className="size-4 text-primary" />
              <span className="text-sm font-semibold">Projects</span>
            </div>
            <button
              type="button"
              onClick={onCreateProject}
              className="flex items-center gap-1 rounded-full border border-primary/20 bg-primary-soft px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary hover:text-primary-foreground"
            >
              <Plus className="size-3.5" />
              New
            </button>
          </div>

          {projects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
              Create your first experiment project to start literature QC and plan generation.
            </div>
          ) : (
            <ul className="space-y-2">
              {projects.map((project) => {
                const isActive = project.id === activeProjectId;

                return (
                  <li key={project.id}>
                    <div
                      className={`rounded-xl border transition-colors ${
                        isActive
                          ? "border-primary/30 bg-primary-soft shadow-sm"
                          : "border-border bg-muted/20 hover:bg-muted/40"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectProject(project.id)}
                        className="w-full p-3 text-left"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{project.name}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {project.domain || "Custom project"} · {project.updatedAt}
                            </div>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-[10px] font-medium capitalize ${statusTone[project.status]}`}>
                            {project.status}
                          </span>
                        </div>
                      </button>
                      <div className="flex justify-end px-3 pb-3">
                        <button
                          type="button"
                          onClick={() => onDeleteProject(project.id)}
                          className="inline-flex items-center gap-1 rounded-full border border-danger/25 bg-danger-soft px-2.5 py-1 text-[10px] font-medium text-danger hover:bg-danger hover:text-white"
                          aria-label={`Delete ${project.name}`}
                        >
                          <Trash2 className="size-3" />
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-auto rounded-2xl border border-border bg-panel/90 p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <span className="text-sm font-semibold">Agent Activity</span>
          </div>
          <ul className="space-y-2 text-[11px]">
            {agentLogs.length > 0 ? (
              agentLogs.map((log) => (
                <li key={log.id} className="rounded-xl border border-border bg-muted/25 p-2.5">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-mono text-muted-foreground">{log.time}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${
                        log.state === "done"
                          ? "bg-success-soft text-success"
                          : log.state === "active"
                            ? "bg-primary-soft text-primary"
                            : log.state === "error"
                              ? "bg-danger-soft text-danger"
                              : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {log.state}
                    </span>
                  </div>
                  <div className="leading-relaxed text-foreground/80">{log.message}</div>
                </li>
              ))
            ) : (
              <li className="rounded-xl border border-dashed border-border bg-muted/20 p-3 text-muted-foreground">
                Activity starts once a project is created and a plan is generated.
              </li>
            )}
          </ul>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-primary-soft px-3 py-2 text-[11px] text-primary">
            <Sparkles className="size-3.5" />
            Live workflow signals update as the system parses, checks novelty, and assembles the plan.
          </div>
        </div>
      </div>
    </aside>
  );
}

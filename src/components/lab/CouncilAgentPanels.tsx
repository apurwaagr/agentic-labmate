import React, { useState } from "react";
import { Objection } from "@/lib/labApi";
import { ShieldAlert, AlertTriangle, AlertCircle, RefreshCw } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function CouncilAgentPanels({
  drafts,
  revisions,
  objections,
}: {
  drafts: Record<string, any>;
  revisions: Record<string, any>;
  objections: Objection[];
}) {
  const sections = Object.keys(drafts);
  const orderedObjections = [...objections].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const fatalCount = objections.filter((item) => item.severity === "fatal").length;
  const majorCount = objections.filter((item) => item.severity === "major").length;
  const minorCount = objections.filter((item) => item.severity === "minor").length;
  if (sections.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-panel shadow-sm overflow-hidden p-4">
        <h3 className="text-sm font-semibold mb-3">Council Agent Deliberations</h3>
        {objections.length > 0 && (
          <div className="mb-4 rounded-xl border border-border bg-muted/20 px-3">
            <Accordion type="single" collapsible>
              <AccordionItem value="devils-advocate" className="border-b-0">
                <AccordionTrigger className="py-3 hover:no-underline">
                  <div className="flex flex-1 flex-col gap-2 text-left sm:flex-row sm:items-center sm:justify-between">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase">Devil's Advocate Objections</h4>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full border border-danger/30 bg-danger-soft px-2 py-0.5 text-[10px] font-semibold text-danger">
                        {fatalCount} Fatal
                      </span>
                      <span className="rounded-full border border-warning/30 bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning">
                        {majorCount} Major
                      </span>
                      <span className="rounded-full border border-border bg-panel px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {minorCount} Minor
                      </span>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-3">
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    <Accordion type="multiple" className="space-y-2">
                      {orderedObjections.map((obj, i) => (
                        <AccordionItem
                          key={`${obj.section}-${obj.claim}-${i}`}
                          value={`obj-${i}`}
                          className={`rounded-lg border px-3 text-xs ${
                            obj.severity === "fatal"
                              ? "bg-danger-soft/50 border-danger/30 text-danger"
                              : obj.severity === "major"
                              ? "bg-warning-soft/50 border-warning/30 text-warning"
                              : "bg-muted/50 border-border text-foreground/80"
                          }`}
                        >
                          <AccordionTrigger className="py-2.5 hover:no-underline">
                            <div className="flex w-full items-start gap-2 pr-2">
                              <div className="mt-0.5">
                                {obj.severity === "fatal" ? (
                                  <ShieldAlert className="size-3.5" />
                                ) : obj.severity === "major" ? (
                                  <AlertTriangle className="size-3.5" />
                                ) : (
                                  <AlertCircle className="size-3.5" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold">{obj.section}: {obj.claim}</span>
                                  <span
                                    className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                      obj.severity === "fatal"
                                        ? "border-danger/40 bg-danger-soft text-danger"
                                        : obj.severity === "major"
                                          ? "border-warning/40 bg-warning-soft text-warning"
                                          : "border-border bg-panel text-muted-foreground"
                                    }`}
                                  >
                                    {obj.severity}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="pb-2 pt-0">
                            <div className="opacity-90 leading-relaxed">{obj.objection}</div>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sections.map((section) => (
            <AgentPanel
              key={section}
              section={section}
              draft={drafts[section]}
              revision={revisions[section]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function severityRank(severity: Objection["severity"]): number {
  if (severity === "fatal") return 0;
  if (severity === "major") return 1;
  return 2;
}

function AgentPanel({ section, draft, revision }: { section: string; draft: any; revision: any }) {
  const [showRevision, setShowRevision] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const currentContent = showRevision && revision ? revision : draft;
  const rawText = formatAgentContent(currentContent);

  return (
    <div className="rounded-xl border border-border bg-muted/10 p-3 flex flex-col h-full">
      <div className="flex justify-between items-center mb-2 gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section}</div>
        <div className="flex items-center gap-1.5">
          {revision && (
            <button
              type="button"
              onClick={() => setShowRevision(!showRevision)}
              className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                showRevision ? "bg-primary-soft text-primary border-primary/30" : "bg-panel text-muted-foreground"
              }`}
            >
              <RefreshCw className="size-2.5" />
              {showRevision ? "Revision" : "Draft"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowRaw((curr) => !curr)}
            className={`text-[10px] px-2 py-0.5 rounded-full border ${
              showRaw ? "bg-muted text-foreground border-border" : "bg-panel text-muted-foreground"
            }`}
          >
            {showRaw ? "Readable" : "Raw"}
          </button>
        </div>
      </div>
      <div className={`text-xs text-foreground/80 whitespace-pre-wrap flex-1 bg-panel border rounded-md p-2 max-h-56 overflow-y-auto ${showRaw ? "font-mono" : ""}`}>
        {showRaw ? <div>{rawText}</div> : <ReadableAgentContent value={currentContent} />}
      </div>
    </div>
  );
}

function ReadableAgentContent({ value }: { value: unknown }) {
  if (value == null) {
    return <div className="text-muted-foreground">No content returned.</div>;
  }
  const parsed = parseAgentContent(value);
  if (parsed == null) {
    return <MarkdownText text={String(value)} />;
  }
  return <RenderValue value={parsed} depth={0} />;
}

function parseAgentContent(value: unknown): unknown {
  if (typeof value === "object") return value;
  const text = String(value).trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function RenderValue({ value, depth }: { value: unknown; depth: number }) {
  if (value == null) return <span className="text-muted-foreground">n/a</span>;
  if (typeof value === "string") {
    return <MarkdownText text={value} />;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <span className="text-foreground/85">{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">No entries</span>;
    return (
      <ul className="space-y-1.5">
        {value.slice(0, 10).map((item, idx) => (
          <li key={idx} className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
            <RenderValue value={item} depth={depth + 1} />
          </li>
        ))}
        {value.length > 10 && <li className="text-[10px] text-muted-foreground">+{value.length - 10} more items</li>}
      </ul>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  return (
    <div className={`space-y-1.5 ${depth > 0 ? "pl-2 border-l border-border/60" : ""}`}>
      {entries.map(([key, item]) => (
        <div key={key} className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{humanizeKey(key)}</div>
          <RenderValue value={item} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}

function MarkdownText({ text }: { text: string }) {
  const trimmed = text.trim();
  if (!trimmed) return <span className="text-muted-foreground">No content returned.</span>;
  return (
    <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-headings:my-1 prose-headings:text-foreground prose-p:text-foreground/85 prose-strong:text-foreground prose-li:text-foreground/85 prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{trimmed}</ReactMarkdown>
    </div>
  );
}

function formatAgentContent(value: unknown): string {
  if (value == null) return "No content returned.";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  const text = String(value).trim();
  if (!text) return "No content returned.";

  // Best-effort pretty JSON rendering for string payloads.
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "object") return JSON.stringify(parsed, null, 2);
  } catch {
    // non-JSON text is rendered as-is
  }
  return text;
}

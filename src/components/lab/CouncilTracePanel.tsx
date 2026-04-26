import React, { useEffect, useRef } from "react";
import { PlanSSEEvent } from "@/lib/labApi";
import { Loader2, CheckCircle2, AlertTriangle, ShieldAlert } from "lucide-react";

export function CouncilTracePanel({ events }: { events: PlanSSEEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const councilOnlyEvents = events.filter(isCouncilEvent);
  if (councilOnlyEvents.length === 0) return null;
  const compactEvents = compactTraceEvents(councilOnlyEvents);

  return (
    <div className="rounded-2xl border border-border bg-panel shadow-sm overflow-hidden flex flex-col max-h-64">
      <div className="px-4 py-3 border-b border-border bg-muted/20">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Loader2 className="size-4 animate-spin text-primary" />
          Council Deliberation Trace
        </h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Specialist-agent events only; heartbeat noise collapsed.
        </p>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {compactEvents.map((ev, i) => (
          <TraceEvent key={i} event={ev} />
        ))}
      </div>
    </div>
  );
}

type CompactedHeartbeat = {
  type: "heartbeat_compacted";
  count: number;
};

function isCouncilEvent(event: PlanSSEEvent): boolean {
  if (event.type === "agent_draft" || event.type === "agent_revision" || event.type === "objections" || event.type === "metrics_complete") {
    return true;
  }
  if (event.type === "progress") {
    return event.stage === "round1" || event.stage === "round3" || event.stage === "heartbeat" || event.stage === "timeout_watch";
  }
  return false;
}

function compactTraceEvents(events: PlanSSEEvent[]): Array<PlanSSEEvent | CompactedHeartbeat> {
  const compacted: Array<PlanSSEEvent | CompactedHeartbeat> = [];
  let heartbeatCount = 0;

  const flushHeartbeat = () => {
    if (heartbeatCount > 0) {
      compacted.push({ type: "heartbeat_compacted", count: heartbeatCount });
      heartbeatCount = 0;
    }
  };

  for (const ev of events) {
    if (ev.type === "progress" && ev.stage === "heartbeat") {
      heartbeatCount += 1;
      continue;
    }
    flushHeartbeat();
    compacted.push(ev);
  }
  flushHeartbeat();
  return compacted;
}

function TraceEvent({ event }: { event: PlanSSEEvent | CompactedHeartbeat }) {
  let icon = <CheckCircle2 className="size-3.5 text-muted-foreground mt-0.5" />;
  let content = "";
  let tone = "text-foreground/80";
  
  if (event.type === "heartbeat_compacted") {
    content = `Council still working... (${event.count} heartbeat updates)`;
    icon = <Loader2 className="size-3.5 text-muted-foreground mt-0.5 animate-spin" />;
    tone = "text-muted-foreground";
  } else if (event.type === "progress") {
    if (event.stage === "round1") {
      content = event.message;
    } else if (event.stage === "round3") {
      content = event.message;
    } else if (event.stage === "timeout_watch") {
      content = event.message;
      icon = <AlertTriangle className="size-3.5 text-warning mt-0.5" />;
      tone = "text-warning";
    } else {
      content = event.message;
    }
    tone = event.stage === "heartbeat" ? "text-muted-foreground" : "text-foreground/80";
  } else if (event.type === "agent_draft") {
    content = `${event.agent} submitted draft for section ${event.section}`;
  } else if (event.type === "objections") {
    const fatal = event.fatal_count > 0;
    content = `Devil's Advocate raised ${event.items.length} objections (${event.fatal_count} fatal)`;
    icon = fatal ? <ShieldAlert className="size-3.5 text-danger mt-0.5" /> : <AlertTriangle className="size-3.5 text-warning mt-0.5" />;
    tone = fatal ? "text-danger" : "text-warning";
  } else if (event.type === "agent_revision") {
    content = `${event.agent} submitted revision for section ${event.section}`;
  } else if (event.type === "metrics_complete") {
    content = `Metrics computed • composite ${Math.round(event.scores.composite * 100)}/100`;
    icon = <CheckCircle2 className="size-3.5 text-success mt-0.5" />;
    tone = "text-foreground";
  }

  return (
    <div className="flex gap-2 text-xs leading-relaxed">
      <div className="shrink-0">{icon}</div>
      <div className={`${tone} break-words`}>{content}</div>
    </div>
  );
}

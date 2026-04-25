import { useState } from "react";
import { Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { fetchChatReply, type ChatCitation } from "@/lib/labApi";

type Message = {
  role: "agent" | "user";
  text: string;
  citations?: ChatCitation[];
  followUps?: string[];
};

function AgentBubble({ message }: { message: Message }) {
  return (
    <div className="max-w-[88%] rounded-xl border border-border bg-muted px-3 py-2.5 text-xs leading-relaxed text-foreground">
      <p>{message.text}</p>
      {message.citations && message.citations.length > 0 && (
        <div className="mt-2 space-y-1">
          {message.citations.map((citation) => (
            <div
              key={`${citation.title}-${citation.source}`}
              className="rounded-md border border-border bg-background/80 px-2 py-1 text-[10px] text-muted-foreground"
            >
              <span className="font-medium text-foreground">{citation.title}</span>
              <span> · {citation.source}</span>
            </div>
          ))}
        </div>
      )}
      {message.followUps && message.followUps.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {message.followUps.map((followUp) => (
            <span
              key={followUp}
              className="rounded-full border border-primary/25 bg-primary-soft px-2 py-1 text-[10px] text-primary"
            >
              {followUp}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Chatbot({ experimentId, hypothesis }: { experimentId: string; hypothesis: string }) {
  const starterPrompts = [
    "What is the weakest part of this plan?",
    "Which validation gate is most likely to fail first?",
    "Which materials are on the critical path?",
    "How did prior scientist reviews change this plan?",
  ];

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "agent",
      text:
        "I am your Scientist Copilot. Ask about novelty, validation gates, supply-chain risk, or how the latest reviews changed this plan.",
      followUps: starterPrompts.slice(0, 2),
    },
  ]);

  async function submitQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed || loading) {
      return;
    }

    setMessages((current) => [...current, { role: "user", text: trimmed }]);
    setInput("");
    setLoading(true);

    try {
      const reply = await fetchChatReply(experimentId, hypothesis, trimmed);
      setMessages((current) => [
        ...current,
        {
          role: "agent",
          text: reply.answer,
          citations: reply.citations,
          followUps: reply.followUps,
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          role: "agent",
          text:
            "The copilot could not reach the API just now. Start the API with `npm run api` and I will answer with grounded plan context.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
        aria-label="Open Scientist Copilot"
      >
        <MessageCircle className="size-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 flex h-[560px] w-[380px] flex-col overflow-hidden rounded-2xl border border-border bg-panel shadow-xl">
      <header className="border-b border-border bg-primary-soft px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">Scientist Copilot</div>
              <div className="text-[10px] text-muted-foreground">Grounded in the active plan and its review memory</div>
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
      </header>

      <div className="border-b border-border bg-background/70 px-3 py-2">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Fast prompts</div>
        <div className="flex flex-wrap gap-1.5">
          {starterPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => void submitQuestion(prompt)}
              className="rounded-full border border-border bg-panel px-2.5 py-1 text-[10px] text-foreground transition-colors hover:border-primary/30 hover:bg-primary-soft hover:text-primary"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 pt-2 text-[10px] text-muted-foreground truncate">Current hypothesis: {hypothesis}</div>

      <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {messages.map((message, index) =>
          message.role === "agent" ? (
            <AgentBubble key={`${message.role}-${index}`} message={message} />
          ) : (
            <div
              key={`${message.role}-${index}`}
              className="ml-auto max-w-[85%] rounded-xl bg-primary px-3 py-2 text-xs leading-relaxed text-primary-foreground"
            >
              {message.text}
            </div>
          ),
        )}
        {loading && (
          <div className="flex max-w-[80%] items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Checking sources, gates, and review memory...
          </div>
        )}
      </div>

      <form
        className="border-t border-border p-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submitQuestion(input);
        }}
      >
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about risk, novelty, cost, or validation..."
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            type="submit"
            disabled={loading || input.trim().length === 0}
            className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send className="size-3.5" />
          </button>
        </div>
      </form>
    </div>
  );
}

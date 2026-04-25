import { useState } from "react";
import { MessageCircle, X, Send, Sparkles } from "lucide-react";

const seed = [
  { role: "agent", text: "Hi — I'm your Lab Copilot. Ask me anything about the current protocol." },
  { role: "user", text: "Why centrifuge at 4000 rpm and not 6000?" },
  { role: "agent", text: "4000 rpm pellets E. coli cleanly without shearing. 6000 rpm risks lysis before sonication, cutting yield ~18% (Nature Methods, 2023)." },
];

export function Chatbot() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 size-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-105 transition-transform flex items-center justify-center"
        aria-label="Open Lab Copilot"
      >
        <MessageCircle className="size-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 w-80 h-[480px] rounded-xl bg-panel border border-border shadow-xl flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-primary-soft">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
            <Sparkles className="size-3.5" />
          </div>
          <div>
            <div className="text-sm font-semibold">Lab Copilot</div>
            <div className="text-[10px] text-muted-foreground">Grounded in your protocol</div>
          </div>
        </div>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {seed.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] text-xs leading-relaxed px-3 py-2 rounded-lg ${
              m.role === "agent"
                ? "bg-muted text-foreground"
                : "bg-primary text-primary-foreground ml-auto"
            }`}
          >
            {m.text}
          </div>
        ))}
      </div>
      <form className="border-t border-border p-2 flex items-center gap-2">
        <input
          placeholder="Ask the copilot…"
          className="flex-1 text-xs px-3 py-2 rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button type="button" className="size-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
          <Send className="size-3.5" />
        </button>
      </form>
    </div>
  );
}

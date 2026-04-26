import { createRoot } from "react-dom/client";
import { Component, type ReactNode, type ErrorInfo } from "react";
import App from "./App.tsx";
import "./index.css";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("React crash:", error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ fontFamily: "monospace", padding: "2rem", background: "#fff", color: "#c00" }}>
          <h2>App crashed — error below</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: "12px" }}>{(this.state.error as Error).message}{"\n"}{(this.state.error as Error).stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

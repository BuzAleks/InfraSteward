import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { logSystemEvent } from "./lib/backend";
import "./styles/app.css";

window.addEventListener("error", (event) => {
  void logSystemEvent({
    level: "error",
    target: "frontend",
    message: event.message || "Unhandled frontend error.",
    details: [event.filename, event.lineno, event.colno].filter(Boolean).join(": ")
  });
});

window.addEventListener("unhandledrejection", (event) => {
  void logSystemEvent({
    level: "error",
    target: "frontend",
    message: "Unhandled promise rejection.",
    details: String(event.reason)
  });
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

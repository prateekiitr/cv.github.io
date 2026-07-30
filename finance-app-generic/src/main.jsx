import React from "react";
import { createRoot } from "react-dom/client";
import Dashboard from "./Dashboard.jsx";

/* ------------------------------------------------------------------
   window.storage polyfill — the dashboard was originally built for
   Claude's artifact sandbox, which provides window.storage backed by
   per-user server-side keys. Outside that sandbox we back the same
   API with the browser's localStorage, so nothing in Dashboard.jsx
   has to change. "shared" data isn't meaningful in a single-user
   local app, so it's stored the same way as personal data.
------------------------------------------------------------------- */
const PREFIX = "finance-dashboard-storage:";

window.storage = {
  async get(key) {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) throw new Error(`key not found: ${key}`);
    return { key, value: raw, shared: false };
  },
  async set(key, value) {
    localStorage.setItem(PREFIX + key, value);
    return { key, value, shared: false };
  },
  async delete(key) {
    localStorage.removeItem(PREFIX + key);
    return { key, deleted: true, shared: false };
  },
  async list(prefix) {
    const keys = Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .map((k) => k.slice(PREFIX.length))
      .filter((k) => !prefix || k.startsWith(prefix));
    return { keys, prefix, shared: false };
  },
};

createRoot(document.getElementById("root")).render(<Dashboard />);

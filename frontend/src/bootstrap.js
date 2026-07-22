import { resolveBrowserLanguage, setActiveLanguage, tx } from "./i18n/core.js";

const projectStorageKey = "mukai.processingState.v1";
setActiveLanguage(resolveBrowserLanguage());
document.documentElement.lang = setActiveLanguage(resolveBrowserLanguage());

const shell = document.getElementById("bootstrap-reset-shell");
const message = document.getElementById("bootstrap-reset-message");
const button = document.getElementById("bootstrap-reset-button");
if (message) message.textContent = tx("app.startupError");
if (button) button.lastChild.textContent = ` ${tx("app.restart")}`;

let rawState = null;
try {
  rawState = window.localStorage.getItem(projectStorageKey);
} catch {
  rawState = null;
}

if (rawState && shell && button) {
  shell.hidden = false;
  button.addEventListener("click", async () => {
    if (!window.confirm(tx("app.restartConfirm"))) return;
    let state = {};
    try { state = JSON.parse(rawState); } catch { state = {}; }
    const payload = { jobId: state.job?.jobId ?? null, uploadDraftId: state.inspection?.uploadDraftId ?? null };
    try { window.localStorage.removeItem(projectStorageKey); } catch {}
    try { window.sessionStorage.clear(); } catch {}
    try {
      if ("caches" in window) {
        const names = await window.caches.keys();
        await Promise.all(names.map((name) => window.caches.delete(name)));
      }
      if (payload.jobId || payload.uploadDraftId) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 5000);
        try {
          await fetch("/api/reset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            keepalive: true,
            signal: controller.signal,
          });
        } finally {
          window.clearTimeout(timeout);
        }
      }
    } finally {
      window.location.replace(window.location.pathname);
    }
  });
}


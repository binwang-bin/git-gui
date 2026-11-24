import { api } from "./api";
import { t } from "./i18n";
import { useApp } from "./store";
import { askConfirm } from "./uiDialogs";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable;
}

/** Register global VCS shortcuts. Returns cleanup. */
export function bindShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target) && e.key !== "Escape") return;

    const s = useApp.getState();
    const root = s.root;
    if (!root) return;

    const path = s.selectedPaths[0];
    const ctrl = e.ctrlKey || e.metaKey;

    // Ctrl+Shift+K → Push dialog
    if (ctrl && e.shiftKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      s.setSyncDialog("push");
      return;
    }
    // Ctrl+T → Pull dialog
    if (ctrl && !e.shiftKey && e.key.toLowerCase() === "t") {
      e.preventDefault();
      s.setSyncDialog("pull");
      return;
    }
    // Ctrl+Shift+F → Fetch dialog
    if (ctrl && e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      s.setSyncDialog("fetch");
      return;
    }
    // Ctrl+D → Show Diff
    if (ctrl && !e.shiftKey && e.key.toLowerCase() === "d") {
      if (!path) return;
      e.preventDefault();
      const f = s.status.find((x) => x.relPath === path);
      void s.selectFile(path, !!(f?.staged && !f.unstaged));
      return;
    }
    // F4 → Jump to source
    if (e.key === "F4" && path) {
      e.preventDefault();
      void api.openPath(`${root}/${path}`.replace(/\\/g, "/"));
      return;
    }
    // Ctrl+Alt+Z → Rollback
    if (ctrl && e.altKey && e.key.toLowerCase() === "z") {
      const paths = s.selectedPaths.length
        ? s.selectedPaths
        : Object.keys(s.checkedPaths).filter((p) => s.checkedPaths[p]);
      if (!paths.length) return;
      e.preventDefault();
      const locale = s.locale;
      void (async () => {
        const ok = await askConfirm({
          title: t(locale, "rollback"),
          message: paths.join("\n"),
          danger: true,
        });
        if (!ok) return;
        void s.run(() => api.discard(root, paths));
      })();
      return;
    }
    // Ctrl+Alt+A → Stage / Add to VCS
    if (ctrl && e.altKey && e.key.toLowerCase() === "a") {
      const paths = s.selectedPaths.length
        ? s.selectedPaths
        : Object.keys(s.checkedPaths).filter((p) => s.checkedPaths[p]);
      if (!paths.length) return;
      e.preventDefault();
      void s.run(() => api.stage(root, paths));
      return;
    }
    // Delete → delete untracked selected
    if (e.key === "Delete" && path) {
      const f = s.status.find((x) => x.relPath === path);
      if (!f || (f.unstaged !== "untracked" && f.staged !== "untracked")) return;
      e.preventDefault();
      const locale = s.locale;
      void (async () => {
        const ok = await askConfirm({
          title: t(locale, "delete"),
          message: path,
          danger: true,
        });
        if (!ok) return;
        void s.run(() => api.deletePaths(root, [path]));
      })();
    }
  };

  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

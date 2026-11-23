import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { api } from "../api";
import { t, tf } from "../i18n";
import { useApp } from "../store";
import { openRepoInNewWindow } from "../windowing";
import { CommitToolWindow } from "./CommitToolWindow";
import { DiffView } from "./DiffView";
import { LogPanel } from "./LogView";
import { ProjectTree } from "./ProjectTree";
import { SyncDialogs } from "./SyncDialogs";

const LOG_HEIGHT_KEY = "git-gui.logHeight";
const LOG_HEIGHT_MIN = 140;
const LOG_HEIGHT_DEFAULT = 320;

function loadLogHeight(): number {
  const n = Number(localStorage.getItem(LOG_HEIGHT_KEY));
  return Number.isFinite(n) && n >= LOG_HEIGHT_MIN ? n : LOG_HEIGHT_DEFAULT;
}

export function Workbench() {
  const locale = useApp((s) => s.locale);
  const root = useApp((s) => s.root)!;
  const leftTool = useApp((s) => s.leftTool);
  const setLeftTool = useApp((s) => s.setLeftTool);
  const setCommitTab = useApp((s) => s.setCommitTab);
  const setBottomTab = useApp((s) => s.setBottomTab);
  const branch = useApp((s) => s.branch);
  const busy = useApp((s) => s.busy);
  const error = useApp((s) => s.error);
  const refresh = useApp((s) => s.refresh);
  const closeRoot = useApp((s) => s.closeRoot);
  const run = useApp((s) => s.run);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const setLocale = useApp((s) => s.setLocale);
  const syncDialog = useApp((s) => s.syncDialog);
  const setSyncDialog = useApp((s) => s.setSyncDialog);
  const name = root.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? root;
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [logHeight, setLogHeight] = useState(loadLogHeight);
  const dragging = useRef(false);

  const clampLogHeight = useCallback((px: number) => {
    const max = Math.max(
      LOG_HEIGHT_MIN,
      (workspaceRef.current?.clientHeight ?? window.innerHeight) - 120,
    );
    return Math.min(max, Math.max(LOG_HEIGHT_MIN, Math.round(px)));
  }, []);

  const onResizeStart = (e: ReactMouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.classList.add("resizing-row");
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !workspaceRef.current) return;
      const rect = workspaceRef.current.getBoundingClientRect();
      const next = clampLogHeight(rect.bottom - ev.clientY);
      setLogHeight(next);
    };
    const onUp = () => {
      dragging.current = false;
      document.body.classList.remove("resizing-row");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setLogHeight((h) => {
        localStorage.setItem(LOG_HEIGHT_KEY, String(h));
        return h;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const openAnother = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    try {
      const discovered = await api.discover(selected);
      await openRepoInNewWindow(discovered);
    } catch (e) {
      useApp.setState({ error: String(e) });
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void openAnother();
      }
      if (e.ctrlKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        void refresh();
      }
      if (e.ctrlKey && e.key.toLowerCase() === "enter") {
        e.preventDefault();
        const s = useApp.getState();
        if (s.message.trim()) {
          void s.run(async () => {
            await api.commit(root, s.message.trim(), s.amend, s.signOff);
            s.setMessage("");
            s.setAmend(false);
          });
        }
      }
      if (e.altKey && e.key === "1") {
        e.preventDefault();
        setLeftTool("project");
      }
      if (e.altKey && e.key === "0") {
        e.preventDefault();
        setLeftTool("commit");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openAnother, refresh, root, setLeftTool]);

  return (
    <div className="app" style={{ position: "relative" }}>
      <div className="titlebar">
        <div className="brand">
          <span className="brand-mark">GG</span>
          <span>{name}</span>
        </div>
        <button
          className="branch-chip"
          onClick={() => setBottomTab("branches")}
          title={t(locale, "branches")}
        >
          <span>⎇</span>
          <span>{branch?.head ?? "detached"}</span>
          {branch && (
            <span className="tracking">
              ↑{branch.ahead} ↓{branch.behind}
            </span>
          )}
        </button>
        <div className="title-spacer" />
        <div className="title-actions">
          <button
            className="ghost"
            disabled={busy}
            title={`${t(locale, "openAnother")} (Ctrl+O)`}
            onClick={() => void openAnother()}
          >
            {t(locale, "openAnother")}
          </button>
          <button className="icon-btn" title={t(locale, "refresh")} onClick={() => void refresh()}>
            ↻
          </button>
          <button
            className="icon-btn"
            title={t(locale, "theme")}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            ◐
          </button>
          <button
            className="icon-btn"
            title={t(locale, "language")}
            onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
          >
            文
          </button>
          <button className="ghost" onClick={closeRoot}>
            {t(locale, "closeRepo")}
          </button>
        </div>
      </div>

      {error && <div className="error-bar">{error}</div>}
      {branch?.operation && (
        <div className="op-banner">
          <span>{tf(locale, "operationInProgress", { op: branch.operation })}</span>
          <button className="secondary" onClick={() => void run(() => api.continueOp(root))}>
            {t(locale, "continue")}
          </button>
          <button className="danger-text" onClick={() => void run(() => api.abortOp(root))}>
            {t(locale, "abort")}
          </button>
        </div>
      )}

      <div className="shell">
        <div className="activity">
          <button
            className={leftTool === "project" ? "active" : ""}
            title={`${t(locale, "project")} (Alt+1)`}
            onClick={() => setLeftTool("project")}
          >
            📂
          </button>
          <button
            className={leftTool === "commit" ? "active" : ""}
            title={t(locale, "commitTool")}
            onClick={() => {
              setLeftTool("commit");
              setCommitTab("changes");
            }}
          >
            ⎇
          </button>
          <div className="grow" />
          <button
            className="icon-btn"
            title="Settings"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            ⚙
          </button>
        </div>

        <div
          className="workspace"
          ref={workspaceRef}
          style={{ ["--log-height" as string]: `${logHeight}px` }}
        >
          <div className={`upper ${leftTool === "project" ? "with-project" : ""}`}>
            {leftTool === "project" ? (
              <>
                <ProjectTree />
                <div className="diff-host">
                  <DiffView />
                </div>
              </>
            ) : (
              <CommitToolWindow />
            )}
          </div>
          <div
            className="v-split"
            role="separator"
            aria-orientation="horizontal"
            aria-valuenow={logHeight}
            title={t(locale, "dragToResize")}
            onMouseDown={onResizeStart}
          />
          <LogPanel />
        </div>
      </div>

      {busy && <div className="busy-toast">{t(locale, "loading")}</div>}
      <SyncDialogs kind={syncDialog} onClose={() => setSyncDialog(null)} />
    </div>
  );
}

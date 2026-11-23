import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { t, tf } from "../i18n";
import { useApp } from "../store";
import type { ChangedFile, ChangeKind } from "../types";
import { useContextMenu, type MenuItem } from "./ContextMenu";

function cleanMessage(msg: string): string {
  return msg.replace(/^On [^:]+:\s*/, "").replace(/^WIP on [^:]+:\s*/, "").trim() || msg;
}

function parseStashMeta(msg: string): { title: string; branch: string | null } {
  const m = msg.match(/^(?:WIP on|On) ([^:]+):\s*(.*)$/s);
  if (m) {
    const branch = m[1].trim();
    const rest = (m[2] || "").trim();
    return { branch, title: rest || branch };
  }
  return { branch: null, title: cleanMessage(msg) };
}

function splitPath(rel: string): { base: string; dir: string } {
  const norm = rel.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  if (i < 0) return { base: norm, dir: "" };
  return { base: norm.slice(i + 1), dir: norm.slice(0, i) };
}

function statusLetter(kind: ChangeKind): string {
  switch (kind) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "conflicted":
      return "C";
    case "untracked":
      return "?";
    default:
      return "M";
  }
}

export function StashView() {
  const locale = useApp((s) => s.locale);
  const root = useApp((s) => s.root)!;
  const stashes = useApp((s) => s.stashes);
  const selected = useApp((s) => s.selectedStash);
  const selectedPath = useApp((s) => s.selectedStashPath);
  const stashFiles = useApp((s) => s.stashFiles);
  const selectStash = useApp((s) => s.selectStash);
  const selectStashFile = useApp((s) => s.selectStashFile);
  const run = useApp((s) => s.run);
  const refresh = useApp((s) => s.refresh);
  const { openMenu, menuNode } = useContextMenu();
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [fileCache, setFileCache] = useState<Record<number, ChangedFile[]>>({});

  // Invalidate file cache when stash list changes (drop/pop/clear).
  useEffect(() => {
    setFileCache({});
  }, [stashes]);

  // Keep cache in sync with store files for the selected stash.
  useEffect(() => {
    if (selected == null || !stashFiles.length) return;
    setFileCache((c) => ({ ...c, [selected]: stashFiles }));
    setExpanded((e) => ({ ...e, [selected]: true }));
  }, [selected, stashFiles]);

  const loadFiles = useCallback(
    async (index: number) => {
      if (fileCache[index]?.length) return fileCache[index];
      const files = await api.stashFiles(root, index);
      setFileCache((c) => ({ ...c, [index]: files }));
      return files;
    },
    [fileCache, root],
  );

  const toggleExpand = async (index: number) => {
    const next = !expanded[index];
    setExpanded((e) => ({ ...e, [index]: next }));
    if (next) {
      try {
        await loadFiles(index);
      } catch (err) {
        useApp.setState({ error: String(err) });
      }
    }
  };

  const menu = (_index: number): MenuItem[] => [
    { id: "apply", label: t(locale, "apply") },
    { id: "pop", label: t(locale, "pop") },
    { id: "sep", label: "", separator: true },
    { id: "drop", label: t(locale, "dropStash"), danger: true },
  ];

  const act = (index: number, id: string) => {
    void run(async () => {
      if (id === "apply") await api.stashApply(root, index, false);
      if (id === "pop") await api.stashApply(root, index, true);
      if (id === "drop") {
        if (!confirm(tf(locale, "dropStashConfirm", { index }))) return;
        await api.stashDrop(root, index);
      }
    });
  };

  const filesFor = (index: number): ChangedFile[] => {
    if (selected === index && stashFiles.length) return stashFiles;
    return fileCache[index] ?? [];
  };

  return (
    <div className="stash-panel">
      <div className="toolbar-row">
        <button className="icon-btn" title={t(locale, "refresh")} onClick={() => void refresh()}>
          ↻
        </button>
        <button
          className="icon-btn"
          title={t(locale, "apply")}
          disabled={selected == null}
          onClick={() => selected != null && act(selected, "apply")}
        >
          ✓
        </button>
        <button
          className="icon-btn danger-text"
          title={t(locale, "dropStash")}
          disabled={selected == null}
          onClick={() => selected != null && act(selected, "drop")}
        >
          🗑
        </button>
        <span className="sep" />
        <button
          className="primary"
          onClick={() => {
            const message = prompt(t(locale, "stashPush")) ?? undefined;
            void run(() => api.stashPush(root, message || null));
          }}
        >
          {t(locale, "stashPush")}
        </button>
        <div className="title-spacer" />
        <button
          className="danger-text ghost"
          disabled={!stashes.length}
          onClick={() => {
            if (!confirm(t(locale, "clearAllStashes"))) return;
            void run(() => api.stashClear(root));
          }}
        >
          {t(locale, "clear")}
        </button>
      </div>
      <div className="stash-list">
        {stashes.map((s) => {
          const meta = parseStashMeta(s.message);
          const open = !!expanded[s.index];
          const files = filesFor(s.index);
          return (
            <div key={s.index} className="stash-block">
              <div
                className={`stash-row ${selected === s.index ? "selected" : ""}`}
                onClick={() => {
                  void selectStash(s.index);
                  setExpanded((e) => ({ ...e, [s.index]: true }));
                }}
                onContextMenu={(e) => openMenu(e, menu(s.index), (id) => act(s.index, id))}
              >
                <button
                  type="button"
                  className="stash-twisty"
                  aria-label={open ? "Collapse" : "Expand"}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleExpand(s.index);
                  }}
                >
                  {open ? "▾" : "▸"}
                </button>
                <div className="stash-row-main">
                  <div className="stash-title">{meta.title}</div>
                  <div className="stash-meta">
                    <span>{meta.branch ?? `stash@{${s.index}}`}</span>
                    <span>{s.time ? new Date(s.time * 1000).toLocaleString() : ""}</span>
                  </div>
                </div>
              </div>
              {open && (
                <div className="stash-files">
                  {files.map((f) => {
                    const { base, dir } = splitPath(f.path);
                    const active = selected === s.index && selectedPath === f.path;
                    return (
                      <div
                        key={f.path}
                        className={`stash-file-row ${active ? "selected" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void selectStashFile(s.index, f.path);
                        }}
                      >
                        <span className={`status ${f.status}`}>{statusLetter(f.status)}</span>
                        <span className="basename">{base}</span>
                        {dir ? <span className="dirname">{dir}</span> : null}
                      </div>
                    );
                  })}
                  {!files.length && (
                    <div className="empty-hint" style={{ padding: "4px 12px 8px 28px" }}>
                      —
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!stashes.length && <div className="empty-hint">{t(locale, "noStash")}</div>}
      </div>
      {menuNode}
    </div>
  );
}

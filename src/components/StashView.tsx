import { api } from "../api";
import { t, tf } from "../i18n";
import { useApp } from "../store";
import { useContextMenu, type MenuItem } from "./ContextMenu";

function cleanMessage(msg: string): string {
  return msg.replace(/^On [^:]+:\s*/, "").trim() || msg;
}

export function StashView() {
  const locale = useApp((s) => s.locale);
  const root = useApp((s) => s.root)!;
  const stashes = useApp((s) => s.stashes);
  const selected = useApp((s) => s.selectedStash);
  const selectStash = useApp((s) => s.selectStash);
  const run = useApp((s) => s.run);
  const refresh = useApp((s) => s.refresh);
  const { openMenu, menuNode } = useContextMenu();

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
        {stashes.map((s) => (
          <div
            key={s.index}
            className={`stash-row ${selected === s.index ? "selected" : ""}`}
            onClick={() => void selectStash(s.index)}
            onContextMenu={(e) => openMenu(e, menu(s.index), (id) => act(s.index, id))}
          >
            <div className="stash-title">{cleanMessage(s.message)}</div>
            <div className="stash-meta">
              <span>stash@{"{"}{s.index}{"}"}</span>
              <span>{s.time ? new Date(s.time * 1000).toLocaleString() : ""}</span>
            </div>
          </div>
        ))}
        {!stashes.length && <div className="empty-hint">{t(locale, "noStash")}</div>}
      </div>
      {menuNode}
    </div>
  );
}

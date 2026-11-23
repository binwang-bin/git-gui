import { useEffect, useState } from "react";
import { api } from "../api";
import { t, tf } from "../i18n";
import { useApp } from "../store";
import type { Remote } from "../types";

/** OpenIDEA-style Git Remotes manager dialog. */
export function RemotesDialog(props: { open: boolean; onClose: () => void }) {
  const locale = useApp((s) => s.locale);
  const root = useApp((s) => s.root)!;
  const remotes = useApp((s) => s.remotes);
  const refresh = useApp((s) => s.refresh);
  const run = useApp((s) => s.run);
  const [selected, setSelected] = useState<string | null>(null);
  const [list, setList] = useState<Remote[]>(remotes);

  useEffect(() => {
    if (props.open) {
      setList(remotes);
      setSelected((prev) =>
        remotes.some((r) => r.name === prev) ? prev : (remotes[0]?.name ?? null),
      );
    }
  }, [props.open, remotes]);

  if (!props.open) return null;

  const selectedRemote = list.find((r) => r.name === selected) ?? null;

  const addRemote = () => {
    const name = prompt(t(locale, "remoteName"), "origin");
    if (!name?.trim()) return;
    const url = prompt(t(locale, "remoteUrl"));
    if (!url?.trim()) return;
    void run(async () => {
      await api.setRemoteUrl(root, name.trim(), url.trim());
      await refresh();
    });
  };

  const editRemote = () => {
    if (!selectedRemote) return;
    const url = prompt(
      tf(locale, "editUrlFor", { name: selectedRemote.name }),
      selectedRemote.fetchUrl,
    );
    if (!url?.trim()) return;
    void run(async () => {
      await api.setRemoteUrl(root, selectedRemote.name, url.trim());
      await refresh();
    });
  };

  const removeRemote = () => {
    if (!selectedRemote) return;
    const ok = confirm(tf(locale, "deleteRemoteConfirm", { name: selectedRemote.name }));
    if (!ok) return;
    void run(async () => {
      await api.removeRemote(root, selectedRemote.name);
      await refresh();
    });
  };

  return (
    <div className="diff-popup-backdrop" onClick={props.onClose}>
      <div
        className="remotes-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t(locale, "gitRemotes")}
      >
        <div className="diff-popup-bar">
          <strong>{t(locale, "gitRemotes")}</strong>
          <div className="title-spacer" />
          <button type="button" className="icon-btn" title="+" onClick={addRemote}>
            +
          </button>
          <button
            type="button"
            className="icon-btn"
            title="−"
            disabled={!selectedRemote}
            onClick={removeRemote}
          >
            −
          </button>
          <button
            type="button"
            className="icon-btn"
            title={t(locale, "edit")}
            disabled={!selectedRemote}
            onClick={editRemote}
          >
            ✎
          </button>
          <button type="button" className="icon-btn" onClick={props.onClose}>
            ×
          </button>
        </div>
        <div className="remotes-table">
          <div className="remotes-head">
            <span>{t(locale, "name")}</span>
            <span>URL</span>
          </div>
          <div className="remotes-body">
            {list.map((r) => (
              <div
                key={r.name}
                className={`remotes-row ${selected === r.name ? "selected" : ""}`}
                onClick={() => setSelected(r.name)}
                onDoubleClick={() => {
                  setSelected(r.name);
                  queueMicrotask(editRemote);
                }}
              >
                <span className="remotes-name">{r.name}</span>
                <span className="remotes-url" title={r.fetchUrl}>
                  {r.fetchUrl}
                </span>
              </div>
            ))}
            {!list.length && (
              <div className="empty-hint">{t(locale, "noRemotes")}</div>
            )}
          </div>
        </div>
        <div className="remotes-footer">
          <button type="button" className="primary" onClick={props.onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export function RemotesView() {
  const locale = useApp((s) => s.locale);
  const [open, setOpen] = useState(false);
  return (
    <div style={{ padding: 12 }}>
      <button className="primary" onClick={() => setOpen(true)}>
        {t(locale, "manageRemotes")}
      </button>
      <RemotesDialog open={open} onClose={() => setOpen(false)} />
      <p style={{ color: "var(--fg-subtle)", fontSize: 12, marginTop: 12 }}>
        {t(locale, "remotes")}
      </p>
    </div>
  );
}

import { useEffect, useState } from "react";
import { api } from "../api";
import { t, tf } from "../i18n";
import { useApp } from "../store";
import type { Remote } from "../types";
import { ConfirmDialog, RemoteFormDialog } from "./GitDialogs";

/** OpenIDEA-style Git Remotes manager dialog. */
export function RemotesDialog(props: { open: boolean; onClose: () => void }) {
  const locale = useApp((s) => s.locale);
  const root = useApp((s) => s.root)!;
  const remotes = useApp((s) => s.remotes);
  const refresh = useApp((s) => s.refresh);
  const run = useApp((s) => s.run);
  const [selected, setSelected] = useState<string | null>(null);
  const [list, setList] = useState<Remote[]>(remotes);
  const [form, setForm] = useState<null | { mode: "add" | "edit" }>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

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

  return (
    <>
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
            <button type="button" className="icon-btn" title="+" onClick={() => setForm({ mode: "add" })}>
              +
            </button>
            <button
              type="button"
              className="icon-btn"
              title="−"
              disabled={!selectedRemote}
              onClick={() => setDeleteOpen(true)}
            >
              −
            </button>
            <button
              type="button"
              className="icon-btn"
              title={t(locale, "edit")}
              disabled={!selectedRemote}
              onClick={() => setForm({ mode: "edit" })}
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
                    setForm({ mode: "edit" });
                  }}
                >
                  <span className="remotes-name">{r.name}</span>
                  <span className="remotes-url" title={r.fetchUrl}>
                    {r.fetchUrl}
                  </span>
                </div>
              ))}
              {!list.length && <div className="empty-hint">{t(locale, "noRemotes")}</div>}
            </div>
          </div>
          <div className="remotes-footer">
            <button type="button" className="primary" onClick={props.onClose}>
              {t(locale, "ok")}
            </button>
          </div>
        </div>
      </div>

      <RemoteFormDialog
        open={!!form}
        mode={form?.mode ?? "add"}
        initialName={form?.mode === "edit" ? selectedRemote?.name : "origin"}
        initialUrl={form?.mode === "edit" ? selectedRemote?.fetchUrl : ""}
        onClose={() => setForm(null)}
        onConfirm={(name, url) => {
          setForm(null);
          void run(async () => {
            await api.setRemoteUrl(root, name, url);
            await refresh();
          });
        }}
      />

      <ConfirmDialog
        open={deleteOpen && !!selectedRemote}
        title={t(locale, "deleteRemoteTitle")}
        message={
          selectedRemote
            ? tf(locale, "deleteRemoteConfirm", { name: selectedRemote.name })
            : ""
        }
        danger
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          if (!selectedRemote) return;
          setDeleteOpen(false);
          void run(async () => {
            await api.removeRemote(root, selectedRemote.name);
            await refresh();
          });
        }}
      />
    </>
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

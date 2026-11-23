import { useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { useApp } from "../store";
import { Modal } from "./Modal";

export type SyncKind = "fetch" | "pull" | "push" | null;

export function SyncDialogs(props: { kind: SyncKind; onClose: () => void }) {
  const locale = useApp((s) => s.locale);
  const root = useApp((s) => s.root)!;
  const outgoing = useApp((s) => s.outgoing);
  const run = useApp((s) => s.run);
  const refresh = useApp((s) => s.refresh);
  const [rebase, setRebase] = useState(false);
  const [force, setForce] = useState(false);

  const close = () => {
    setRebase(false);
    setForce(false);
    props.onClose();
  };

  if (props.kind === "fetch") {
    return (
      <Modal
        open
        title={t(locale, "fetchTitle")}
        onClose={close}
        primaryLabel={t(locale, "fetch")}
        onPrimary={() => {
          void run(async () => {
            await api.fetch(root);
            await refresh();
            close();
          });
        }}
      >
        <p className="modal-text">{t(locale, "fetchDesc")}</p>
      </Modal>
    );
  }

  if (props.kind === "pull") {
    return (
      <Modal
        open
        title={t(locale, "pullTitle")}
        onClose={close}
        primaryLabel={t(locale, "pull")}
        onPrimary={() => {
          void run(async () => {
            await api.pull(root, rebase);
            await refresh();
            close();
          });
        }}
      >
        <p className="modal-text">{t(locale, "pullDesc")}</p>
        <label className="modal-radio">
          <input type="radio" checked={!rebase} onChange={() => setRebase(false)} />
          {t(locale, "pullMerge")}
        </label>
        <label className="modal-radio">
          <input type="radio" checked={rebase} onChange={() => setRebase(true)} />
          {t(locale, "pullUsingRebaseOpt")}
        </label>
      </Modal>
    );
  }

  if (props.kind === "push") {
    return (
      <Modal
        open
        title={t(locale, "pushTitle")}
        onClose={close}
        wide
        primaryLabel={t(locale, "push")}
        primaryDanger={force}
        onPrimary={() => {
          void run(async () => {
            await api.push(root, force);
            await refresh();
            close();
          });
        }}
      >
        <p className="modal-text">{t(locale, "pushDesc")}</p>
        <label className="modal-check">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          {t(locale, "forcePush")}
        </label>
        <div className="outgoing-block">
          <div className="section-label">{t(locale, "outgoing")}</div>
          {outgoing.length === 0 ? (
            <div className="empty-hint">{t(locale, "noOutgoing")}</div>
          ) : (
            <div className="outgoing-list">
              {outgoing.map((c) => (
                <div key={c.id} className="outgoing-row">
                  <span className="hash">{c.shortId}</span>
                  <span className="summary" title={c.summary}>
                    {c.summary}
                  </span>
                  <span className="meta">{c.author}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    );
  }

  return null;
}

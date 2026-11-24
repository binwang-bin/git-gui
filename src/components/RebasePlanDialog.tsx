import { useMemo, useState } from "react";
import { api } from "../api";
import { t, type MessageKey } from "../i18n";
import { useApp } from "../store";
import type { Commit, Locale, RebaseAction, RebaseEntry } from "../types";
import { Modal } from "./Modal";

const ACTIONS: RebaseAction[] = ["pick", "reword", "edit", "squash", "fixup", "drop"];

const ACTION_KEYS: Record<RebaseAction, MessageKey> = {
  pick: "rebasePick",
  reword: "rebaseReword",
  edit: "rebaseEdit",
  squash: "rebaseSquash",
  fixup: "rebaseFixup",
  drop: "rebaseDrop",
};

function actionLabel(locale: Locale, a: RebaseAction): string {
  return t(locale, ACTION_KEYS[a]);
}

type Row = RebaseEntry & { shortId: string; summary: string };

function buildRows(commits: Commit[], ontoId: string): Row[] {
  // Commits from HEAD down to (but not including) onto, then reverse to oldest-first.
  const byId = new Map(commits.map((c) => [c.id, c]));
  const ordered: Commit[] = [];
  const head =
    commits.find((c) => c.refs.includes("HEAD")) ?? commits[0] ?? null;
  if (!head) return [];
  let cur: Commit | undefined = head;
  const seen = new Set<string>();
  while (cur && cur.id !== ontoId && !seen.has(cur.id)) {
    seen.add(cur.id);
    ordered.push(cur);
    const parentId: string | undefined = cur.parents[0];
    cur = parentId ? byId.get(parentId) : undefined;
    if (!cur && parentId) {
      // Parent not in the loaded page — stop; plan may be incomplete.
      break;
    }
  }
  ordered.reverse();
  return ordered.map((c) => ({
    commit: c.id,
    action: "pick" as RebaseAction,
    message: null,
    shortId: c.shortId,
    summary: c.summary,
  }));
}

export function RebasePlanDialog(props: {
  onto: Commit;
  onClose: () => void;
}) {
  const locale = useApp((s) => s.locale);
  const root = useApp((s) => s.root)!;
  const commits = useApp((s) => s.commits);
  const run = useApp((s) => s.run);
  const initial = useMemo(() => buildRows(commits, props.onto.id), [commits, props.onto.id]);
  const [rows, setRows] = useState<Row[]>(initial);

  const setAction = (i: number, action: RebaseAction) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, action } : r)));
  };

  const setMessage = (i: number, message: string) => {
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, message: message || null } : r)),
    );
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    setRows((prev) => {
      const next = [...prev];
      const tmp = next[i]!;
      next[i] = next[j]!;
      next[j] = tmp;
      return next;
    });
  };

  const start = () => {
    void run(async () => {
      const entries: RebaseEntry[] = rows.map(({ commit, action, message }) => ({
        commit,
        action,
        message: message ?? null,
      }));
      await api.interactiveRebase(root, props.onto.id, entries);
      props.onClose();
    });
  };

  return (
    <Modal open title={t(locale, "rebasePlan")} onClose={props.onClose} wide>
      <p className="modal-text">
        {t(locale, "rebaseOntoCommit")}:{" "}
        <code>
          {props.onto.shortId} {props.onto.summary}
        </code>
      </p>
      {!rows.length ? (
        <p className="modal-text">{t(locale, "rebaseNoCommits")}</p>
      ) : (
        <div className="rebase-plan-list">
          {rows.map((r, i) => (
            <div key={r.commit} className="rebase-plan-row">
              <div className="rebase-plan-move">
                <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={i === rows.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
              </div>
              <select
                value={r.action}
                onChange={(e) => setAction(i, e.target.value as RebaseAction)}
                aria-label={t(locale, "interactiveRebase")}
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {actionLabel(locale, a)}
                  </option>
                ))}
              </select>
              <code className="rebase-sha">{r.shortId}</code>
              <span className="rebase-summary" title={r.summary}>
                {r.summary}
              </span>
              {(r.action === "reword" || r.action === "squash") && (
                <input
                  className="rebase-msg"
                  placeholder={t(locale, "message")}
                  value={r.message ?? ""}
                  onChange={(e) => setMessage(i, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={props.onClose}>
          {t(locale, "cancel")}
        </button>
        <button
          type="button"
          className="primary"
          disabled={!rows.length}
          onClick={start}
        >
          {t(locale, "rebaseStart")}
        </button>
      </div>
    </Modal>
  );
}

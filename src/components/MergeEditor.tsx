/**
 * Three-pane merge editor (Yours | Result | Theirs), ported from OpenIDEA MergeEditor
 * using CodeMirror 6 + @codemirror/merge + OpenIDEA mergeModel.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { history, historyKeymap, undoDepth } from "@codemirror/commands";
import { unifiedMergeView } from "@codemirror/merge";
import { Transaction, type EditorState, type Extension, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { api } from "../api";
import { t, tf } from "../i18n";
import { mergeTitles, type MergeSides } from "../merge/conflicts";
import {
  mergeChanged,
  mergeTheme,
  resultControls,
  resultMarks,
  sideControls,
  syncSide,
  type MergeControls,
} from "../merge/mergeGutters";
import {
  applyNonConflicting,
  applyTo,
  mergeField,
  mergeHistory,
  resolveSimple,
  revertResolved,
  startMerge,
  summarize,
  unresolved,
  type MergeAction,
  type MergeSide,
  type MergeSummary,
} from "../merge/mergeModel";
import { conflictPaths } from "../conflict";
import { useApp } from "../store";
import { askConfirm } from "../uiDialogs";

const EMPTY_SUMMARY: MergeSummary = {
  pending: 0,
  conflicts: 0,
  left: false,
  all: false,
  right: false,
  simple: false,
  revert: false,
};

const AUTO_APPLY_KEY = "git-gui.merge.autoApplyNonConflicting";
const readAutoApply = () => {
  try {
    return localStorage.getItem(AUTO_APPLY_KEY) === "true";
  } catch {
    return false;
  }
};

const viewerBase = (opts: { readOnly: boolean }): Extension[] => [
  lineNumbers(),
  EditorView.editable.of(!opts.readOnly),
  EditorView.lineWrapping,
  mergeTheme,
];

export function MergeEditor(props: { path: string; onClose: () => void }) {
  const locale = useApp((s) => s.locale);
  const root = useApp((s) => s.root)!;
  const status = useApp((s) => s.status);
  const setMergePath = useApp((s) => s.setMergePath);
  const refresh = useApp((s) => s.refresh);
  const run = useApp((s) => s.run);
  const files = conflictPaths(status);
  const fileIndex = Math.max(0, files.indexOf(props.path));
  const hasPrevFile = fileIndex > 0;
  const hasNextFile = fileIndex >= 0 && fileIndex < files.length - 1;

  const [state, setState] = useState<{
    ours: string;
    theirs: string;
    base: string | null;
    sides: MergeSides;
  } | null>(null);
  const [binary, setBinary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<MergeSummary>(EMPTY_SUMMARY);
  const [autoApply, setAutoApply] = useState(readAutoApply);
  const accepting = useRef(false);

  const oursRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const theirsRef = useRef<HTMLDivElement>(null);
  const resultView = useRef<EditorView | null>(null);
  const autoApplyRef = useRef(autoApply);
  useEffect(() => {
    autoApplyRef.current = autoApply;
  }, [autoApply]);

  const load = useCallback(async () => {
    try {
      const v = await api.conflictVersions(root, props.path);
      const binaryContent =
        !!v.binary || [v.base, v.ours, v.theirs].some((text) => text?.includes("\0"));
      setBinary(binaryContent);
      setError(null);
      if (binaryContent) {
        setState(null);
        return;
      }
      setState({
        ours: v.ours ?? "",
        theirs: v.theirs ?? "",
        base: v.base,
        sides: v.sides,
      });
    } catch (e) {
      setBinary(false);
      setError(String(e));
    }
  }, [root, props.path]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!state || !oursRef.current || !resultRef.current || !theirsRef.current) return;
    const start = startMerge(state.ours, state.base ?? "", state.theirs);
    const change = (index: number, action: MergeAction) => {
      const v = resultView.current;
      if (!v) return;
      const spec = applyTo(v.state, [index], action);
      if (spec) v.dispatch(spec);
    };
    const controls: MergeControls = {
      accept: (index, side, resolve) => change(index, { type: "accept", side, resolve }),
      ignore: (index, side, resolve) => change(index, { type: "ignore", side: resolve ? null : side }),
      resolveAutomatically: (index) => change(index, { type: "auto", side: "base" }),
    };
    const sideExt = (which: MergeSide): Extension[] => [
      ...viewerBase({ readOnly: true }),
      state.base !== null
        ? unifiedMergeView({
            original: state.base,
            mergeControls: false,
            gutter: true,
            diffConfig: { scanLimit: 2000 },
          })
        : [],
      sideControls(which, controls),
    ];
    const ours = new EditorView({
      doc: state.ours,
      parent: oursRef.current,
      extensions: sideExt("left"),
    });
    const theirs = new EditorView({
      doc: state.theirs,
      parent: theirsRef.current,
      extensions: sideExt("right"),
    });
    const result = new EditorView({
      doc: start.text,
      parent: resultRef.current,
      extensions: [
        ...viewerBase({ readOnly: false }),
        history(),
        keymap.of(historyKeymap),
        mergeField.init(() => start.changes),
        mergeHistory,
        resultMarks,
        resultControls(controls),
        EditorView.updateListener.of((u) => {
          if (!mergeChanged(u)) return;
          const changes = u.state.field(mergeField);
          ours.dispatch({ effects: syncSide.of(changes) });
          theirs.dispatch({ effects: syncSide.of(changes) });
          setSummary(summarize(u.state));
        }),
      ],
    });
    resultView.current = result;
    ours.dispatch({ effects: syncSide.of(start.changes) });
    theirs.dispatch({ effects: syncSide.of(start.changes) });
    setSummary(summarize(result.state));
    if (autoApplyRef.current) {
      const spec = applyNonConflicting(result.state, "base");
      if (spec) result.dispatch({ ...spec, annotations: Transaction.addToHistory.of(false) });
    }
    return () => {
      ours.destroy();
      theirs.destroy();
      result.destroy();
      resultView.current = null;
    };
  }, [state]);

  const titles = mergeTitles(state?.sides);
  const fileName = props.path.replace(/\\/g, "/").split("/").pop() ?? props.path;

  const moveTo = (view: EditorView, at: number) => {
    view.dispatch({
      selection: { anchor: at },
      effects: EditorView.scrollIntoView(at, { y: "center" }),
    });
    view.focus();
  };

  const goto = (dir: 1 | -1) => {
    const v = resultView.current;
    if (!v) return;
    const open = unresolved(v.state);
    if (!open.length) return;
    const head = v.state.selection.main.head;
    const target =
      dir === 1
        ? (open.find((c) => c.from > head) ?? open[0]!)
        : ([...open].reverse().find((c) => c.from < head) ?? open[open.length - 1]!);
    moveTo(v, target.from);
  };

  const command = (make: (s: EditorState) => TransactionSpec | null, reveal = false) => {
    const v = resultView.current;
    const spec = v && make(v.state);
    if (!v || !spec) return;
    v.dispatch(spec);
    const first = reveal ? unresolved(v.state)[0] : undefined;
    if (first) moveTo(v, first.from);
  };

  const afterResolved = async () => {
    await refresh();
    const next = conflictPaths(useApp.getState().status).filter((p) => p !== props.path);
    if (next.length) {
      setMergePath(next[0]!);
    } else {
      props.onClose();
    }
  };

  const writeResolved = async (text: string) => {
    await run(async () => {
      await api.writeAndStage(root, props.path, text);
      await afterResolved();
    });
  };

  const apply = async () => {
    const v = resultView.current;
    if (!v) return;
    const remaining = unresolved(v.state).length;
    if (remaining > 0) {
      const ok = await askConfirm({
        title: t(locale, "unresolvedChanges"),
        message: tf(locale, "unresolvedKeepBase", { count: remaining }),
        confirmLabel: t(locale, "markResolved"),
      });
      if (!ok) return;
    }
    const sep = (state?.base ?? state?.ours ?? state?.theirs ?? "").includes("\r\n") ? "\r\n" : "\n";
    await writeResolved(v.state.doc.sliceString(0, undefined, sep));
  };

  const modified = () => {
    const v = resultView.current;
    return !!v && undoDepth(v.state) > 0;
  };

  const acceptSide = async (side: MergeSide) => {
    if ((!state && !binary) || accepting.current) return;
    accepting.current = true;
    try {
      if (modified()) {
        const ok = await askConfirm({
          title: side === "left" ? t(locale, "acceptYours") : t(locale, "acceptTheirs"),
          message: t(locale, "discardMergeEdits"),
          danger: true,
          confirmLabel: t(locale, "discard"),
        });
        if (!ok) return;
      }
      await run(async () => {
        // When sides.reversed, git's --ours/--theirs flip relative to UI labels.
        const gitSide =
          state?.sides.reversed
            ? side === "left"
              ? "theirs"
              : "ours"
            : side === "left"
              ? "ours"
              : "theirs";
        await api.conflictResolve(root, [props.path], gitSide);
        await afterResolved();
      });
    } finally {
      accepting.current = false;
    }
  };

  const goFile = (dir: -1 | 1) => {
    const i = files.indexOf(props.path);
    const target = files[i + dir];
    if (target) setMergePath(target);
  };

  const cancel = async () => {
    if (modified()) {
      const ok = await askConfirm({
        title: t(locale, "cancelMerge"),
        message: t(locale, "exitWithoutApplying"),
        danger: true,
        confirmLabel: t(locale, "exit"),
      });
      if (!ok) return;
    }
    props.onClose();
  };

  const statusText = () => {
    if (!summary.pending) return t(locale, "allChangesProcessed");
    const left =
      summary.pending === 1
        ? tf(locale, "changesLeftOne", { n: summary.pending })
        : tf(locale, "changesLeftMany", { n: summary.pending });
    if (!summary.conflicts) return left;
    const conf =
      summary.conflicts === 1
        ? tf(locale, "conflictsOne", { n: summary.conflicts })
        : tf(locale, "conflictsMany", { n: summary.conflicts });
    return `${left}, ${conf}`;
  };

  return (
    <div className="merge-overlay" role="dialog" aria-modal="true" aria-label={t(locale, "mergeEditor")}>
      <div className="merge-editor">
        <div className="merge-toolbar">
          <strong className="merge-file" title={props.path}>
            {fileName}
            {files.length > 1 ? ` (${fileIndex + 1}/${files.length})` : ""}
          </strong>
          <button
            type="button"
            className="ghost"
            title={t(locale, "prevConflictFile")}
            disabled={!hasPrevFile}
            onClick={() => goFile(-1)}
          >
            ‹ {t(locale, "prevFile")}
          </button>
          <button
            type="button"
            className="ghost"
            title={t(locale, "nextConflictFile")}
            disabled={!hasNextFile}
            onClick={() => goFile(1)}
          >
            {t(locale, "nextFile")} ›
          </button>
          <span className="sep" />
          <button
            type="button"
            className="icon-btn"
            title={t(locale, "prevChange")}
            disabled={!summary.pending}
            onClick={() => goto(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-btn"
            title={t(locale, "nextChange")}
            disabled={!summary.pending}
            onClick={() => goto(1)}
          >
            ↓
          </button>
          <span className="sep" />
          <button
            type="button"
            className="ghost"
            disabled={!summary.left}
            title={t(locale, "applyLeft")}
            onClick={() => command((s) => applyNonConflicting(s, "left"), true)}
          >
            ←
          </button>
          <button
            type="button"
            className="ghost"
            disabled={!summary.all}
            title={t(locale, "applyAllNonConflict")}
            onClick={() => command((s) => applyNonConflicting(s, "base"), true)}
          >
            ⇄
          </button>
          <button
            type="button"
            className="ghost"
            disabled={!summary.right}
            title={t(locale, "applyRight")}
            onClick={() => command((s) => applyNonConflicting(s, "right"), true)}
          >
            →
          </button>
          <button
            type="button"
            className="ghost"
            disabled={!summary.simple}
            title={t(locale, "resolveSimple")}
            onClick={() => command((s) => resolveSimple(s), true)}
          >
            ✦
          </button>
          <button
            type="button"
            className="ghost"
            disabled={!summary.revert}
            title={t(locale, "revertResolutions")}
            onClick={() => command((s) => revertResolved(s))}
          >
            ↺
          </button>
          <label className="merge-auto">
            <input
              type="checkbox"
              checked={autoApply}
              onChange={(e) => {
                const on = e.target.checked;
                setAutoApply(on);
                try {
                  localStorage.setItem(AUTO_APPLY_KEY, String(on));
                } catch {
                  /* ignore */
                }
              }}
            />
            {t(locale, "autoApplyNonConflict")}
          </label>
          <span className={`merge-status ${!summary.pending ? "done" : ""}`}>{statusText()}</span>
        </div>

        {error && <div className="error-bar">{error}</div>}

        <div className="merge-body">
          {files.length > 1 && (
            <aside className="merge-file-list" aria-label={t(locale, "conflictFiles")}>
              {files.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`merge-file-item ${p === props.path ? "active" : ""}`}
                  title={p}
                  onClick={() => setMergePath(p)}
                >
                  {p.replace(/\\/g, "/").split("/").pop() ?? p}
                </button>
              ))}
            </aside>
          )}
          <div className="merge-main">
            {binary ? (
              <div className="merge-binary">
                <p className="modal-text">{t(locale, "binaryConflict")}</p>
                <div className="merge-footer">
                  <button type="button" className="secondary" onClick={() => void acceptSide("left")}>
                    {t(locale, "acceptYours")}
                  </button>
                  <button type="button" className="secondary" onClick={() => void acceptSide("right")}>
                    {t(locale, "acceptTheirs")}
                  </button>
                  <button type="button" className="ghost" onClick={() => void cancel()}>
                    {t(locale, "cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="merge-panes">
                  <div className="merge-col">
                    <div className="merge-pane-title" title={titles.yours}>
                      {titles.yours}
                    </div>
                    <div className="merge-cm" ref={oursRef} />
                  </div>
                  <div className="merge-col result">
                    <div className="merge-pane-title result">{t(locale, "mergeResult")}</div>
                    <div className="merge-cm" ref={resultRef} />
                  </div>
                  <div className="merge-col">
                    <div className="merge-pane-title" title={titles.theirs}>
                      {titles.theirs}
                    </div>
                    <div className="merge-cm" ref={theirsRef} />
                  </div>
                </div>
                <div className="merge-footer">
                  <button type="button" className="secondary" onClick={() => void acceptSide("left")}>
                    {t(locale, "acceptYours")}
                  </button>
                  <button type="button" className="primary" onClick={() => void apply()}>
                    {t(locale, "applyResult")}
                  </button>
                  <button type="button" className="secondary" onClick={() => void acceptSide("right")}>
                    {t(locale, "acceptTheirs")}
                  </button>
                  <div className="title-spacer" />
                  <button type="button" className="ghost" onClick={() => void cancel()}>
                    {t(locale, "cancel")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

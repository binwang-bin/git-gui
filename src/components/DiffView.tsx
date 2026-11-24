import { useState } from "react";
import { api } from "../api";
import { buildHunkPatch, buildLinePatch, hunkToSideRows } from "../diffPatch";
import { t } from "../i18n";
import { useApp } from "../store";

const DIFF_MODE_KEY = "git-gui.diffMode";

type DiffMode = "unified" | "side-by-side";

function loadMode(): DiffMode {
  const v = localStorage.getItem(DIFF_MODE_KEY);
  return v === "unified" ? "unified" : "side-by-side";
}

export function DiffView() {
  const locale = useApp((s) => s.locale);
  const root = useApp((s) => s.root);
  const diff = useApp((s) => s.diff);
  const blame = useApp((s) => s.blame);
  const selectedPaths = useApp((s) => s.selectedPaths);
  const diffStaged = useApp((s) => s.diffStaged);
  const status = useApp((s) => s.status);
  const run = useApp((s) => s.run);
  const selectFile = useApp((s) => s.selectFile);
  const clearDiff = useApp((s) => s.clearDiff);
  const refresh = useApp((s) => s.refresh);
  const [mode, setMode] = useState<DiffMode>(loadMode);

  const path = selectedPaths[0] ?? diff?.path ?? "";
  const fileStatus = status.find((f) => f.relPath === path);
  const isConflict =
    fileStatus?.unstaged === "conflicted" || fileStatus?.staged === "conflicted";
  const canLineOps = !!root && !!diff && !diffStaged && !blame && !isConflict;

  const setDiffMode = (m: DiffMode) => {
    setMode(m);
    localStorage.setItem(DIFF_MODE_KEY, m);
  };

  const afterPatch = async () => {
    if (root && path) await selectFile(path, diffStaged);
    await refresh();
  };

  if (blame) {
    return (
      <div className="diff-host" style={{ height: "100%" }}>
        <div className="diff-header">
          <span className="diff-tab">
            <strong title={path}>{path || t(locale, "blame")}</strong>
            <button
              type="button"
              className="diff-tab-close"
              title={t(locale, "closeDiff")}
              onClick={clearDiff}
            >
              ×
            </button>
          </span>
          <div className="title-spacer" />
          {root && path && (
            <button className="ghost" onClick={() => void selectFile(path, false)}>
              Diff
            </button>
          )}
        </div>
        <div className="blame-view">
          {blame.map((b, i) => (
            <div className="blame-row" key={i}>
              <span title={b.summary}>{b.commit.slice(0, 7)}</span>
              <span>{b.author}</span>
              <span>{b.line}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!diff) {
    return <div className="empty-hint">{t(locale, "emptyDiff")}</div>;
  }

  let oldLine = 0;
  let newLine = 0;

  return (
    <div className="diff-host" style={{ height: "100%" }}>
      <div className="diff-header">
        <span className="diff-tab">
          <strong title={diff.path}>{diff.path}</strong>
          <button
            type="button"
            className="diff-tab-close"
            title={t(locale, "closeDiff")}
            onClick={clearDiff}
          >
            ×
          </button>
        </span>
        {diff.binary && <span className="pill">binary</span>}
        <div className="title-spacer" />
        <button
          className={`ghost ${mode === "side-by-side" ? "pressed" : ""}`}
          onClick={() => setDiffMode("side-by-side")}
        >
          {t(locale, "sideBySide")}
        </button>
        <button
          className={`ghost ${mode === "unified" ? "pressed" : ""}`}
          onClick={() => setDiffMode("unified")}
        >
          {t(locale, "unified")}
        </button>
        {root && selectedPaths[0] && !diffStaged && (
          <>
            <button
              className="ghost"
              onClick={() =>
                void run(async () => {
                  const lines = await api.blame(root, selectedPaths[0]);
                  useApp.setState({ blame: lines, diff: null });
                })
              }
            >
              {t(locale, "blame")}
            </button>
          </>
        )}
      </div>

      {isConflict && root && (
        <div className="conflict-banner">
          <span>{t(locale, "conflictBanner")}</span>
          <button
            className="primary"
            onClick={() => useApp.getState().setMergePath(path)}
          >
            {t(locale, "resolveInMergeEditor")}
          </button>
          <button
            className="secondary"
            onClick={() =>
              void run(async () => {
                await api.conflictResolve(root, [path], "ours");
                await afterPatch();
              })
            }
          >
            {t(locale, "acceptOurs")}
          </button>
          <button
            className="secondary"
            onClick={() =>
              void run(async () => {
                await api.conflictResolve(root, [path], "theirs");
                await afterPatch();
              })
            }
          >
            {t(locale, "acceptTheirs")}
          </button>
        </div>
      )}

      <div className="diff-body">
        {diff.hunks.length === 0 && !diff.binary && (
          <pre style={{ padding: 12, margin: 0 }}>{diff.raw || "(empty)"}</pre>
        )}

        {mode === "side-by-side"
          ? diff.hunks.map((h, hi) => {
              const rows = hunkToSideRows(h.lines, h.oldStart, h.newStart);
              return (
                <div key={hi}>
                  <div className="hunk-header">
                    <code>{h.header}</code>
                    {canLineOps && (
                      <button
                        className="ghost"
                        onClick={() =>
                          void run(async () => {
                            const patch = buildHunkPatch(diff.path, h.header, h.lines);
                            await api.applyPatch(root!, patch, true, false);
                            await afterPatch();
                          })
                        }
                      >
                        {t(locale, "stageHunk")}
                      </button>
                    )}
                    {root && diffStaged && (
                      <button
                        className="ghost"
                        onClick={() =>
                          void run(async () => {
                            const patch = buildHunkPatch(diff.path, h.header, h.lines);
                            await api.applyPatch(root, patch, true, true);
                            await afterPatch();
                          })
                        }
                      >
                        {t(locale, "unstageHunk")}
                      </button>
                    )}
                  </div>
                  <div className="side-diff">
                    {rows.map((r, ri) => (
                      <div className="side-row" key={ri}>
                        <div className={`side-cell left ${r.leftKind}`}>
                          <span className="ln">{r.oldLn ?? ""}</span>
                          <span className="side-text">{r.left}</span>
                        </div>
                        <div className={`side-cell right ${r.rightKind}`}>
                          <span className="ln">{r.newLn ?? ""}</span>
                          <span className="side-text">{r.right}</span>
                          {canLineOps && r.changeKind && r.lineIndex != null && (
                            <span className="line-ops">
                              <button
                                type="button"
                                className="ghost"
                                title={t(locale, "stageLine")}
                                onClick={() =>
                                  void run(async () => {
                                    const patch = buildLinePatch(
                                      diff.path,
                                      h.header,
                                      h.lines,
                                      r.lineIndex!,
                                    );
                                    if (!patch) return;
                                    await api.applyPatch(root!, patch, true, false);
                                    await afterPatch();
                                  })
                                }
                              >
                                +
                              </button>
                              <button
                                type="button"
                                className="ghost"
                                title={t(locale, "discardLine")}
                                onClick={() =>
                                  void run(async () => {
                                    const patch = buildLinePatch(
                                      diff.path,
                                      h.header,
                                      h.lines,
                                      r.lineIndex!,
                                    );
                                    if (!patch) return;
                                    await api.applyPatch(root!, patch, false, true);
                                    await afterPatch();
                                  })
                                }
                              >
                                ⌫
                              </button>
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          : diff.hunks.map((h, hi) => {
              oldLine = h.oldStart - 1;
              newLine = h.newStart - 1;
              return (
                <div key={hi}>
                  <div className="hunk-header">
                    <code>{h.header}</code>
                    {canLineOps && (
                      <button
                        className="ghost"
                        onClick={() =>
                          void run(async () => {
                            const patch = buildHunkPatch(diff.path, h.header, h.lines);
                            await api.applyPatch(root!, patch, true, false);
                            await afterPatch();
                          })
                        }
                      >
                        {t(locale, "stageHunk")}
                      </button>
                    )}
                  </div>
                  {h.lines.map((l, li) => {
                    if (l.kind === "add") newLine += 1;
                    else if (l.kind === "del") oldLine += 1;
                    else {
                      oldLine += 1;
                      newLine += 1;
                    }
                    return (
                      <div className={`diff-line ${l.kind}`} key={li}>
                        <span className="ln">{l.kind === "add" ? "" : oldLine}</span>
                        <span className="ln">{l.kind === "del" ? "" : newLine}</span>
                        <span className="mark">
                          {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
                        </span>
                        <span className="grow">{l.text}</span>
                        {canLineOps && (l.kind === "add" || l.kind === "del") && (
                          <span className="line-ops">
                            <button
                              type="button"
                              className="ghost"
                              title={t(locale, "stageLine")}
                              onClick={() =>
                                void run(async () => {
                                  const patch = buildLinePatch(
                                    diff.path,
                                    h.header,
                                    h.lines,
                                    li,
                                  );
                                  if (!patch) return;
                                  await api.applyPatch(root!, patch, true, false);
                                  await afterPatch();
                                })
                              }
                            >
                              +
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              title={t(locale, "discardLine")}
                              onClick={() =>
                                void run(async () => {
                                  const patch = buildLinePatch(
                                    diff.path,
                                    h.header,
                                    h.lines,
                                    li,
                                  );
                                  if (!patch) return;
                                  await api.applyPatch(root!, patch, false, true);
                                  await afterPatch();
                                })
                              }
                            >
                              ⌫
                            </button>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
      </div>
    </div>
  );
}

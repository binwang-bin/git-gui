import { api } from "../api";
import { t } from "../i18n";
import { useApp } from "../store";

function buildHunkPatch(
  path: string,
  header: string,
  lines: { kind: string; text: string }[],
): string {
  const body = lines
    .map((l) => {
      if (l.kind === "add") return `+${l.text}`;
      if (l.kind === "del") return `-${l.text}`;
      return ` ${l.text}`;
    })
    .join("\n");
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${header}\n${body}\n`;
}

export function DiffView() {
  const locale = useApp((s) => s.locale);
  const root = useApp((s) => s.root);
  const diff = useApp((s) => s.diff);
  const blame = useApp((s) => s.blame);
  const selectedPaths = useApp((s) => s.selectedPaths);
  const diffStaged = useApp((s) => s.diffStaged);
  const run = useApp((s) => s.run);
  const selectFile = useApp((s) => s.selectFile);
  const clearDiff = useApp((s) => s.clearDiff);

  if (blame) {
    const path = selectedPaths[0] ?? "";
    return (
      <div className="diff-host" style={{ height: "100%" }}>
        <div className="diff-header">
          <span className="diff-tab">
            <strong title={path}>{path || t(locale, "blame")}</strong>
            <button
              type="button"
              className="diff-tab-close"
              title={t(locale, "closeDiff")}
              aria-label={t(locale, "closeDiff")}
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
            aria-label={t(locale, "closeDiff")}
            onClick={clearDiff}
          >
            ×
          </button>
        </span>
        {diff.binary && <span className="pill">binary</span>}
        <div className="title-spacer" />
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
            <button className="ghost" onClick={() => void selectFile(selectedPaths[0], false)}>
              Diff
            </button>
          </>
        )}
      </div>
      <div className="diff-body">
        {diff.hunks.length === 0 && !diff.binary && (
          <pre style={{ padding: 12, margin: 0 }}>{diff.raw || "(empty)"}</pre>
        )}
        {diff.hunks.map((h, hi) => {
          oldLine = h.oldStart - 1;
          newLine = h.newStart - 1;
          return (
            <div key={hi}>
              <div className="hunk-header">
                <code>{h.header}</code>
                {root && !diffStaged && (
                  <button
                    className="ghost"
                    onClick={() =>
                      void run(async () => {
                        const patch = buildHunkPatch(diff.path, h.header, h.lines);
                        await api.stageHunk(root, diff.path, patch);
                        await selectFile(diff.path, false);
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
                    <span>{l.text}</span>
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

import { t } from "../i18n";
import { useApp } from "../store";

export function CommitDetailPanel() {
  const locale = useApp((s) => s.locale);
  const commit = useApp((s) => s.selectedCommit);
  const files = useApp((s) => s.commitFiles);
  const diff = useApp((s) => s.diff);
  const selectCommitFile = useApp((s) => s.selectCommitFile);
  const clearDiff = useApp((s) => s.clearDiff);

  if (!commit) return null;

  return (
    <div className="commit-detail">
      <div className="commit-detail-head">
        <strong>{t(locale, "commitDetails")}</strong>
        <div className="title-spacer" />
        <button
          type="button"
          className="icon-btn"
          title={t(locale, "closeDetails")}
          onClick={() => {
            useApp.setState({ selectedCommit: null, commitFiles: [] });
            clearDiff();
          }}
        >
          ×
        </button>
      </div>
      <div className="commit-detail-meta">
        <div>
          <code>{commit.shortId}</code> · {commit.author}
        </div>
        <div>{commit.time > 0 ? new Date(commit.time * 1000).toLocaleString() : "—"}</div>
        <div style={{ marginTop: 6, color: "var(--fg-strong)" }}>{commit.summary}</div>
        {commit.body ? <div style={{ marginTop: 4 }}>{commit.body}</div> : null}
      </div>
      <div className="section-label" style={{ padding: "6px 10px" }}>
        {t(locale, "changedFiles")} ({files.length})
      </div>
      <div className="commit-detail-files">
        {files.map((f) => (
          <div
            key={f.path}
            className={`commit-file-row ${diff?.path === f.path ? "selected" : ""}`}
            onClick={() => void selectCommitFile(f.path)}
          >
            <span className={`status ${f.status}`}>{String(f.status)[0]?.toUpperCase()}</span>
            <span title={f.path}>{f.path}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

import { t } from "../i18n";
import { useApp } from "../store";
import { ChangesView } from "./ChangesView";
import { DiffView } from "./DiffView";
import { ShelfView } from "./ShelfView";
import { StashView } from "./StashView";

/** IDEA-style Commit tool window: Commit | Stash | Shelf tabs + diff host. */
export function CommitToolWindow() {
  const locale = useApp((s) => s.locale);
  const commitTab = useApp((s) => s.commitTab);
  const setCommitTab = useApp((s) => s.setCommitTab);
  const stashCount = useApp((s) => s.stashes.length);
  const shelfCount = useApp((s) => s.shelves.length);

  return (
    <>
      <div className="panel">
        <div className="panel-tabs">
          <button
            className={commitTab === "changes" ? "active" : ""}
            onClick={() => setCommitTab("changes")}
          >
            {t(locale, "commitTool")}
          </button>
          <button
            className={commitTab === "stash" ? "active" : ""}
            onClick={() => setCommitTab("stash")}
          >
            {t(locale, "stash")}
            {stashCount > 0 ? ` (${stashCount})` : ""}
          </button>
          <button
            className={commitTab === "shelf" ? "active" : ""}
            onClick={() => setCommitTab("shelf")}
          >
            {t(locale, "shelve")}
            {shelfCount > 0 ? ` (${shelfCount})` : ""}
          </button>
        </div>
        {commitTab === "changes" ? (
          <ChangesView embedded />
        ) : commitTab === "shelf" ? (
          <ShelfView />
        ) : (
          <StashView />
        )}
      </div>
      <div className="diff-host">
        <DiffView />
      </div>
    </>
  );
}

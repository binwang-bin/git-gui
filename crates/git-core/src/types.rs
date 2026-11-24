use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub path: String,
    pub rel_path: String,
    pub staged: Option<ChangeKind>,
    pub unstaged: Option<ChangeKind>,
    pub renamed_from: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub head: Option<String>,
    pub head_commit: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub operation: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub is_remote: bool,
    pub is_head: bool,
    pub upstream: Option<String>,
    pub commit: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub id: String,
    pub short_id: String,
    pub summary: String,
    pub body: String,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
    /// OpenIDEA: nearest visible ancestors for the graph (skips hidden commits under filters).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub graph_parents: Option<Vec<String>>,
    /// Per graph parent: true when the link skipped hidden commits (dashed edge).
    #[serde(default)]
    pub graph_dashed: Vec<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub status: ChangeKind,
    pub old_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    pub index: u32,
    pub message: String,
    pub commit: String,
    pub time: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: String,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub hunks: Vec<DiffHunk>,
    pub binary: bool,
    pub raw: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub commit: String,
    pub author: String,
    pub time: i64,
    pub summary: String,
    pub line: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub name: String,
    pub fetch_url: String,
    pub push_url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitVersion {
    pub path: String,
    pub version: String,
}

/// OpenIDEA-shaped log query. Detail filters (authors / date / grep / path) use the same
/// predicates for listing and for `graph_parents` projection.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogQuery {
    #[serde(default)]
    pub limit: u32,
    /// Cursor into the underlying `git log` stream (not the filtered visible count).
    #[serde(default)]
    pub skip: u32,
    /// Legacy single author; merged into `authors` when set.
    #[serde(default)]
    pub author: Option<String>,
    /// OpenIDEA `authors` — any entry matches (`authors_exact`).
    #[serde(default)]
    pub authors: Vec<String>,
    /// OpenIDEA always sends `true` from the Log User filter.
    #[serde(default = "default_true")]
    pub authors_exact: bool,
    #[serde(default)]
    pub grep: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    /// Legacy unix seconds; preferred: `since_ms`.
    #[serde(default)]
    pub since: Option<i64>,
    /// OpenIDEA `sinceMs` — committer time, inclusive (epoch ms).
    #[serde(default)]
    pub since_ms: Option<i64>,
    /// OpenIDEA `untilMs` — committer time, exclusive (epoch ms).
    #[serde(default)]
    pub until_ms: Option<i64>,
}

fn default_true() -> bool {
    true
}

/// One page of log results with an opaque git-stream cursor (OpenIDEA-style paging).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    pub commits: Vec<Commit>,
    /// Pass as the next query's `skip`.
    pub next_skip: u32,
    pub has_more: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResetMode {
    Soft,
    Mixed,
    Hard,
}

/// OpenIDEA `MergeSides` — labels for the merge editor panes.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeSides {
    pub operation: Option<String>,
    /// During rebase, git stage 2 is upstream and stage 3 is the user's commit.
    #[serde(default)]
    pub reversed: bool,
    pub branch: Option<String>,
    pub commit: Option<String>,
    pub other_branch: Option<String>,
}

/// OpenIDEA `MergeVersions` — base / yours / theirs for the merge editor.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeVersions {
    #[serde(default)]
    pub binary: bool,
    pub base: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    pub sides: MergeSides,
}

/// A shelved patch stored under `.git/idevcs/shelf/`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShelfEntry {
    pub id: String,
    pub name: String,
    pub time: i64,
    pub paths: Vec<String>,
}

/// What an interactive rebase does with one commit.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RebaseAction {
    Pick,
    Reword,
    Edit,
    Squash,
    Fixup,
    Drop,
}

/// One line of an interactive rebase plan.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseEntry {
    pub commit: String,
    pub action: RebaseAction,
    #[serde(default)]
    pub message: Option<String>,
}

use serde::{Deserialize, Serialize};

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
pub struct FileStatus {
    pub path: String,
    pub rel_path: String,
    pub staged: Option<ChangeKind>,
    pub unstaged: Option<ChangeKind>,
    pub renamed_from: Option<String>,
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
    /// Commits ahead of upstream (local only; 0 for remotes / no upstream).
    #[serde(default)]
    pub ahead: u32,
    /// Commits behind upstream (local only; 0 for remotes / no upstream).
    #[serde(default)]
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
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
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
pub struct DiffLine {
    pub kind: String,
    pub text: String,
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
pub struct GitVersion {
    pub path: String,
    pub version: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogQuery {
    pub limit: u32,
    pub skip: u32,
    pub author: Option<String>,
    pub grep: Option<String>,
    pub path: Option<String>,
    pub branch: Option<String>,
    /// Unix seconds; maps to `git log --since=<epoch>`.
    #[serde(default)]
    pub since: Option<i64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResetMode {
    Soft,
    Mixed,
    Hard,
}

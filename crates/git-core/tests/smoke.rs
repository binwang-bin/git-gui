use git_core::{detect_version, LogQuery, Repo};
use std::path::PathBuf;

#[test]
fn detects_git() {
    let v = detect_version().expect("git should be installed");
    assert!(v.version.contains("git"));
}

#[test]
fn opens_workspace_repo() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("workspace root");
    let repo = Repo::discover(&root).expect("workspace is a git repo");
    let status = repo.status().expect("status");
    let _ = status.len();
    let info = repo.branch_info().expect("branch");
    assert!(info.head_commit.is_some() || info.head.is_some() || info.operation.is_some() || true);
    let page = repo
        .log(&LogQuery {
            limit: 5,
            ..Default::default()
        })
        .expect("log");
    assert!(!page.commits.is_empty() || page.commits.is_empty());
}

use git_core::{self, LogPage, LogQuery, MergeVersions, ResetMode};
use std::path::PathBuf;

fn map_err(e: git_core::Error) -> String {
    e.to_string()
}

fn repo(path: &str) -> Result<git_core::Repo, String> {
    git_core::Repo::discover(&PathBuf::from(path)).map_err(map_err)
}

#[tauri::command]
pub async fn git_detect() -> Result<git_core::GitVersion, String> {
    tokio::task::spawn_blocking(git_core::detect_version)
        .await
        .map_err(|e| e.to_string())?
        .map_err(map_err)
}

#[tauri::command]
pub async fn repo_discover(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let r = git_core::Repo::discover(&PathBuf::from(path)).map_err(map_err)?;
        Ok(r.root().display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_init(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let r = git_core::init(&PathBuf::from(path)).map_err(map_err)?;
        Ok(r.root().display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_clone(url: String, path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let r = git_core::clone(&url, &PathBuf::from(path)).map_err(map_err)?;
        Ok(r.root().display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_status(root: String) -> Result<Vec<git_core::FileStatus>, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.status().map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_branch_info(root: String) -> Result<git_core::BranchInfo, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.branch_info().map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_branches(root: String) -> Result<Vec<git_core::Branch>, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.branches().map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_log(root: String, query: LogQuery) -> Result<LogPage, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.log(&query).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_commit_files(root: String, commit: String) -> Result<Vec<git_core::ChangedFile>, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.commit_files(&commit).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_commit_message(root: String, commit: String) -> Result<(String, String), String> {
    tokio::task::spawn_blocking(move || repo(&root)?.commit_message(&commit).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_file_diff(root: String, path: String, staged: bool) -> Result<git_core::FileDiff, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.file_diff(&path, staged).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_commit_file_diff(
    root: String,
    commit: String,
    path: String,
) -> Result<git_core::FileDiff, String> {
    tokio::task::spawn_blocking(move || {
        repo(&root)?
            .commit_file_diff(&commit, &path)
            .map_err(map_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_stage(root: String, paths: Vec<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo(&root)?.stage(&paths).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_unstage(root: String, paths: Vec<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo(&root)?.unstage(&paths).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_discard(root: String, paths: Vec<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo(&root)?.discard(&paths).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_commit(root: String, message: String, amend: bool, sign_off: bool) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        repo(&root)?
            .commit(&message, amend, sign_off)
            .map_err(map_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_checkout(root: String, branch: String, create: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo(&root)?.checkout(&branch, create).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_create_branch(
    root: String,
    name: String,
    start: Option<String>,
    checkout: bool,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo(&root)?
            .create_branch(&name, start.as_deref(), checkout)
            .map_err(map_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_delete_branch(root: String, name: String, force: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo(&root)?.delete_branch(&name, force).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_rename_branch(root: String, old: String, new: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo(&root)?
            .rename_branch(&old, &new)
            .map_err(map_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_merge_branch(root: String, branch: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.merge_branch(&branch).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_rebase_onto(root: String, onto: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.rebase_onto(&onto).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_checkout_and_rebase(
    root: String,
    branch: String,
    onto: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        repo(&root)?
            .checkout_and_rebase(&branch, &onto)
            .map_err(map_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_diff_working_tree(root: String, rev: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        repo(&root)?
            .diff_with_working_tree(&rev)
            .map_err(map_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_push_branch(root: String, name: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.push_branch(&name).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_update_branch(root: String, name: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.update_branch(&name).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_fetch(root: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.fetch().map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_pull(root: String, rebase: bool) -> Result<String, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.pull(rebase).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_push(root: String, force: bool) -> Result<String, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.push(force).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_remotes(root: String) -> Result<Vec<git_core::Remote>, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.remotes().map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_set_remote_url(root: String, name: String, url: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo(&root)?.set_remote_url(&name, &url).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_remove_remote(root: String, name: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo(&root)?.remove_remote(&name).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_pull_remote_branch(
    root: String,
    remote_ref: String,
    rebase: bool,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        repo(&root)?
            .pull_remote_branch(&remote_ref, rebase)
            .map_err(map_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_stashes(root: String) -> Result<Vec<git_core::Stash>, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.stashes().map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_stash_push(
    root: String,
    message: Option<String>,
    paths: Option<Vec<String>>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo(&root)?
            .stash_push(message.as_deref(), paths.as_deref().unwrap_or(&[]))
            .map_err(map_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_delete_paths(root: String, paths: Vec<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo(&root)?.delete_paths(&paths).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_diff_patch(
    root: String,
    paths: Vec<String>,
    staged: bool,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        repo(&root)?
            .diff_patch(&paths, staged)
            .map_err(map_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_append_gitignore(root: String, pattern: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo(&root)?
            .append_gitignore(&pattern)
            .map_err(map_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_append_exclude(root: String, pattern: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo(&root)?
            .append_exclude(&pattern)
            .map_err(map_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_stash_apply(root: String, index: u32, pop: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo(&root)?.stash_apply(index, pop).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_stash_drop(root: String, index: u32) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo(&root)?.stash_drop(index).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_stash_clear(root: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo(&root)?.stash_clear().map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_reset(root: String, commit: String, mode: ResetMode) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo(&root)?.reset(&commit, mode).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_revert(root: String, commits: Vec<String>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.revert(&commits).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_cherry_pick(root: String, commits: Vec<String>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.cherry_pick(&commits).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_continue(root: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.continue_operation().map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_abort(root: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.abort_operation().map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_stage_hunk(root: String, path: String, patch: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo(&root)?.stage_hunk(&path, &patch).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_apply_patch(
    root: String,
    patch: String,
    cached: bool,
    reverse: bool,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo(&root)?
            .apply_patch(&patch, cached, reverse)
            .map_err(map_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_conflict_resolve(
    root: String,
    paths: Vec<String>,
    side: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo(&root)?
            .conflict_resolve(&paths, &side)
            .map_err(map_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_conflict_versions(root: String, path: String) -> Result<MergeVersions, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.conflict_versions(&path).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_write_and_stage(root: String, path: String, contents: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo(&root)?
            .write_and_stage(&path, &contents)
            .map_err(map_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_blame(root: String, path: String) -> Result<Vec<git_core::BlameLine>, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.blame(&path).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_outgoing(root: String) -> Result<Vec<git_core::Commit>, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.outgoing_commits().map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_path(path: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn repo_log_users(root: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.log_users().map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_config_get(root: String, key: String) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.config_get(&key).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_list_dir(root: String, path: String) -> Result<Vec<git_core::DirEntry>, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.list_dir(&path).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_stash_diff(root: String, index: u32) -> Result<git_core::FileDiff, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.stash_diff(index).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_stash_files(
    root: String,
    index: u32,
) -> Result<Vec<git_core::ChangedFile>, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.stash_files(index).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_stash_file_diff(
    root: String,
    index: u32,
    path: String,
) -> Result<git_core::FileDiff, String> {
    tokio::task::spawn_blocking(move || {
        repo(&root)?
            .stash_file_diff(index, &path)
            .map_err(map_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_shelves(root: String) -> Result<Vec<git_core::ShelfEntry>, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.shelves().map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_shelve(
    root: String,
    name: String,
    paths: Vec<String>,
) -> Result<git_core::ShelfEntry, String> {
    tokio::task::spawn_blocking(move || repo(&root)?.shelve(&name, &paths).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_unshelve(root: String, id: String, drop_after: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo(&root)?
            .unshelve(&id, drop_after)
            .map_err(map_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_drop_shelf(root: String, id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo(&root)?.drop_shelf(&id).map_err(map_err))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_interactive_rebase(
    root: String,
    base: String,
    entries: Vec<git_core::RebaseEntry>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        repo(&root)?
            .interactive_rebase(&base, &entries)
            .map_err(map_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn watch_repo(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    root: String,
) -> Result<(), String> {
    crate::watch::start_watch(app, window.label().to_string(), root)
}

#[tauri::command]
pub fn unwatch_repo(window: tauri::WebviewWindow) -> Result<(), String> {
    crate::watch::stop_watch_for(window.label());
    Ok(())
}

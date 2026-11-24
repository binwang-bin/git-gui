mod commands;
mod watch;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                crate::watch::stop_watch_for(window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::git_detect,
            commands::repo_discover,
            commands::repo_init,
            commands::repo_clone,
            commands::repo_status,
            commands::repo_branch_info,
            commands::repo_branches,
            commands::repo_log,
            commands::repo_commit_files,
            commands::repo_commit_message,
            commands::repo_file_diff,
            commands::repo_commit_file_diff,
            commands::repo_stage,
            commands::repo_unstage,
            commands::repo_discard,
            commands::repo_commit,
            commands::repo_checkout,
            commands::repo_create_branch,
            commands::repo_delete_branch,
            commands::repo_rename_branch,
            commands::repo_merge_branch,
            commands::repo_rebase_onto,
            commands::repo_checkout_and_rebase,
            commands::repo_diff_working_tree,
            commands::repo_push_branch,
            commands::repo_update_branch,
            commands::repo_fetch,
            commands::repo_pull,
            commands::repo_push,
            commands::repo_remotes,
            commands::repo_set_remote_url,
            commands::repo_remove_remote,
            commands::repo_pull_remote_branch,
            commands::repo_stashes,
            commands::repo_stash_push,
            commands::repo_delete_paths,
            commands::repo_diff_patch,
            commands::repo_append_gitignore,
            commands::repo_append_exclude,
            commands::repo_stash_apply,
            commands::repo_stash_drop,
            commands::repo_stash_clear,
            commands::repo_reset,
            commands::repo_revert,
            commands::repo_cherry_pick,
            commands::repo_continue,
            commands::repo_abort,
            commands::repo_stage_hunk,
            commands::repo_apply_patch,
            commands::repo_conflict_resolve,
            commands::repo_conflict_versions,
            commands::repo_write_and_stage,
            commands::repo_blame,
            commands::repo_outgoing,
            commands::open_path,
            commands::repo_log_users,
            commands::repo_config_get,
            commands::repo_list_dir,
            commands::repo_stash_diff,
            commands::repo_stash_files,
            commands::repo_stash_file_diff,
            commands::repo_shelves,
            commands::repo_shelve,
            commands::repo_unshelve,
            commands::repo_drop_shelf,
            commands::repo_interactive_rebase,
            commands::watch_repo,
            commands::unwatch_repo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

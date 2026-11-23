use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

struct WatchState {
    _watcher: RecommendedWatcher,
}

static STATE: LazyLock<Mutex<HashMap<String, WatchState>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn should_ignore(path: &Path) -> bool {
    let s = path.to_string_lossy().replace('\\', "/");
    if s.contains("/.git/objects/") || s.contains("/.git/objects") {
        return true;
    }
    if s.contains("/.git/logs/") {
        return true;
    }
    if s.ends_with(".lock") || s.ends_with("/index.lock") {
        return true;
    }
    false
}

fn interesting(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) | EventKind::Any
    )
}

/// Start watching `root` for the webview identified by `label`.
/// Replaces any previous watch for the same label without touching other windows.
pub fn start_watch(app: AppHandle, label: String, root: String) -> Result<(), String> {
    stop_watch_for(&label);

    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }

    let last = Arc::new(Mutex::new(Instant::now() - Duration::from_secs(10)));
    let app2 = app.clone();
    let label2 = label.clone();
    let root_payload = root;

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            let Ok(event) = res else { return };
            if !interesting(&event.kind) {
                return;
            }
            if event.paths.iter().all(|p| should_ignore(p)) {
                return;
            }
            let mut slot = last.lock().unwrap();
            let now = Instant::now();
            if now.duration_since(*slot) < Duration::from_millis(500) {
                return;
            }
            *slot = now;
            let _ = app2.emit_to(&label2, "repo-changed", root_payload.clone());
        },
        Config::default().with_poll_interval(Duration::from_secs(2)),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&root_path, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let mut guard = STATE.lock().map_err(|e| e.to_string())?;
    guard.insert(label, WatchState { _watcher: watcher });
    Ok(())
}

pub fn stop_watch_for(label: &str) {
    if let Ok(mut g) = STATE.lock() {
        g.remove(label);
    }
}

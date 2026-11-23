use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

struct WatchState {
    _watcher: RecommendedWatcher,
}

static WATCHING: AtomicBool = AtomicBool::new(false);
static STATE: Mutex<Option<WatchState>> = Mutex::new(None);

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

pub fn start_watch(app: AppHandle, root: String) -> Result<(), String> {
    stop_watch();

    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }

    let last = Arc::new(Mutex::new(Instant::now() - Duration::from_secs(10)));
    let app2 = app.clone();

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
            let _ = app2.emit("repo-changed", ());
        },
        Config::default().with_poll_interval(Duration::from_secs(2)),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&root_path, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    // Also watch .git for HEAD/index/refs without objects noise (recursive already covers;
    // ignore filter drops objects).
    let mut guard = STATE.lock().map_err(|e| e.to_string())?;
    *guard = Some(WatchState { _watcher: watcher });
    WATCHING.store(true, Ordering::SeqCst);
    Ok(())
}

pub fn stop_watch() {
    WATCHING.store(false, Ordering::SeqCst);
    if let Ok(mut g) = STATE.lock() {
        *g = None;
    }
}

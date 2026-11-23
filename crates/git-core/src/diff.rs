use crate::cli;
use crate::error::Result;
use crate::types::{DiffHunk, DiffLine, FileDiff};
use crate::Repo;

pub fn file_diff(repo: &Repo, path: &str, staged: bool) -> Result<FileDiff> {
    let mut args = vec!["diff", "--no-color", "--find-renames"];
    if staged {
        args.push("--cached");
    }
    args.push("--");
    args.push(path);
    let out = cli::run(repo.root(), &args)?;
    if !out.stdout.trim().is_empty() || staged {
        return Ok(parse_diff(&out.stdout, path));
    }
    // Untracked: show as new file (IDEA Show Diff on Unversioned).
    let empty = if cfg!(windows) { "NUL" } else { "/dev/null" };
    let raw = cli::run_allow(
        repo.root(),
        &["diff", "--no-color", "--no-index", "--", empty, path],
        &[1],
    )?;
    Ok(parse_diff(&raw.stdout, path))
}

pub fn commit_file_diff(repo: &Repo, commit: &str, path: &str) -> Result<FileDiff> {
    let out = cli::run(
        repo.root(),
        &["diff", "--no-color", "--find-renames", &format!("{commit}^!"), "--", path],
    )
    .or_else(|_| {
        cli::run(
            repo.root(),
            &["show", "--no-color", "--format=", "--find-renames", commit, "--", path],
        )
    })?;
    Ok(parse_diff(&out.stdout, path))
}

pub fn parse_diff(raw: &str, fallback_path: &str) -> FileDiff {
    let mut hunks = Vec::new();
    let mut current: Option<DiffHunk> = None;
    let mut path = fallback_path.to_string();
    let mut old_path = None;
    let mut binary = false;

    for line in raw.lines() {
        if line.starts_with("diff --git ") {
            if let Some(h) = current.take() {
                hunks.push(h);
            }
        } else if let Some(rest) = line.strip_prefix("rename from ") {
            old_path = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("+++ b/") {
            path = rest.to_string();
        } else if line.starts_with("Binary files ") {
            binary = true;
        } else if line.starts_with("@@ ") {
            if let Some(h) = current.take() {
                hunks.push(h);
            }
            let (old_start, old_lines, new_start, new_lines) = parse_hunk_header(line);
            current = Some(DiffHunk {
                header: line.to_string(),
                old_start,
                old_lines,
                new_start,
                new_lines,
                lines: Vec::new(),
            });
        } else if let Some(h) = current.as_mut() {
            if line.starts_with('+') && !line.starts_with("+++") {
                h.lines.push(DiffLine {
                    kind: "add".into(),
                    text: line[1..].to_string(),
                });
            } else if line.starts_with('-') && !line.starts_with("---") {
                h.lines.push(DiffLine {
                    kind: "del".into(),
                    text: line[1..].to_string(),
                });
            } else if line.starts_with(' ') || line.is_empty() {
                h.lines.push(DiffLine {
                    kind: "ctx".into(),
                    text: if line.is_empty() {
                        String::new()
                    } else {
                        line[1..].to_string()
                    },
                });
            } else if line == "\\ No newline at end of file" {
                continue;
            }
        }
    }
    if let Some(h) = current {
        hunks.push(h);
    }

    FileDiff {
        path,
        old_path,
        hunks,
        binary,
        raw: raw.to_string(),
    }
}

fn parse_hunk_header(line: &str) -> (u32, u32, u32, u32) {
    // @@ -l,s +l,s @@
    let mut old_start = 1;
    let mut old_lines = 1;
    let mut new_start = 1;
    let mut new_lines = 1;
    if let Some(at) = line.find("@@") {
        let rest = &line[at + 2..];
        if let Some(end) = rest.find("@@") {
            let body = rest[..end].trim();
            for part in body.split_whitespace() {
                if let Some(p) = part.strip_prefix('-') {
                    let (a, b) = split_range(p);
                    old_start = a;
                    old_lines = b;
                } else if let Some(p) = part.strip_prefix('+') {
                    let (a, b) = split_range(p);
                    new_start = a;
                    new_lines = b;
                }
            }
        }
    }
    (old_start, old_lines, new_start, new_lines)
}

fn split_range(s: &str) -> (u32, u32) {
    let mut it = s.split(',');
    let start = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let lines = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    (start, lines)
}

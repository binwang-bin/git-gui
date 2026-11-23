use crate::cli;
use crate::error::Result;
use crate::types::{ChangeKind, FileStatus};
use crate::Repo;

fn map_code(code: char) -> Option<ChangeKind> {
    match code {
        ' ' => None,
        'M' => Some(ChangeKind::Modified),
        'A' => Some(ChangeKind::Added),
        'D' => Some(ChangeKind::Deleted),
        'R' | 'C' => Some(ChangeKind::Renamed),
        'U' => Some(ChangeKind::Conflicted),
        '?' => Some(ChangeKind::Untracked),
        _ => Some(ChangeKind::Modified),
    }
}

pub fn status(repo: &Repo) -> Result<Vec<FileStatus>> {
    let out = cli::run(
        repo.root(),
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignore-submodules=dirty",
        ],
    )?;
    let bytes = out.stdout.into_bytes();
    let mut entries = Vec::new();
    let mut parts = bytes.split(|b| *b == 0).filter(|p| !p.is_empty());
    while let Some(record) = parts.next() {
        let text = String::from_utf8_lossy(record);
        if text.len() < 3 {
            continue;
        }
        let x = text.chars().next().unwrap_or(' ');
        let y = text.chars().nth(1).unwrap_or(' ');
        let rest = text[3..].to_string();

        if x == '?' && y == '?' {
            let rel = rest.replace('\\', "/");
            entries.push(FileStatus {
                path: repo.abs_path(&rel).display().to_string(),
                rel_path: rel,
                staged: None,
                unstaged: Some(ChangeKind::Untracked),
                renamed_from: None,
            });
            continue;
        }

        let conflicted = x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D');
        let (rel, renamed_from) = if matches!(x, 'R' | 'C') || matches!(y, 'R' | 'C') {
            let from = rest;
            let to = parts
                .next()
                .map(|p| String::from_utf8_lossy(p).into_owned())
                .unwrap_or_default();
            (to, Some(from))
        } else {
            (rest, None)
        };

        let (staged, unstaged) = if conflicted {
            (Some(ChangeKind::Conflicted), Some(ChangeKind::Conflicted))
        } else {
            (map_code(x), map_code(y))
        };

        let rel = rel.replace('\\', "/");
        entries.push(FileStatus {
            path: repo.abs_path(&rel).display().to_string(),
            rel_path: rel,
            staged,
            unstaged,
            renamed_from,
        });
    }
    Ok(entries)
}

use crate::cli;
use crate::diff;
use crate::error::{Error, Result};
use crate::status;
use crate::types::*;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct Repo {
    root: PathBuf,
}

impl Repo {
    pub fn discover(path: &Path) -> Result<Self> {
        let path = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        match gix::discover(&path) {
            Ok(repo) => {
                let root = repo
                    .workdir()
                    .map(|p| p.to_path_buf())
                    .or_else(|| repo.git_dir().parent().map(|p| p.to_path_buf()))
                    .ok_or_else(|| Error::NotARepo(path.clone()))?;
                Ok(Self {
                    root: dunce::canonicalize(&root).unwrap_or(root),
                })
            }
            Err(_) => {
                // Fallback: git rev-parse
                let out = cli::run(&path, &["rev-parse", "--show-toplevel"]).map_err(|_| Error::NotARepo(path))?;
                let root = PathBuf::from(out.stdout.trim());
                Ok(Self {
                    root: dunce::canonicalize(&root).unwrap_or(root),
                })
            }
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn abs_path(&self, rel: &str) -> PathBuf {
        self.root.join(rel.replace('\\', "/"))
    }

    pub fn status(&self) -> Result<Vec<FileStatus>> {
        status::status(self)
    }

    pub fn branch_info(&self) -> Result<BranchInfo> {
        let head = cli::run(self.root(), &["rev-parse", "--abbrev-ref", "HEAD"])
            .ok()
            .map(|o| o.stdout.trim().to_string())
            .filter(|s| !s.is_empty() && s != "HEAD");
        let head_commit = cli::run(self.root(), &["rev-parse", "HEAD"])
            .ok()
            .map(|o| o.stdout.trim().to_string());
        let upstream = cli::run(self.root(), &["rev-parse", "--abbrev-ref", "@{upstream}"])
            .ok()
            .map(|o| o.stdout.trim().to_string());

        let (ahead, behind) = if upstream.is_some() {
            let out = cli::run(self.root(), &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])
                .unwrap_or(cli::GitOutput {
                    stdout: "0\t0".into(),
                    stderr: String::new(),
                });
            let mut parts = out.stdout.split_whitespace();
            let ahead = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let behind = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            (ahead, behind)
        } else {
            (0, 0)
        };

        let operation = detect_operation(self.root());

        Ok(BranchInfo {
            head,
            head_commit,
            upstream,
            ahead,
            behind,
            operation,
        })
    }

    pub fn branches(&self) -> Result<Vec<Branch>> {
        let out = cli::run(
            self.root(),
            &[
                "for-each-ref",
                "--format=%(refname:short)%00%(objectname)%00%(HEAD)%00%(upstream:short)%00%(refname)%00%(upstream:track)",
                "refs/heads",
                "refs/remotes",
            ],
        )?;
        let mut branches = Vec::new();
        for line in out.stdout.split('\n').filter(|l| !l.is_empty()) {
            let mut parts = line.split('\0');
            let name = parts.next().unwrap_or("").to_string();
            let commit = parts.next().map(|s| s.to_string()).filter(|s| !s.is_empty());
            let is_head = parts.next() == Some("*");
            let upstream = parts.next().map(|s| s.to_string()).filter(|s| !s.is_empty());
            let refname = parts.next().unwrap_or("");
            let track = parts.next().unwrap_or("");
            let is_remote = refname.starts_with("refs/remotes/");
            // origin/HEAD short name is often just "origin" (no slash) — skip by full refname.
            if refname.ends_with("/HEAD") || name.ends_with("/HEAD") {
                continue;
            }
            let (ahead, behind) = if is_remote {
                (0, 0)
            } else {
                parse_upstream_track(track)
            };
            branches.push(Branch {
                name,
                is_remote,
                is_head,
                upstream,
                commit,
                ahead,
                behind,
            });
        }
        Ok(branches)
    }

    pub fn log(&self, query: &LogQuery) -> Result<Vec<Commit>> {
        let mut args = vec![
            "log".into(),
            "--topo-order".into(),
            "--date=unix".into(),
            "--pretty=format:%H%x00%h%x00%s%x00%b%x00%an%x00%ae%x00%at%x00%P%x00%D".into(),
            format!("-n{}", query.limit.max(1)),
        ];
        if query.skip > 0 {
            args.push(format!("--skip={}", query.skip));
        }
        if let Some(author) = &query.author {
            if !author.is_empty() {
                args.push(format!("--author={author}"));
            }
        }
        if let Some(grep) = &query.grep {
            if !grep.is_empty() {
                args.push(format!("--grep={grep}"));
                args.push("--regexp-ignore-case".into());
            }
        }
        if let Some(since) = query.since {
            if since > 0 {
                args.push(format!("--since={since}"));
            }
        }
        if let Some(branch) = &query.branch {
            if !branch.is_empty() && branch != "HEAD" {
                args.push(branch.clone());
            }
        }
        if let Some(path) = &query.path {
            if !path.is_empty() {
                args.push("--".into());
                args.push(path.clone());
            }
        }
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = cli::run(self.root(), &arg_refs)?;
        let mut commits = Vec::new();
        for block in out.stdout.split('\n').filter(|l| !l.is_empty()) {
            let mut p = block.split('\0');
            let id = p.next().unwrap_or("").to_string();
            if id.is_empty() {
                continue;
            }
            let short_id = p.next().unwrap_or("").to_string();
            let summary = p.next().unwrap_or("").to_string();
            let body = p.next().unwrap_or("").to_string();
            let author = p.next().unwrap_or("").to_string();
            let email = p.next().unwrap_or("").to_string();
            let time = p.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let parents = p
                .next()
                .unwrap_or("")
                .split_whitespace()
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect();
            let refs = p
                .next()
                .unwrap_or("")
                .split(", ")
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect();
            commits.push(Commit {
                id,
                short_id,
                summary,
                body,
                author,
                email,
                time,
                parents,
                refs,
            });
        }
        Ok(commits)
    }

    pub fn commit_files(&self, commit: &str) -> Result<Vec<ChangedFile>> {
        let out = cli::run(
            self.root(),
            &["diff-tree", "--no-commit-id", "--name-status", "-r", "-M", commit],
        )?;
        Ok(parse_name_status(&out.stdout))
    }

    pub fn file_diff(&self, path: &str, staged: bool) -> Result<FileDiff> {
        diff::file_diff(self, path, staged)
    }

    pub fn commit_file_diff(&self, commit: &str, path: &str) -> Result<FileDiff> {
        diff::commit_file_diff(self, commit, path)
    }

    pub fn stage(&self, paths: &[String]) -> Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let mut args = vec!["add", "--"];
        let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        args.extend(refs);
        cli::run(self.root(), &args)?;
        Ok(())
    }

    pub fn unstage(&self, paths: &[String]) -> Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let mut args = vec!["restore", "--staged", "--"];
        let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        args.extend(refs);
        cli::run(self.root(), &args)?;
        Ok(())
    }

    pub fn discard(&self, paths: &[String]) -> Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        // Untracked: remove; tracked: restore
        let status = self.status()?;
        let mut tracked = Vec::new();
        let mut untracked = Vec::new();
        for p in paths {
            let entry = status.iter().find(|s| &s.rel_path == p);
            if entry.map(|e| e.unstaged == Some(ChangeKind::Untracked)).unwrap_or(false) {
                untracked.push(p.as_str());
            } else {
                tracked.push(p.as_str());
            }
        }
        if !tracked.is_empty() {
            let mut args = vec!["restore", "--worktree", "--source=HEAD", "--"];
            args.extend(tracked);
            cli::run(self.root(), &args)?;
        }
        for u in untracked {
            let path = self.abs_path(u);
            if path.is_dir() {
                std::fs::remove_dir_all(&path)?;
            } else if path.exists() {
                std::fs::remove_file(&path)?;
            }
        }
        Ok(())
    }

    pub fn commit(&self, message: &str, amend: bool, sign_off: bool) -> Result<String> {
        let mut args = vec!["commit".to_string()];
        if amend {
            args.push("--amend".into());
        }
        if sign_off {
            args.push("--signoff".into());
        }
        args.push("-F".into());
        args.push("-".into());
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = cli::run_stdin(self.root(), &arg_refs, Some(message))?;
        Ok(out.stdout.trim().to_string())
    }

    pub fn checkout(&self, branch: &str, create: bool) -> Result<()> {
        if create {
            cli::run(self.root(), &["checkout", "-b", branch])?;
        } else {
            cli::run(self.root(), &["checkout", branch])?;
        }
        Ok(())
    }

    pub fn create_branch(&self, name: &str, start: Option<&str>, checkout: bool) -> Result<()> {
        if let Some(start) = start {
            cli::run(self.root(), &["branch", name, start])?;
        } else {
            cli::run(self.root(), &["branch", name])?;
        }
        if checkout {
            cli::run(self.root(), &["checkout", name])?;
        }
        Ok(())
    }

    pub fn rename_branch(&self, old: &str, new: &str) -> Result<()> {
        cli::run(self.root(), &["branch", "-m", old, new])?;
        Ok(())
    }

    /// Merge `branch` into the current HEAD.
    pub fn merge_branch(&self, branch: &str) -> Result<String> {
        let out = cli::run(self.root(), &["merge", "--no-edit", branch])?;
        Ok(format!("{}{}", out.stdout, out.stderr))
    }

    /// Rebase current HEAD onto `onto`.
    pub fn rebase_onto(&self, onto: &str) -> Result<String> {
        let out = cli::run(self.root(), &["rebase", onto])?;
        Ok(format!("{}{}", out.stdout, out.stderr))
    }

    /// Checkout `branch` then rebase it onto `onto` (IDEA Checkout and Rebase).
    pub fn checkout_and_rebase(&self, branch: &str, onto: &str) -> Result<String> {
        self.checkout(branch, false)?;
        self.rebase_onto(onto)
    }

    /// Diff working tree against `rev` (IDEA Show Diff with Working Tree).
    pub fn diff_with_working_tree(&self, rev: &str) -> Result<String> {
        let out = cli::run_allow(self.root(), &["diff", "--no-color", rev], &[1])?;
        Ok(out.stdout)
    }

    pub fn push_branch(&self, name: &str) -> Result<String> {
        let out = cli::run(self.root(), &["push", "-u", "origin", name])
            .or_else(|_| cli::run(self.root(), &["push", "-u", "HEAD"]))?;
        Ok(format!("{}{}", out.stdout, out.stderr))
    }

    pub fn delete_branch(&self, name: &str, force: bool) -> Result<()> {
        let branches = self.branches()?;
        if let Some(b) = branches.iter().find(|b| b.name == name && b.is_remote) {
            let (remote, short) = split_remote_ref(&b.name)
                .ok_or_else(|| Error::msg(format!("Invalid remote branch: {name}")))?;
            cli::run(
                self.root(),
                &["push", remote, &format!(":refs/heads/{short}")],
            )?;
            let _ = cli::run(self.root(), &["fetch", "--prune", remote]);
            return Ok(());
        }
        let flag = if force { "-D" } else { "-d" };
        cli::run(self.root(), &["branch", flag, name])?;
        Ok(())
    }

    /// Update a local branch from its upstream (IDEA "Update Selected").
    /// Current branch → pull; others → fetch then fast-forward only.
    pub fn update_branch(&self, name: &str) -> Result<String> {
        let branches = self.branches()?;
        let b = branches
            .iter()
            .find(|b| b.name == name && !b.is_remote)
            .ok_or_else(|| Error::msg(format!("Local branch not found: {name}")))?;
        let upstream = b
            .upstream
            .as_deref()
            .ok_or_else(|| Error::msg(format!("Branch '{name}' has no tracked upstream")))?;
        if b.is_head {
            return self.pull(false);
        }
        let _ = self.fetch()?;
        let local = cli::run(self.root(), &["rev-parse", name])?
            .stdout
            .trim()
            .to_string();
        let remote = cli::run(self.root(), &["rev-parse", upstream])?
            .stdout
            .trim()
            .to_string();
        if local == remote {
            return Ok(format!("{name} is already up-to-date with {upstream}"));
        }
        if cli::run(self.root(), &["merge-base", "--is-ancestor", name, upstream]).is_err() {
            return Err(Error::msg(format!(
                "Cannot fast-forward '{name}' to '{upstream}'"
            )));
        }
        cli::run(
            self.root(),
            &["update-ref", &format!("refs/heads/{name}"), &remote],
        )?;
        Ok(format!("Updated {name} to {upstream}"))
    }

    pub fn fetch(&self) -> Result<String> {
        let out = cli::run(self.root(), &["fetch", "--prune", "--all"])?;
        Ok(format!("{}{}", out.stdout, out.stderr))
    }

    pub fn pull(&self, rebase: bool) -> Result<String> {
        let out = if rebase {
            cli::run(self.root(), &["pull", "--rebase"])?
        } else {
            cli::run(self.root(), &["pull"])?
        };
        Ok(format!("{}{}", out.stdout, out.stderr))
    }

    pub fn push(&self, force: bool) -> Result<String> {
        let out = if force {
            cli::run(self.root(), &["push", "--force-with-lease"])?
        } else {
            cli::run(self.root(), &["push", "-u", "HEAD"])
                .or_else(|_| cli::run(self.root(), &["push"]))?
        };
        Ok(format!("{}{}", out.stdout, out.stderr))
    }

    pub fn remotes(&self) -> Result<Vec<Remote>> {
        let out = cli::run(self.root(), &["remote", "-v"])?;
        let mut map = std::collections::BTreeMap::<String, Remote>::new();
        for line in out.stdout.lines() {
            let mut parts = line.split_whitespace();
            let name = parts.next().unwrap_or("").to_string();
            let url = parts.next().unwrap_or("").to_string();
            let kind = parts.next().unwrap_or("");
            if name.is_empty() {
                continue;
            }
            let entry = map.entry(name.clone()).or_insert(Remote {
                name,
                fetch_url: String::new(),
                push_url: None,
            });
            if kind.contains("fetch") {
                entry.fetch_url = url;
            } else if kind.contains("push") {
                entry.push_url = Some(url);
            }
        }
        Ok(map.into_values().collect())
    }

    pub fn set_remote_url(&self, name: &str, url: &str) -> Result<()> {
        let remotes = self.remotes()?;
        if remotes.iter().any(|r| r.name == name) {
            cli::run(self.root(), &["remote", "set-url", name, url])?;
        } else {
            cli::run(self.root(), &["remote", "add", name, url])?;
        }
        Ok(())
    }

    pub fn remove_remote(&self, name: &str) -> Result<()> {
        cli::run(self.root(), &["remote", "remove", name])?;
        Ok(())
    }

    /// Fetch then merge/rebase a remote-tracking ref into the current branch.
    pub fn pull_remote_branch(&self, remote_ref: &str, rebase: bool) -> Result<String> {
        let _ = self.fetch()?;
        if rebase {
            self.rebase_onto(remote_ref)
        } else {
            self.merge_branch(remote_ref)
        }
    }

    pub fn stashes(&self) -> Result<Vec<Stash>> {
        let out = cli::run(
            self.root(),
            &["stash", "list", "--pretty=format:%gd%x00%H%x00%s%x00%ct"],
        )?;
        let mut stashes = Vec::new();
        for (i, line) in out.stdout.lines().enumerate() {
            let mut p = line.split('\0');
            let _gd = p.next();
            let commit = p.next().unwrap_or("").to_string();
            let message = p.next().unwrap_or("").to_string();
            let time = p.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            stashes.push(Stash {
                index: i as u32,
                message,
                commit,
                time,
            });
        }
        Ok(stashes)
    }

    pub fn stash_diff(&self, index: u32) -> Result<FileDiff> {
        let target = format!("stash@{{{index}}}");
        let out = cli::run(
            self.root(),
            &["stash", "show", "-p", "--no-color", "--include-untracked", &target],
        )?;
        Ok(crate::diff::parse_diff(&out.stdout, &target))
    }

    pub fn stash_files(&self, index: u32) -> Result<Vec<ChangedFile>> {
        let target = format!("stash@{{{index}}}");
        let out = cli::run(
            self.root(),
            &[
                "stash",
                "show",
                "--name-status",
                "--include-untracked",
                &target,
            ],
        )?;
        Ok(parse_name_status(&out.stdout))
    }

    pub fn stash_file_diff(&self, index: u32, path: &str) -> Result<FileDiff> {
        let target = format!("stash@{{{index}}}");
        // Working-tree side of the stash vs its first parent (HEAD at stash time).
        let parent = format!("{target}^1");
        let out = cli::run(
            self.root(),
            &[
                "diff",
                "--no-color",
                "--find-renames",
                &parent,
                &target,
                "--",
                path,
            ],
        )?;
        if !out.stdout.trim().is_empty() {
            return Ok(crate::diff::parse_diff(&out.stdout, path));
        }
        // Untracked-only paths may only appear via stash show -p -- path.
        let patch = cli::run(
            self.root(),
            &[
                "stash",
                "show",
                "-p",
                "--no-color",
                "--include-untracked",
                &target,
                "--",
                path,
            ],
        )?;
        Ok(crate::diff::parse_diff(&patch.stdout, path))
    }

    pub fn list_dir(&self, rel: &str) -> Result<Vec<DirEntry>> {
        let dir = if rel.is_empty() || rel == "." {
            self.root().to_path_buf()
        } else {
            self.abs_path(rel)
        };
        let mut entries = Vec::new();
        let read = std::fs::read_dir(&dir).map_err(Error::from)?;
        for item in read.flatten() {
            let name = item.file_name().to_string_lossy().into_owned();
            if name == ".git" {
                continue;
            }
            let is_dir = item.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let path = if rel.is_empty() || rel == "." {
                name.clone()
            } else {
                format!("{}/{}", rel.trim_end_matches('/'), name).replace('\\', "/")
            };
            entries.push(DirEntry {
                name,
                path: path.replace('\\', "/"),
                is_dir,
            });
        }
        entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });
        Ok(entries)
    }

    pub fn stash_push(&self, message: Option<&str>, paths: &[String]) -> Result<()> {
        let mut args: Vec<String> = vec!["stash".into(), "push".into()];
        // Path-scoped stash may include untracked files (IDEA "Stash Selected").
        if !paths.is_empty() {
            args.push("-u".into());
        }
        if let Some(msg) = message.filter(|m| !m.is_empty()) {
            args.push("-m".into());
            args.push(msg.to_string());
        }
        if !paths.is_empty() {
            args.push("--".into());
            args.extend(paths.iter().cloned());
        }
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        cli::run(self.root(), &refs)?;
        Ok(())
    }

    /// Delete working-tree paths and stage the result (IDEA "Delete…").
    pub fn delete_paths(&self, paths: &[String]) -> Result<()> {
        for p in paths {
            let path = self.root().join(p);
            if path.is_dir() {
                std::fs::remove_dir_all(&path)?;
            } else if path.exists() {
                std::fs::remove_file(&path)?;
            }
        }
        if !paths.is_empty() {
            let mut args = vec!["add".to_string(), "-A".to_string(), "--".to_string()];
            args.extend(paths.iter().cloned());
            let refs: Vec<&str> = args.iter().map(String::as_str).collect();
            cli::run(self.root(), &refs)?;
        }
        Ok(())
    }

    /// Unified diff text for Create/Copy Patch (includes untracked via --no-index).
    pub fn diff_patch(&self, paths: &[String], staged: bool) -> Result<String> {
        let mut args = vec!["diff".to_string()];
        if staged {
            args.push("--cached".into());
        }
        args.push("--".into());
        args.extend(paths.iter().cloned());
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = cli::run(self.root(), &refs)?;
        let mut text = out.stdout;
        if staged || !text.trim().is_empty() {
            return Ok(text);
        }
        let empty = if cfg!(windows) { "NUL" } else { "/dev/null" };
        for p in paths {
            let raw = cli::run_allow(
                self.root(),
                &["diff", "--no-index", "--", empty, p],
                &[1],
            )?;
            if !raw.stdout.is_empty() {
                if !text.is_empty() && !text.ends_with('\n') {
                    text.push('\n');
                }
                text.push_str(&raw.stdout);
            }
        }
        Ok(text)
    }

    pub fn append_gitignore(&self, pattern: &str) -> Result<()> {
        self.append_ignore_file(self.root().join(".gitignore"), pattern)
    }

    /// IDEA "Add to .git/info/exclude".
    pub fn append_exclude(&self, pattern: &str) -> Result<()> {
        let info = self.root().join(".git").join("info");
        std::fs::create_dir_all(&info)?;
        self.append_ignore_file(info.join("exclude"), pattern)
    }

    fn append_ignore_file(&self, path: PathBuf, pattern: &str) -> Result<()> {
        let mut contents = if path.exists() {
            std::fs::read_to_string(&path)?
        } else {
            String::new()
        };
        let line = pattern.trim();
        if line.is_empty() {
            return Ok(());
        }
        if contents.lines().any(|l| l.trim() == line) {
            return Ok(());
        }
        if !contents.is_empty() && !contents.ends_with('\n') {
            contents.push('\n');
        }
        contents.push_str(line);
        contents.push('\n');
        std::fs::write(&path, contents)?;
        Ok(())
    }

    pub fn stash_apply(&self, index: u32, pop: bool) -> Result<()> {
        let target = format!("stash@{{{index}}}");
        if pop {
            cli::run(self.root(), &["stash", "pop", &target])?;
        } else {
            cli::run(self.root(), &["stash", "apply", &target])?;
        }
        Ok(())
    }

    pub fn stash_drop(&self, index: u32) -> Result<()> {
        let target = format!("stash@{{{index}}}");
        cli::run(self.root(), &["stash", "drop", &target])?;
        Ok(())
    }

    pub fn stash_clear(&self) -> Result<()> {
        cli::run(self.root(), &["stash", "clear"])?;
        Ok(())
    }

    pub fn reset(&self, commit: &str, mode: ResetMode) -> Result<()> {
        let flag = match mode {
            ResetMode::Soft => "--soft",
            ResetMode::Mixed => "--mixed",
            ResetMode::Hard => "--hard",
        };
        cli::run(self.root(), &["reset", flag, commit])?;
        Ok(())
    }

    pub fn revert(&self, commits: &[String]) -> Result<String> {
        let mut args = vec!["revert", "--no-edit"];
        let refs: Vec<&str> = commits.iter().map(String::as_str).collect();
        args.extend(refs);
        let out = cli::run(self.root(), &args)?;
        Ok(format!("{}{}", out.stdout, out.stderr))
    }

    pub fn cherry_pick(&self, commits: &[String]) -> Result<String> {
        let mut args = vec!["cherry-pick"];
        let refs: Vec<&str> = commits.iter().map(String::as_str).collect();
        args.extend(refs);
        let out = cli::run(self.root(), &args)?;
        Ok(format!("{}{}", out.stdout, out.stderr))
    }

    pub fn continue_operation(&self) -> Result<String> {
        let op = detect_operation(self.root());
        let out = match op.as_deref() {
            Some("rebase") | Some("rebase-merge") | Some("rebase-apply") => {
                cli::run(self.root(), &["rebase", "--continue"])?
            }
            Some("merge") => cli::run(self.root(), &["commit", "--no-edit"])?,
            Some("cherry-pick") => cli::run(self.root(), &["cherry-pick", "--continue"])?,
            Some("revert") => cli::run(self.root(), &["revert", "--continue"])?,
            _ => return Err(Error::msg("No operation in progress")),
        };
        Ok(format!("{}{}", out.stdout, out.stderr))
    }

    pub fn abort_operation(&self) -> Result<String> {
        let op = detect_operation(self.root());
        let out = match op.as_deref() {
            Some("rebase") | Some("rebase-merge") | Some("rebase-apply") => {
                cli::run(self.root(), &["rebase", "--abort"])?
            }
            Some("merge") => cli::run(self.root(), &["merge", "--abort"])?,
            Some("cherry-pick") => cli::run(self.root(), &["cherry-pick", "--abort"])?,
            Some("revert") => cli::run(self.root(), &["revert", "--abort"])?,
            _ => return Err(Error::msg("No operation in progress")),
        };
        Ok(format!("{}{}", out.stdout, out.stderr))
    }

    pub fn stage_hunk(&self, _path: &str, patch: &str) -> Result<()> {
        self.apply_patch(patch, true, false)
    }

    /// Apply a unified diff patch.
    /// - `cached`: apply to index (`--cached`)
    /// - `reverse`: reverse the patch (`--reverse`) — discard staged/worktree lines
    pub fn apply_patch(&self, patch: &str, cached: bool, reverse: bool) -> Result<()> {
        let mut args: Vec<&str> = vec!["apply"];
        if cached {
            args.push("--cached");
        }
        if reverse {
            args.push("--reverse");
        }
        args.push("--unidiff-zero");
        args.push("-");
        cli::run_stdin(self.root(), &args, Some(patch)).or_else(|_| {
            let mut args2: Vec<&str> = vec!["apply"];
            if cached {
                args2.push("--cached");
            }
            if reverse {
                args2.push("--reverse");
            }
            args2.push("-");
            cli::run_stdin(self.root(), &args2, Some(patch))
        })?;
        Ok(())
    }

    /// Resolve conflicted paths with ours/theirs, then stage.
    pub fn conflict_resolve(&self, paths: &[String], side: &str) -> Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let flag = match side {
            "ours" => "--ours",
            "theirs" => "--theirs",
            _ => return Err(Error::msg("side must be ours or theirs")),
        };
        let mut args: Vec<&str> = vec!["checkout", flag, "--"];
        let refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        args.extend(refs.iter().copied());
        cli::run(self.root(), &args)?;
        self.stage(paths)?;
        Ok(())
    }

    pub fn blame(&self, path: &str) -> Result<Vec<BlameLine>> {
        let out = cli::run(
            self.root(),
            &[
                "blame",
                "--line-porcelain",
                "--",
                path,
            ],
        )?;
        Ok(parse_blame(&out.stdout))
    }

    pub fn log_users(&self) -> Result<Vec<String>> {
        let out = cli::run(
            self.root(),
            &["log", "--all", "--format=%aN <%aE>", "-n", "500"],
        )?;
        let mut users = Vec::new();
        for line in out.stdout.lines() {
            let name = line.trim();
            if name.is_empty() || users.iter().any(|u| u == name) {
                continue;
            }
            users.push(name.to_string());
        }
        users.sort();
        Ok(users)
    }

    pub fn outgoing_commits(&self) -> Result<Vec<Commit>> {
        let info = self.branch_info()?;
        if info.upstream.is_none() {
            return Ok(Vec::new());
        }
        self.log(&LogQuery {
            limit: 100,
            skip: 0,
            author: None,
            grep: None,
            path: None,
            branch: Some("@{upstream}..HEAD".into()),
            since: None,
        })
    }
}

/// Parse `%(upstream:track)` like `[ahead 1, behind 2]` / `[ahead 1]` / `[behind 2]`.
fn parse_upstream_track(track: &str) -> (u32, u32) {
    let mut ahead = 0u32;
    let mut behind = 0u32;
    if let Some(i) = track.find("ahead ") {
        ahead = track[i + 6..]
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse()
            .unwrap_or(0);
    }
    if let Some(i) = track.find("behind ") {
        behind = track[i + 7..]
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse()
            .unwrap_or(0);
    }
    (ahead, behind)
}

/// Split `origin/feature/x` into (`origin`, `feature/x`).
fn split_remote_ref(name: &str) -> Option<(&str, &str)> {
    let i = name.find('/')?;
    let (remote, rest) = name.split_at(i);
    let short = rest.trim_start_matches('/');
    if remote.is_empty() || short.is_empty() {
        None
    } else {
        Some((remote, short))
    }
}

fn detect_operation(root: &Path) -> Option<String> {
    let git_dir = cli::run(root, &["rev-parse", "--git-dir"])
        .ok()
        .map(|o| root.join(o.stdout.trim()))?;
    if git_dir.join("MERGE_HEAD").exists() {
        return Some("merge".into());
    }
    if git_dir.join("CHERRY_PICK_HEAD").exists() {
        return Some("cherry-pick".into());
    }
    if git_dir.join("REVERT_HEAD").exists() {
        return Some("revert".into());
    }
    if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
        return Some("rebase".into());
    }
    None
}

fn parse_name_status(stdout: &str) -> Vec<ChangedFile> {
    let mut files = Vec::new();
    for line in stdout.lines().filter(|l| !l.is_empty()) {
        let mut parts = line.split('\t');
        let code = parts.next().unwrap_or("");
        let status = match code.chars().next().unwrap_or('M') {
            'A' => ChangeKind::Added,
            'D' => ChangeKind::Deleted,
            'R' | 'C' => ChangeKind::Renamed,
            'U' => ChangeKind::Conflicted,
            _ => ChangeKind::Modified,
        };
        if matches!(status, ChangeKind::Renamed) {
            let old = parts.next().unwrap_or("").to_string();
            let new = parts.next().unwrap_or("").to_string();
            files.push(ChangedFile {
                path: new,
                status,
                old_path: Some(old),
            });
        } else {
            let path = parts.next().unwrap_or("").to_string();
            files.push(ChangedFile {
                path,
                status,
                old_path: None,
            });
        }
    }
    files
}

fn parse_blame(stdout: &str) -> Vec<BlameLine> {
    let mut lines = Vec::new();
    let mut commit = String::new();
    let mut author = String::new();
    let mut time = 0i64;
    let mut summary = String::new();
    for line in stdout.lines() {
        if line.starts_with('\t') {
            lines.push(BlameLine {
                commit: commit.clone(),
                author: author.clone(),
                time,
                summary: summary.clone(),
                line: line[1..].to_string(),
            });
        } else if let Some((hash, _)) = line.split_once(' ') {
            if hash.len() >= 40 {
                commit = hash.to_string();
            } else if let Some(rest) = line.strip_prefix("author ") {
                author = rest.to_string();
            } else if let Some(rest) = line.strip_prefix("author-time ") {
                time = rest.parse().unwrap_or(0);
            } else if let Some(rest) = line.strip_prefix("summary ") {
                summary = rest.to_string();
            }
        } else if let Some(rest) = line.strip_prefix("author ") {
            author = rest.to_string();
        } else if let Some(rest) = line.strip_prefix("author-time ") {
            time = rest.parse().unwrap_or(0);
        } else if let Some(rest) = line.strip_prefix("summary ") {
            summary = rest.to_string();
        }
    }
    lines
}

pub fn init(dir: &Path) -> Result<Repo> {
    std::fs::create_dir_all(dir)?;
    cli::run(dir, &["init"])?;
    Repo::discover(dir)
}

pub fn clone(url: &str, dir: &Path) -> Result<Repo> {
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent)?;
    }
    cli::run(
        dir.parent().unwrap_or(Path::new(".")),
        &["clone", url, &dir.display().to_string()],
    )?;
    Repo::discover(dir)
}

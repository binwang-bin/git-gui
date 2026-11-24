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

    /// OpenIDEA-style paged log. When authors/date need exact predicates, fills a page by
    /// scanning the underlying `git log` stream and returns `next_skip` as the stream cursor.
    pub fn log(&self, query: &LogQuery) -> Result<LogPage> {
        let limit = query.limit.max(1) as usize;
        let exact = query_needs_exact_fill(query);
        let (mut commits, next_skip, has_more) = if exact {
            self.log_fill(query, limit)?
        } else {
            let raw = self.log_fetch(query, query.skip, limit, /*prefilter_authors*/ false)?;
            let n = raw.len() as u32;
            let next = query.skip.saturating_add(n);
            let more = raw.len() >= limit;
            (raw, next, more)
        };
        // OpenIDEA: revision `parents` stay raw; `graph_parents` skip hidden commits so
        // filtered logs still draw connected lanes (`Visibility::parents`).
        attach_graph_parents(self, &mut commits, query);
        Ok(LogPage {
            commits,
            next_skip,
            has_more,
        })
    }

    /// Scan the git stream, retain only exact matches, until `limit` rows or EOF.
    fn log_fill(&self, query: &LogQuery, limit: usize) -> Result<(Vec<Commit>, u32, bool)> {
        let mut out = Vec::with_capacity(limit);
        let mut stream_pos = query.skip;
        // Larger batches keep rare authors from issuing dozens of tiny git calls.
        let batch = (limit.saturating_mul(4)).max(100).min(2000);
        loop {
            let chunk = self.log_fetch(query, stream_pos, batch, /*prefilter_authors*/ true)?;
            if chunk.is_empty() {
                return Ok((out, stream_pos, false));
            }
            let fetched = chunk.len();
            for c in chunk {
                stream_pos = stream_pos.saturating_add(1);
                if commit_matches_list_filters(&c, query) {
                    out.push(c);
                    if out.len() >= limit {
                        return Ok((out, stream_pos, true));
                    }
                }
            }
            if fetched < batch {
                return Ok((out, stream_pos, false));
            }
        }
    }

    /// One `git log` page. `%ct` = committer time (OpenIDEA date filter / `--date-order`).
    fn log_fetch(
        &self,
        query: &LogQuery,
        skip: u32,
        limit: usize,
        prefilter_authors: bool,
    ) -> Result<Vec<Commit>> {
        // tformat + trailing NUL: every field and every record is NUL-framed.
        // Do NOT include `%b`/`%B` here — bodies contain newlines and must not be
        // line-split (that invented blank rows with time=0 → UI "1970/1/1").
        // Body is loaded on demand via `commit_message`.
        // OpenIDEA UI default sort is `date` → `--date-order`.
        let mut args = vec![
            "log".into(),
            "--date-order".into(),
            "--pretty=tformat:%H%x00%h%x00%s%x00%an%x00%ae%x00%ct%x00%P%x00%D%x00".into(),
            format!("-n{}", limit.max(1)),
        ];
        if skip > 0 {
            args.push(format!("--skip={skip}"));
        }
        let authors = query_authors(query);
        if prefilter_authors && !authors.is_empty() {
            // Multiple `--author` = OR. Loose ERE needles; exact match happens in fill.
            for a in &authors {
                args.push(format!("--author={}", author_needle_for_git(a)));
            }
        }
        if let Some(grep) = &query.grep {
            if !grep.is_empty() {
                args.push(format!("--grep={grep}"));
                args.push("--regexp-ignore-case".into());
            }
        }
        // Git `--since`/`--until` use committer date (same as OpenIDEA).
        if let Some(since_ms) = query_since_ms(query) {
            if since_ms > 0 {
                args.push(format!("--since={}", since_ms / 1000));
            }
        }
        if let Some(until_ms) = query.until_ms {
            if until_ms > 0 {
                args.push(format!("--until={}", until_ms / 1000));
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
        Ok(parse_log_nul(&out.stdout))
    }

    fn gix(&self) -> Result<gix::Repository> {
        gix::open(self.root()).map_err(|e| Error::msg(format!("open repo: {e}")))
    }

    /// Subject + body for a single commit (detail panel).
    pub fn commit_message(&self, id: &str) -> Result<(String, String)> {
        let out = cli::run(
            self.root(),
            &["log", "-1", "--pretty=format:%s%x00%b", id],
        )?;
        let mut p = out.stdout.splitn(2, '\0');
        let summary = p.next().unwrap_or("").to_string();
        let body = p.next().unwrap_or("").trim().to_string();
        Ok((summary, body))
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

    /// OpenIDEA `conflict_versions` — stage 1/2/3 blobs for the merge editor.
    pub fn conflict_versions(&self, path: &str) -> Result<MergeVersions> {
        let sides = self.merge_sides()?;
        let base_raw = self.stage_blob(1, path)?;
        let ours_raw = self.stage_blob(2, path)?;
        let theirs_raw = self.stage_blob(3, path)?;
        let binary = [&base_raw, &ours_raw, &theirs_raw]
            .iter()
            .any(|b| b.as_ref().is_some_and(|bytes| bytes.contains(&0)));
        if binary {
            return Ok(MergeVersions {
                binary: true,
                base: None,
                ours: None,
                theirs: None,
                sides,
            });
        }
        let decode = |b: Option<Vec<u8>>| b.map(|bytes| String::from_utf8_lossy(&bytes).into_owned());
        let mut base = decode(base_raw);
        let mut ours = decode(ours_raw);
        let mut theirs = decode(theirs_raw);
        if sides.reversed {
            std::mem::swap(&mut ours, &mut theirs);
        }
        // Empty base is fine (add/add); keep "" so the merge model still has a document.
        if base.is_none() && (ours.is_some() || theirs.is_some()) {
            base = Some(String::new());
        }
        Ok(MergeVersions {
            binary: false,
            base,
            ours,
            theirs,
            sides,
        })
    }

    /// Write resolved merge result to the worktree and stage it.
    pub fn write_and_stage(&self, path: &str, contents: &str) -> Result<()> {
        let full = self.root().join(path);
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&full, contents)?;
        self.stage(&[path.to_string()])?;
        Ok(())
    }

    fn stage_blob(&self, stage: u8, path: &str) -> Result<Option<Vec<u8>>> {
        let spec = format!(":{stage}:{path}");
        let git = cli::git_executable().ok();
        let Some(git) = git else {
            return Ok(None);
        };
        let mut cmd = std::process::Command::new(&git);
        cmd.args(["show", &spec])
            .current_dir(self.root())
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let output = cmd.output()?;
        if !output.status.success() {
            return Ok(None);
        }
        Ok(Some(output.stdout))
    }

    /// OpenIDEA `merge_sides` — operation labels; rebase flips yours/theirs.
    pub fn merge_sides(&self) -> Result<MergeSides> {
        let operation = detect_operation(self.root());
        let info = self.branch_info().ok();
        let mut sides = MergeSides {
            operation: operation.clone(),
            reversed: false,
            branch: info.as_ref().and_then(|i| i.head.clone()),
            commit: None,
            other_branch: None,
        };
        let git_dir = cli::run(self.root(), &["rev-parse", "--git-dir"])
            .ok()
            .map(|o| self.root().join(o.stdout.trim()));
        let Some(git_dir) = git_dir else {
            return Ok(sides);
        };
        let read_first = |name: &str| -> Option<String> {
            std::fs::read_to_string(git_dir.join(name))
                .ok()
                .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
                .filter(|s| !s.is_empty())
        };
        let short = |id: String| id.chars().take(8).collect::<String>();
        match operation.as_deref() {
            Some("rebase") => {
                sides.reversed = true;
                sides.commit = read_first("REBASE_HEAD").map(short);
                for dir in ["rebase-merge", "rebase-apply"] {
                    if git_dir.join(dir).is_dir() {
                        if let Some(head) = read_first(&format!("{dir}/head-name")) {
                            sides.branch = Some(
                                head.strip_prefix("refs/heads/")
                                    .unwrap_or(&head)
                                    .to_string(),
                            );
                        }
                        break;
                    }
                }
            }
            Some("merge") => {
                sides.commit = read_first("MERGE_HEAD").map(short);
                sides.other_branch = read_first("MERGE_MSG")
                    .and_then(|m| m.split('\'').nth(1).map(str::to_string))
                    .filter(|b| !b.is_empty());
            }
            Some("cherry-pick") => sides.commit = read_first("CHERRY_PICK_HEAD").map(short),
            Some("revert") => sides.commit = read_first("REVERT_HEAD").map(short),
            _ => {}
        }
        Ok(sides)
    }

    fn git_dir(&self) -> Result<PathBuf> {
        let out = cli::run(self.root(), &["rev-parse", "--git-dir"])?;
        let p = PathBuf::from(out.stdout.trim());
        Ok(if p.is_absolute() {
            p
        } else {
            self.root().join(p)
        })
    }

    fn shelf_dir(&self) -> Result<PathBuf> {
        let dir = self.git_dir()?.join("idevcs").join("shelf");
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    /// List shelved patch entries (newest first).
    pub fn shelves(&self) -> Result<Vec<ShelfEntry>> {
        let dir = self.shelf_dir()?;
        let mut out = Vec::new();
        for ent in std::fs::read_dir(&dir)? {
            let ent = ent?;
            let path = ent.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let text = std::fs::read_to_string(&path)?;
            if let Ok(entry) = serde_json::from_str::<ShelfEntry>(&text) {
                out.push(entry);
            }
        }
        out.sort_by(|a, b| b.time.cmp(&a.time));
        Ok(out)
    }

    /// Save working-tree (+ staged) patch for `paths`, then discard those paths.
    pub fn shelve(&self, name: &str, paths: &[String]) -> Result<ShelfEntry> {
        if paths.is_empty() {
            return Err(Error::msg("no paths to shelve"));
        }
        let staged = self.diff_patch(paths, true)?;
        let unstaged = self.diff_patch(paths, false)?;
        let mut patch = String::new();
        if !staged.trim().is_empty() {
            patch.push_str(&staged);
            if !patch.ends_with('\n') {
                patch.push('\n');
            }
        }
        if !unstaged.trim().is_empty() {
            patch.push_str(&unstaged);
        }
        if patch.trim().is_empty() {
            return Err(Error::msg("no changes to shelve"));
        }
        let id = format!(
            "{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0),
            &uuid_lite()
        );
        let entry = ShelfEntry {
            id: id.clone(),
            name: {
                let n = name.trim();
                if n.is_empty() {
                    "Shelved changes".into()
                } else {
                    n.to_string()
                }
            },
            time: chrono_now_secs(),
            paths: paths.to_vec(),
        };
        let dir = self.shelf_dir()?;
        std::fs::write(dir.join(format!("{id}.patch")), &patch)?;
        std::fs::write(
            dir.join(format!("{id}.json")),
            serde_json::to_string_pretty(&entry).map_err(|e| Error::msg(e.to_string()))?,
        )?;
        // Clear index + worktree for tracked; delete untracked.
        let _ = self.unstage(paths);
        self.discard(paths)?;
        Ok(entry)
    }

    pub fn unshelve(&self, id: &str, drop_after: bool) -> Result<()> {
        let dir = self.shelf_dir()?;
        let patch_path = dir.join(format!("{id}.patch"));
        if !patch_path.exists() {
            return Err(Error::msg(format!("shelf entry not found: {id}")));
        }
        let patch = std::fs::read_to_string(&patch_path)?;
        self.apply_patch(&patch, false, false)?;
        if drop_after {
            self.drop_shelf(id)?;
        }
        Ok(())
    }

    pub fn drop_shelf(&self, id: &str) -> Result<()> {
        let dir = self.shelf_dir()?;
        let _ = std::fs::remove_file(dir.join(format!("{id}.json")));
        let _ = std::fs::remove_file(dir.join(format!("{id}.patch")));
        Ok(())
    }

    /// Interactive rebase via `GIT_SEQUENCE_EDITOR` (OpenIDEA-style).
    /// `base` is the exclusive parent (onto); commits in `entries` are `base..HEAD`, oldest first.
    pub fn interactive_rebase(&self, base: &str, entries: &[RebaseEntry]) -> Result<String> {
        if self.branch_info()?.operation.is_some() {
            return Err(Error::msg(
                "another merge, rebase, cherry-pick or revert is in progress",
            ));
        }
        if entries.is_empty() {
            return Err(Error::msg("no commits to rebase"));
        }
        let work = self.git_dir()?.join("idevcs-rebase");
        let _ = std::fs::remove_dir_all(&work);
        std::fs::create_dir_all(&work)?;
        let mut todo = String::new();
        for (i, e) in entries.iter().enumerate() {
            let verb = match e.action {
                RebaseAction::Pick | RebaseAction::Reword => "pick",
                RebaseAction::Edit => "edit",
                RebaseAction::Squash => "squash",
                RebaseAction::Fixup => "fixup",
                RebaseAction::Drop => "drop",
            };
            todo.push_str(&format!("{verb} {}\n", e.commit.trim()));
            let message = e.message.as_deref().map(str::trim).filter(|m| !m.is_empty());
            let wants = matches!(
                e.action,
                RebaseAction::Reword | RebaseAction::Squash | RebaseAction::Fixup | RebaseAction::Pick
            );
            let next_joins = entries
                .get(i + 1)
                .is_some_and(|n| matches!(n.action, RebaseAction::Squash | RebaseAction::Fixup));
            if let Some(m) = message.filter(|_| wants) {
                if next_joins {
                    return Err(Error::msg(
                        "set the message on the last commit of a squash group",
                    ));
                }
                let file = work.join(format!("msg-{i}"));
                std::fs::write(&file, m)?;
                let quoted = quote_for_shell(&file);
                todo.push_str(&format!(
                    "exec git commit --amend --allow-empty --no-verify --quiet --cleanup=whitespace -F {quoted}\n"
                ));
            }
        }
        let todo_file = work.join("todo");
        std::fs::write(&todo_file, &todo)?;
        let editor = sequence_editor_cmd(&todo_file);
        let out = cli::run_env(
            self.root(),
            &["rebase", "--interactive", "--no-autosquash", base],
            &[("GIT_SEQUENCE_EDITOR", editor.as_str())],
        );
        // Keep plan files while rebase is stopped; clean when finished.
        if self.branch_info()?.operation.is_none() {
            let _ = std::fs::remove_dir_all(&work);
        }
        match out {
            Ok(o) => Ok(o.stdout),
            Err(e) => {
                // Conflicts leave rebase in progress — surface that as success with message.
                if self.branch_info()?.operation.as_deref() == Some("rebase") {
                    Ok(e.to_string())
                } else {
                    Err(e)
                }
            }
        }
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

    /// `git config --get <key>`; `None` when unset.
    pub fn config_get(&self, key: &str) -> Result<Option<String>> {
        let out = cli::run_allow(self.root(), &["config", "--get", key], &[0, 1])?;
        let v = out.stdout.trim();
        Ok(if v.is_empty() { None } else { Some(v.to_string()) })
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
        Ok(self
            .log(&LogQuery {
                limit: 100,
                branch: Some("@{upstream}..HEAD".into()),
                ..Default::default()
            })?
            .commits)
    }
}

/// Parse `%(upstream:track)` like `[ahead 1, behind 2]` / `[ahead 1]` / `[behind 2]`.
fn chrono_now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn uuid_lite() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    std::time::Instant::now().hash(&mut h);
    std::process::id().hash(&mut h);
    format!("{:x}", h.finish())
}

fn quote_for_shell(path: &Path) -> String {
    format!(
        "'{}'",
        path.to_string_lossy()
            .replace('\\', "/")
            .replace('\'', "'\\''")
    )
}

/// Editor command that copies our todo file over git's git-rebase-todo argument.
fn sequence_editor_cmd(todo_file: &Path) -> String {
    #[cfg(windows)]
    {
        let src = todo_file.to_string_lossy().replace('/', "\\");
        format!("cmd //c copy /Y \"{src}\"")
    }
    #[cfg(not(windows))]
    {
        format!("cp {}", quote_for_shell(todo_file))
    }
}

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

/// Expand git `%D` labels into OpenIDEA decoration labels.
fn normalize_decorate_refs(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    for part in raw.split(", ").map(str::trim).filter(|s| !s.is_empty()) {
        if let Some(rest) = part.strip_prefix("HEAD -> ") {
            out.push("HEAD".into());
            let name = rest.trim();
            if !name.is_empty() {
                out.push(name.to_string());
            }
        } else if part == "HEAD" {
            if !out.iter().any(|r| r == "HEAD") {
                out.push("HEAD".into());
            }
        } else {
            out.push(part.to_string());
        }
    }
    out
}

/// Parse `tformat:%H%x00%h%x00%s%x00%an%x00%ae%x00%ct%x00%P%x00%D%x00` records.
fn parse_log_nul(stdout: &str) -> Vec<Commit> {
    let mut commits = Vec::new();
    let fields: Vec<&str> = stdout.split('\0').collect();
    // Trailing NUL yields an empty trailing field; walk in groups of 8.
    let mut i = 0;
    while i + 7 < fields.len() {
        let id = fields[i].trim();
        // Skip padding / empty slots between records.
        if id.is_empty() {
            i += 1;
            continue;
        }
        if id.len() < 7 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
            i += 1;
            continue;
        }
        let short_id = fields[i + 1].to_string();
        let summary = fields[i + 2].to_string();
        let author = fields[i + 3].to_string();
        let email = fields[i + 4].to_string();
        let time = fields[i + 5].trim().parse().unwrap_or(0);
        let parents = fields[i + 6]
            .split_whitespace()
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect();
        // Match OpenIDEA `decorations`: `HEAD` is its own label; `HEAD -> main`
        // becomes ["HEAD", "main"]. Branch/tag names stay as git prints them
        // (`origin/main`, `tag: v1`).
        let refs = normalize_decorate_refs(fields[i + 7]);
        commits.push(Commit {
            id: id.to_string(),
            short_id,
            summary,
            body: String::new(),
            author,
            email,
            time,
            parents,
            refs,
            graph_parents: None,
            graph_dashed: Vec::new(),
        });
        i += 8;
    }
    commits
}

fn query_authors(q: &LogQuery) -> Vec<String> {
    let mut out: Vec<String> = q
        .authors
        .iter()
        .chain(q.author.iter())
        .map(|a| a.trim().to_lowercase())
        .filter(|a| !a.is_empty())
        .collect();
    out.sort();
    out.dedup();
    out
}

fn query_since_ms(q: &LogQuery) -> Option<i64> {
    q.since_ms.or_else(|| q.since.filter(|s| *s > 0).map(|s| s.saturating_mul(1000)))
}

fn query_is_detail_filtered(q: &LogQuery) -> bool {
    !query_authors(q).is_empty()
        || q.grep.as_ref().is_some_and(|g| !g.is_empty())
        || q.path.as_ref().is_some_and(|p| !p.is_empty())
        || query_since_ms(q).is_some_and(|s| s > 0)
        || q.until_ms.is_some_and(|u| u > 0)
}

/// Exact author / date predicates need a fill loop (OpenIDEA `Visibility::shows` walk).
fn query_needs_exact_fill(q: &LogQuery) -> bool {
    (!query_authors(q).is_empty() && q.authors_exact)
        || query_since_ms(q).is_some_and(|s| s > 0)
        || q.until_ms.is_some_and(|u| u > 0)
}

/// OpenIDEA `log_index::normalize_user` — alphanumeric only (case-folded).
fn normalize_user(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// Needle for `git log --author` (ERE). Prefer email; never emit GNU `\<`/`\>`.
fn author_needle_for_git(author: &str) -> String {
    let email = author
        .split('<')
        .nth(1)
        .map(|s| s.trim_end_matches('>').trim())
        .filter(|s| !s.is_empty());
    let raw = email.unwrap_or_else(|| author.split('<').next().unwrap_or(author).trim());
    let mut out = String::with_capacity(raw.len());
    for c in raw.chars() {
        // Escape ERE metacharacters; leave `<>` alone (we strip them above).
        if matches!(
            c,
            '\\' | '.' | '+' | '*' | '?' | '(' | ')' | '[' | ']' | '{' | '}' | '^' | '$' | '|'
        ) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// OpenIDEA `log_index::matches_user` — exact identity match for the User filter.
fn matches_user(query: &str, name: &str, email: &str) -> bool {
    let query_name = query.split('<').next().unwrap_or(query).trim();
    let query_email = query
        .split('<')
        .nth(1)
        .map(|s| s.trim_end_matches('>').trim())
        .unwrap_or(query);
    let target = [
        normalize_user(name),
        normalize_user(email),
        normalize_user(email.split('@').next().unwrap_or(email)),
    ];
    [query_name, query_email, query_email.split('@').next().unwrap_or(query_email)]
        .iter()
        .any(|alias| target.contains(&normalize_user(alias)))
}

fn authors_match(authors: &[String], author: &str, email: &str, exact: bool) -> bool {
    if authors.is_empty() {
        return true;
    }
    let name = author.to_lowercase();
    let email = email.to_lowercase();
    authors.iter().any(|a| {
        if exact {
            matches_user(a, &name, &email)
        } else {
            name.contains(a.as_str()) || email.contains(a.as_str())
        }
    })
}

/// `time_secs` is committer unix seconds (OpenIDEA `commit_time_ms` / 1000).
fn commit_shows_filters(
    author: &str,
    email: &str,
    time_secs: i64,
    summary: &str,
    query: &LogQuery,
) -> bool {
    let time_ms = (time_secs as i128).saturating_mul(1000) as i64;
    if let Some(since) = query_since_ms(query) {
        if time_ms < since {
            return false;
        }
    }
    if let Some(until) = query.until_ms {
        if until > 0 && time_ms >= until {
            return false;
        }
    }
    let authors = query_authors(query);
    if !authors_match(&authors, author, email, query.authors_exact) {
        return false;
    }
    if let Some(g) = query.grep.as_ref().filter(|g| !g.is_empty()) {
        if !summary.to_lowercase().contains(&g.to_lowercase()) {
            return false;
        }
    }
    true
}

fn commit_matches_list_filters(c: &Commit, query: &LogQuery) -> bool {
    commit_shows_filters(&c.author, &c.email, c.time, &c.summary, query)
}

/// OpenIDEA `Visibility` — same predicates for listing and graph projection.
struct Visibility<'a> {
    gix: &'a gix::Repository,
    query: &'a LogQuery,
    /// When set (path filter), a commit shows only if it touches the path set.
    path_ids: Option<std::collections::HashSet<String>>,
    matches: std::collections::HashMap<String, bool>,
    projected: std::collections::HashMap<String, Vec<String>>,
}

impl Visibility<'_> {
    /// OpenIDEA `Visibility::shows`.
    fn shows(&mut self, id: &str) -> bool {
        if let Some(v) = self.matches.get(id) {
            return *v;
        }
        let shown = if self
            .path_ids
            .as_ref()
            .is_some_and(|ids| !ids.contains(id))
        {
            false
        } else {
            (|| -> Result<bool> {
                let oid = gix::ObjectId::from_hex(id.as_bytes())
                    .map_err(|e| Error::msg(format!("bad oid {id}: {e}")))?;
                let commit = self
                    .gix
                    .find_object(oid)
                    .map_err(|e| Error::msg(e.to_string()))?
                    .peel_to_commit()
                    .map_err(|e| Error::msg(e.to_string()))?;
                let author = commit.author().map_err(|e| Error::msg(e.to_string()))?;
                let name = author.name.to_string();
                let email = author.email.to_string();
                // Prefer committer time like OpenIDEA `commit_time_ms`.
                let time = commit
                    .committer()
                    .map(|c| c.seconds())
                    .unwrap_or_else(|_| author.seconds());
                let msg = commit.message_raw().unwrap_or_default().to_string();
                let summary = msg.lines().next().unwrap_or("").to_string();
                Ok(commit_shows_filters(&name, &email, time, &summary, self.query))
            })()
            .unwrap_or(false)
        };
        self.matches.insert(id.to_string(), shown);
        shown
    }

    fn parents_of(&self, id: &str) -> Vec<String> {
        let Ok(oid) = gix::ObjectId::from_hex(id.as_bytes()) else {
            return Vec::new();
        };
        let Ok(obj) = self.gix.find_object(oid) else {
            return Vec::new();
        };
        let Ok(commit) = obj.peel_to_commit() else {
            return Vec::new();
        };
        commit.parent_ids().map(|p| p.to_string()).collect()
    }

    /// OpenIDEA `Visibility::parents` — iterative post-order over hidden chains.
    fn parents(&mut self, parents: &[String]) -> Vec<String> {
        let mut out = Vec::new();
        for parent in parents {
            let mut stack = vec![(parent.clone(), false)];
            while let Some((id, expanded)) = stack.pop() {
                if self.projected.contains_key(&id) {
                    continue;
                }
                if self.shows(&id) {
                    self.projected.insert(id.clone(), vec![id.clone()]);
                } else {
                    let ancestors = self.parents_of(&id);
                    if ancestors.is_empty() {
                        self.projected.insert(id, Vec::new());
                    } else if !expanded {
                        stack.push((id, true));
                        stack.extend(ancestors.into_iter().rev().map(|p| (p, false)));
                    } else {
                        let mut nearest = Vec::new();
                        for p in self.parents_of(&id) {
                            if let Some(list) = self.projected.get(&p) {
                                for a in list {
                                    if !nearest.contains(a) {
                                        nearest.push(a.clone());
                                    }
                                }
                            }
                        }
                        self.projected.insert(id, nearest);
                    }
                }
            }
            if let Some(list) = self.projected.get(parent) {
                for a in list {
                    if !out.contains(a) {
                        out.push(a.clone());
                    }
                }
            }
        }
        out
    }
}

fn path_commit_ids(repo: &Repo, query: &LogQuery) -> Option<std::collections::HashSet<String>> {
    let path = query.path.as_ref().filter(|p| !p.is_empty())?;
    let mut args = vec![
        "rev-list".into(),
        "--date-order".into(),
    ];
    if let Some(branch) = query.branch.as_ref().filter(|b| !b.is_empty() && b.as_str() != "HEAD") {
        args.push(branch.clone());
    } else {
        args.push("HEAD".into());
    }
    args.push("--".into());
    args.push(path.clone());
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = cli::run(repo.root(), &arg_refs).ok()?;
    Some(
        out.stdout
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(str::to_string)
            .collect(),
    )
}

/// OpenIDEA: attach `graph_parents` / `graph_dashed` via `Visibility::parents`.
fn attach_graph_parents(repo: &Repo, commits: &mut [Commit], query: &LogQuery) {
    if commits.is_empty() {
        return;
    }
    if !query_is_detail_filtered(query) {
        for c in commits.iter_mut() {
            c.graph_dashed = vec![false; c.parents.len()];
            c.graph_parents = Some(c.parents.clone());
        }
        return;
    }

    let Ok(gix_repo) = repo.gix() else {
        for c in commits.iter_mut() {
            c.graph_dashed = vec![false; c.parents.len()];
            c.graph_parents = Some(c.parents.clone());
        }
        return;
    };

    let mut visibility = Visibility {
        gix: &gix_repo,
        query,
        path_ids: path_commit_ids(repo, query),
        matches: std::collections::HashMap::new(),
        projected: std::collections::HashMap::new(),
    };

    for c in commits.iter_mut() {
        // Seed: every listed commit matches (same as OpenIDEA materializing a row).
        visibility.matches.insert(c.id.clone(), true);
        let graph_parents = visibility.parents(&c.parents);
        c.graph_dashed = graph_parents
            .iter()
            .map(|gp| !c.parents.contains(gp))
            .collect();
        c.graph_parents = Some(graph_parents);
    }
}

#[cfg(test)]
mod graph_projection_tests {
    use super::*;
    use std::process::Command;

    fn git(dir: &std::path::Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .expect("git");
        assert!(out.status.success(), "{:?}", out);
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn commit(dir: &std::path::Path, file: &str, message: &str) -> String {
        std::fs::write(dir.join(file), message).unwrap();
        git(dir, &["add", file]);
        git(dir, &["commit", "-q", "-m", message]);
        git(dir, &["rev-parse", "HEAD"])
    }

    /// Mirrors OpenIDEA `detail_filters_connect_visible_ancestors_without_changing_revision_parents`.
    #[test]
    fn author_filter_connects_visible_ancestors_with_dashed_edge() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        git(dir, &["init", "-q"]);
        git(dir, &["config", "user.email", "test@example.com"]);
        git(dir, &["config", "user.name", "Test"]);
        let a = commit(dir, "a", "keep root");
        commit(dir, "b", "hidden middle");
        // Amend author to Other so this commit is hidden under the Test filter.
        let status = Command::new("git")
            .args([
                "commit",
                "--amend",
                "--no-edit",
                "--author=Other <other@example.com>",
            ])
            .current_dir(dir)
            .env("GIT_COMMITTER_NAME", "Other")
            .env("GIT_COMMITTER_EMAIL", "other@example.com")
            .status()
            .unwrap();
        assert!(status.success());
        let b = git(dir, &["rev-parse", "HEAD"]);
        let c = commit(dir, "a", "keep tip");

        let repo = Repo::discover(dir).unwrap();
        let page = repo
            .log(&LogQuery {
                limit: 10,
                authors: vec!["Test <test@example.com>".into()],
                authors_exact: true,
                ..Default::default()
            })
            .unwrap();
        let log = page.commits;
        assert_eq!(log[0].id, c);
        assert_eq!(log[0].parents, vec![b.clone()]);
        assert_eq!(log[0].graph_parents.as_ref().unwrap(), &vec![a.clone()]);
        assert_eq!(log[0].graph_dashed, vec![true]);
        assert_eq!(log[1].id, a);
    }

    #[test]
    fn normalize_user_strips_to_alphanumeric() {
        assert_eq!(normalize_user("Alice.Bob <a.b@x.com>"), "alicebobabxcom");
        assert_eq!(normalize_user("Alice.Bob"), "alicebob");
        assert_eq!(normalize_user("a.b@x.com"), "abxcom");
    }
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

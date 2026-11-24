use crate::error::{Error, Result};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::RwLock;

static DEFAULT_GIT: RwLock<Option<PathBuf>> = RwLock::new(None);

pub fn set_git_executable(path: Option<PathBuf>) {
    *DEFAULT_GIT.write().unwrap_or_else(|e| e.into_inner()) = path;
}

pub fn git_executable() -> Result<PathBuf> {
    if let Some(path) = DEFAULT_GIT.read().unwrap_or_else(|e| e.into_inner()).clone() {
        return Ok(path);
    }
    // Prefer git.exe so Windows does not go through git.cmd (which can flash a console).
    which::which("git.exe")
        .or_else(|_| which::which("git"))
        .map_err(|_| Error::GitNotFound)
}

pub struct GitOutput {
    pub stdout: String,
    pub stderr: String,
}

pub fn run(cwd: &Path, args: &[&str]) -> Result<GitOutput> {
    run_stdin(cwd, args, None)
}

pub fn run_stdin(cwd: &Path, args: &[&str], stdin: Option<&str>) -> Result<GitOutput> {
    run_stdin_env(cwd, args, stdin, &[])
}

/// Like `run_stdin`, with extra environment variables (e.g. `GIT_SEQUENCE_EDITOR`).
pub fn run_stdin_env(
    cwd: &Path,
    args: &[&str],
    stdin: Option<&str>,
    envs: &[(&str, &str)],
) -> Result<GitOutput> {
    let git = git_executable()?;
    let mut cmd = Command::new(&git);
    cmd.args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("LC_ALL", "C")
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in envs {
        cmd.env(k, v);
    }

    // Hide the console window that Windows otherwise flashes for child processes.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn()?;
    if let Some(data) = stdin {
        use std::io::Write;
        if let Some(mut pipe) = child.stdin.take() {
            pipe.write_all(data.as_bytes())?;
        }
    }
    let output = child.wait_with_output()?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if !output.status.success() {
        let msg = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        return Err(Error::GitFailed(if msg.is_empty() {
            format!("git {} failed", args.join(" "))
        } else {
            msg
        }));
    }
    Ok(GitOutput { stdout, stderr })
}

pub fn run_env(cwd: &Path, args: &[&str], envs: &[(&str, &str)]) -> Result<GitOutput> {
    run_stdin_env(cwd, args, None, envs)
}

/// Like `run`, but treat listed exit codes as success (e.g. `diff --no-index` → 1).
pub fn run_allow(cwd: &Path, args: &[&str], allow: &[i32]) -> Result<GitOutput> {
    let git = git_executable()?;
    let mut cmd = Command::new(&git);
    cmd.args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd.output()?;
    let code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if output.status.success() || allow.contains(&code) {
        return Ok(GitOutput { stdout, stderr });
    }
    let msg = if stderr.trim().is_empty() {
        stdout.trim().to_string()
    } else {
        stderr.trim().to_string()
    };
    Err(Error::GitFailed(if msg.is_empty() {
        format!("git {} failed", args.join(" "))
    } else {
        msg
    }))
}

pub fn detect_version() -> Result<crate::types::GitVersion> {
    let path = git_executable()?;
    let out = run(Path::new("."), &["--version"])?;
    Ok(crate::types::GitVersion {
        path: path.display().to_string(),
        version: out.stdout.trim().to_string(),
    })
}

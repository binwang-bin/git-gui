//! Git integration for the desktop client.
//!
//! Repository discovery uses **gitoxide (`gix`)**. Status, log, blame and diff prefer
//! git porcelain for reliable cross-platform output; all mutating operations shell out
//! to the system `git` executable so hooks, credentials and signing behave correctly.

mod cli;
mod diff;
mod error;
mod repo;
mod status;
mod types;

pub use cli::{detect_version, set_git_executable};
pub use error::{Error, Result};
pub use repo::{clone, init, Repo};
pub use types::*;

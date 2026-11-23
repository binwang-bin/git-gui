use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Message(String),
    #[error("git executable not found")]
    GitNotFound,
    #[error("not a git repository: {0}")]
    NotARepo(PathBuf),
    #[error("git failed: {0}")]
    GitFailed(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl Error {
    pub fn msg(s: impl Into<String>) -> Self {
        Self::Message(s.into())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

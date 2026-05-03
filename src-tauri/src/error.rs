//! Error types and the IPC error envelope.
//!
//! `ErrorCode` mirrors `sidecar/sidecar/pipeline/models.py::ErrorCode`. When
//! adding a code here, add it there too. C1 from the eng review specifies an
//! integration test should catch type drift between the two sides.
//!
//! `ErrorEnvelope` mirrors the Python `ErrorEnvelope` shape exactly so a
//! sidecar response can be deserialized directly into it (eng A4).

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InvalidUrl,
    DownloadFailed,
    ClipTooLong,
    NoSpeechDetected,
    TranscriptionFailed,
    ScoreFailed,
    SidecarUnreachable,
    DatabaseError,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorEnvelope {
    pub code: ErrorCode,
    pub message: String,
    #[serde(default)]
    pub retryable: bool,
}

impl ErrorEnvelope {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), retryable: false }
    }

    pub fn retryable(code: ErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), retryable: true }
    }
}

#[derive(Debug, Error)]
pub enum Error {
    #[error("sidecar error: {0:?}")]
    Api(ErrorEnvelope),

    #[error("sidecar unreachable: {0}")]
    SidecarUnreachable(String),

    #[error("sidecar response was malformed: {0}")]
    Malformed(String),

    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Other(String),
}

impl Error {
    pub fn malformed(msg: impl Into<String>) -> Self {
        Self::Malformed(msg.into())
    }

    pub fn unreachable(msg: impl Into<String>) -> Self {
        Self::SidecarUnreachable(msg.into())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

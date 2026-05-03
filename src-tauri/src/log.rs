//! tracing-subscriber init. Mirrors `sidecar/sidecar/log.py` in shape — both
//! write to `app_data_dir/logs/` so you can `tail -f` both during debugging.

use std::path::Path;

use tracing_subscriber::{fmt, prelude::*, EnvFilter};

/// Initialize tracing. If `log_dir` is provided, also writes a rotating
/// `nextenglish.rs.log` file there. Idempotent across multiple calls; the
/// global subscriber is only set once.
pub fn init(log_dir: Option<&Path>) -> anyhow::Result<()> {
    let env_filter = EnvFilter::try_from_env("NEXTENGLISH_LOG")
        .unwrap_or_else(|_| EnvFilter::new("info,nextenglish_core=debug"));

    let stderr_layer = fmt::layer().with_target(true).with_writer(std::io::stderr);

    let registry = tracing_subscriber::registry()
        .with(env_filter)
        .with(stderr_layer);

    if let Some(dir) = log_dir {
        std::fs::create_dir_all(dir)?;
        let appender = tracing_appender::rolling::daily(dir, "nextenglish.rs.log");
        let file_layer = fmt::layer()
            .with_ansi(false)
            .with_target(true)
            .with_writer(appender);
        let _ = registry.with(file_layer).try_init();
    } else {
        let _ = registry.try_init();
    }

    Ok(())
}

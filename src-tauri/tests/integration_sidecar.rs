//! T1A integration test (eng review): spawn the sidecar, /health responds,
//! app exit kills sidecar with no zombie. The eng review's iron rule for
//! the A2 sidecar-lifecycle fix.
//!
//! Requires the Python sidecar to be set up: `cd ../sidecar && uv venv && uv pip install -e .[dev]`.
//! Skipped if `uv` isn't on PATH or the sidecar dir isn't found.

use std::path::PathBuf;
use std::time::Duration;

use nextenglish_core::sidecar::{Sidecar, SidecarConfig};

fn sidecar_root() -> Option<PathBuf> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()?
        .join("sidecar");
    if root.is_dir() { Some(root) } else { None }
}

fn venv_ready(root: &PathBuf) -> bool {
    let py = if cfg!(windows) {
        root.join(".venv").join("Scripts").join("python.exe")
    } else {
        root.join(".venv").join("bin").join("python")
    };
    py.is_file()
}

/// Connect-with-timeout: on Windows, connecting to a stale port can take 21s
/// of SYN retry. We need to know within ~1s whether the port is bound.
async fn port_is_bound(port: u16) -> bool {
    matches!(
        tokio::time::timeout(
            Duration::from_secs(1),
            tokio::net::TcpStream::connect(("127.0.0.1", port)),
        )
        .await,
        Ok(Ok(_)),
    )
}

#[tokio::test]
async fn sidecar_starts_health_responds_kill_no_zombie() {
    let Some(root) = sidecar_root() else {
        eprintln!("sidecar/ directory not found; skipping integration test");
        return;
    };
    if !venv_ready(&root) {
        eprintln!("sidecar/.venv not found; run `uv venv && uv pip install -e .[dev]` in sidecar/. Skipping.");
        return;
    }

    let cfg = SidecarConfig::dev_at(root);
    let sidecar = Sidecar::spawn(cfg).await.expect("spawn");

    let port = sidecar.port();
    let pid = sidecar.pid().expect("pid available before kill");
    assert!(port > 0, "expected nonzero port");
    assert!(pid > 0, "expected nonzero pid");

    sidecar.health().await.expect("health check after explicit spawn");

    sidecar.kill().await.expect("kill cleanly");

    // After kill, the port should no longer accept connections. Give the
    // kernel ~200ms to release the listener, then verify with a 1s-timeout
    // connect (Windows SYN retry can otherwise block 21s).
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(
        !port_is_bound(port).await,
        "port {port} is still accepting connections after sidecar kill — zombie process",
    );
}

#[tokio::test]
async fn sidecar_drop_kills_child_via_kill_on_drop() {
    let Some(root) = sidecar_root() else { return };
    if !venv_ready(&root) {
        eprintln!("sidecar/.venv not found; skipping");
        return;
    }

    let cfg = SidecarConfig::dev_at(root);
    let port = {
        let sidecar = Sidecar::spawn(cfg).await.expect("spawn");
        sidecar.health().await.expect("health");
        let p = sidecar.port();
        // Drop without explicit kill(). tokio's kill_on_drop should handle it.
        drop(sidecar);
        p
    };

    // The drop-side TerminateProcess on Windows takes a moment to propagate.
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        !port_is_bound(port).await,
        "port {port} is still bound after Sidecar drop — kill_on_drop did not work",
    );
}

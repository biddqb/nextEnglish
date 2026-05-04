fn main() {
    // On macOS, dev binaries (target/debug/nextenglish) are not packaged
    // into a .app bundle, so they have no Info.plist on disk for the OS to
    // read. Without the NSMicrophoneUsageDescription key, WebKit hides
    // navigator.mediaDevices entirely (returns undefined), which breaks the
    // recording flow. Embedding Info.plist directly into the Mach-O binary's
    // __TEXT,__info_plist section makes macOS read it from the binary, with
    // or without a .app wrapper. Production .app bundles inherit the same
    // Info.plist via the bundle config.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
            .expect("CARGO_MANIFEST_DIR is always set by cargo");
        println!(
            "cargo:rustc-link-arg=-Wl,-sectcreate,__TEXT,__info_plist,{manifest_dir}/Info.plist"
        );
        println!("cargo:rerun-if-changed=Info.plist");
    }
    tauri_build::build()
}

// Hide the console window on Windows release builds. Stay visible in debug
// so log output is readable.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nextenglish_core::log::init(None).expect("log init");
    nextenglish_core::run();
}

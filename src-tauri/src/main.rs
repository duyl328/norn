// Windows release 构建隐藏控制台黑框；dev 保留以便看日志。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    norn_lib::run();
}

fn main() {
    // 注入构建时间(Unix 秒)供「关于」弹窗显示。
    // ponytail: build.rs 被缓存时此值不刷新;发布是干净构建(CI 全新 checkout)故准确,本地增量构建可能偏旧。
    let build_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    println!("cargo:rustc-env=BUILD_TIMESTAMP={build_ts}");

    tauri_build::build()
}

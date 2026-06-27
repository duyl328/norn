mod git;

use encoding_rs::{
    Encoding, BIG5, EUC_JP, EUC_KR, GBK, SHIFT_JIS, UTF_16BE, UTF_16LE, UTF_8, WINDOWS_1252,
};
use notify_debouncer_mini::{
    new_debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
    DebounceEventResult, Debouncer,
};
#[cfg(target_os = "macos")]
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, Theme};
use tauri_plugin_dialog::DialogExt;

use serde::Serialize;
#[cfg(target_os = "macos")]
use std::collections::HashMap;
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const MENU_EVENT: &str = "norn-menu";
const OPEN_FILES_EVENT: &str = "norn-open-files";
const FS_CHANGE_EVENT: &str = "workspace-fs-change";

// 当前打开文件夹的文件系统监听器。切换文件夹时整体替换;drop 旧 debouncer 即停止其监听。
#[derive(Default)]
struct FsWatchState(Mutex<Option<Debouncer<RecommendedWatcher>>>);
struct PendingOpenFilesState(Mutex<Vec<String>>);
const MENU_NEW_FILE: &str = "menu-new-file";
const MENU_OPEN_FILE: &str = "menu-open-file";
const MENU_OPEN_FOLDER: &str = "menu-open-folder";
const MENU_SAVE_FILE: &str = "menu-save-file";
const MENU_SAVE_FILE_AS: &str = "menu-save-file-as";
const MENU_FIND: &str = "menu-find";
const MENU_SHOW_EXPLORER: &str = "menu-show-explorer";
const MENU_TOGGLE_GIT_PANEL: &str = "menu-toggle-git-panel";
const MENU_TOGGLE_TERMINAL: &str = "menu-toggle-terminal";
const MENU_WELCOME: &str = "menu-welcome";
const MENU_DOCUMENTATION: &str = "menu-documentation";
const MENU_KEYBOARD_SHORTCUTS: &str = "menu-keyboard-shortcuts";
const MENU_RELEASE_NOTES: &str = "menu-release-notes";
const MENU_REPORT_ISSUE: &str = "menu-report-issue";
const MENU_VIEW_LOGS: &str = "menu-view-logs";
const MENU_CHECK_FOR_UPDATES: &str = "menu-check-for-updates";
const MENU_COMMUNITY: &str = "menu-community";
const MENU_PRIVACY_STATEMENT: &str = "menu-privacy-statement";
const MENU_ABOUT_NORN: &str = "menu-about-norn";
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TextFile {
    name: String,
    path: String,
    content: String,
    size: u64,
    last_modified: Option<u64>,
    encoding: String,
    encoding_label: String,
    encoding_candidates: Vec<TextEncodingCandidate>,
    has_bom: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TextFileInspection {
    name: String,
    path: String,
    size: u64,
    last_modified: Option<u64>,
    is_binary: bool,
    is_utf8: bool,
    is_text: bool,
    encoding: Option<String>,
    encoding_label: Option<String>,
    encoding_confidence: f32,
    encoding_candidates: Vec<TextEncodingCandidate>,
    has_bom: bool,
    sample: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TextFileRange {
    path: String,
    content: String,
    size: u64,
    requested_offset: u64,
    start_offset: u64,
    end_offset: u64,
    has_more_before: bool,
    has_more_after: bool,
    encoding: String,
    encoding_label: String,
    encoding_candidates: Vec<TextEncodingCandidate>,
    has_bom: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TextEncodingCandidate {
    encoding: String,
    label: String,
    confidence: f32,
    valid: bool,
    recommended: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedTextFile {
    name: String,
    path: String,
    size: u64,
    last_modified: Option<u64>,
    encoding: String,
    encoding_label: String,
    has_bom: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveTextFileError {
    kind: SaveTextFileErrorKind,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
enum SaveTextFileErrorKind {
    Deleted,
    Encoding,
    InvalidPath,
    Io,
    Modified,
    Permission,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryEntry {
    name: String,
    path: String,
    relative_path: String,
    kind: DirectoryEntryKind,
    size: Option<u64>,
    last_modified: Option<u64>,
    is_hidden: bool,
    is_symlink: bool,
    target_kind: Option<DirectoryEntryKind>,
    canonical_path: Option<String>,
    is_readonly: bool,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScratchFolder {
    name: String,
    path: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum DirectoryEntryKind {
    File,
    Directory,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileOperationError {
    kind: FileOperationErrorKind,
    message: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum FileOperationErrorKind {
    Conflict,
    InvalidPath,
    Io,
    NotFound,
    Permission,
    RootOperation,
    WouldNest,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitWorkspaceInspection {
    workspace_path: String,
    git_available: bool,
    git_version: Option<String>,
    is_repository: bool,
    git_root: Option<String>,
    has_dot_git: bool,
    branch: Option<String>,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitCliDetection {
    available: bool,
    version: Option<String>,
    message: String,
}

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
fn debug_log(message: String, payload: serde_json::Value) {
    eprintln!("[norn] {message}: {payload}");
}

#[tauri::command]
fn destroy_current_window(window: tauri::WebviewWindow) -> Result<(), String> {
    let label = window.label().to_string();
    match window.destroy() {
        Ok(()) => {
            eprintln!("[norn] destroyed window: {label}");
            Ok(())
        }
        Err(error) => {
            eprintln!("[norn] failed to destroy window {label}: {error}");
            Err(error.to_string())
        }
    }
}

#[tauri::command]
fn take_initial_open_files(state: tauri::State<'_, PendingOpenFilesState>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

/// 快捷检测:仅运行 `git --version`,不依赖任何打开的文件夹。供设置页「检测 Git」按钮用。
#[tauri::command]
fn detect_git_cli() -> GitCliDetection {
    match Command::new("git").arg("--version").output() {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            GitCliDetection {
                available: true,
                version: (!version.is_empty()).then_some(version),
                message: "Git 命令可用。".to_string(),
            }
        }
        Ok(_) => GitCliDetection {
            available: false,
            version: None,
            message: "Git 命令不可用，请检查安装状态。".to_string(),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => GitCliDetection {
            available: false,
            version: None,
            message: "未检测到 Git 命令，请先安装 Git。".to_string(),
        },
        Err(error) => GitCliDetection {
            available: false,
            version: None,
            message: format!("检测 Git 失败：{error}"),
        },
    }
}

#[tauri::command]
fn inspect_git_workspace(path: String) -> Result<GitWorkspaceInspection, String> {
    let workspace = PathBuf::from(path);
    let metadata = fs::metadata(&workspace).map_err(|error| {
        format_file_error("Unable to read workspace metadata", &workspace, error)
    })?;

    if !metadata.is_dir() {
        return Err(format!("{} is not a directory", workspace.display()));
    }

    let git_version_output = Command::new("git").arg("--version").output();
    let git_version_output = match git_version_output {
        Ok(output) => output,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(GitWorkspaceInspection {
                workspace_path: workspace.to_string_lossy().into_owned(),
                git_available: false,
                git_version: None,
                is_repository: false,
                git_root: None,
                has_dot_git: workspace.join(".git").exists(),
                branch: None,
                message: "未检测到 Git 命令，请先安装 Git。".to_string(),
            });
        }
        Err(error) => {
            return Err(format_file_error(
                "Unable to check git version",
                &workspace,
                error,
            ));
        }
    };

    let git_version = String::from_utf8_lossy(&git_version_output.stdout)
        .trim()
        .to_string();
    let git_version = (!git_version.is_empty()).then_some(git_version);

    if !git_version_output.status.success() {
        return Ok(GitWorkspaceInspection {
            workspace_path: workspace.to_string_lossy().into_owned(),
            git_available: false,
            git_version,
            is_repository: false,
            git_root: None,
            has_dot_git: workspace.join(".git").exists(),
            branch: None,
            message: "Git 命令不可用，请检查安装状态。".to_string(),
        });
    }

    let git_root_output = Command::new("git")
        .args(["-C"])
        .arg(&workspace)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .map_err(|error| {
            format_file_error("Unable to inspect git repository", &workspace, error)
        })?;

    let has_dot_git = workspace.join(".git").exists();

    if !git_root_output.status.success() {
        return Ok(GitWorkspaceInspection {
            workspace_path: workspace.to_string_lossy().into_owned(),
            git_available: true,
            git_version,
            is_repository: false,
            git_root: None,
            has_dot_git,
            branch: None,
            message: "当前文件夹不是 Git 仓库，可创建仓库后再查看变更。".to_string(),
        });
    }

    let git_root = String::from_utf8_lossy(&git_root_output.stdout)
        .trim()
        .to_string();
    let git_root = if git_root.is_empty() {
        None
    } else {
        Some(git_root)
    };

    let branch_output = Command::new("git")
        .args(["-C"])
        .arg(&workspace)
        .args(["branch", "--show-current"])
        .output()
        .map_err(|error| format_file_error("Unable to inspect git branch", &workspace, error))?;
    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();
    let branch = branch_output
        .status
        .success()
        .then_some(branch)
        .filter(|value| !value.is_empty());

    Ok(GitWorkspaceInspection {
        workspace_path: workspace.to_string_lossy().into_owned(),
        git_available: true,
        git_version,
        is_repository: true,
        git_root,
        has_dot_git,
        branch,
        message: "已检测到 Git 仓库。".to_string(),
    })
}

#[tauri::command]
async fn open_file_dialog(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .blocking_pick_file()
        .and_then(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn open_folder_dialog(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn open_save_dialog(app: tauri::AppHandle, default_name: Option<String>) -> Option<String> {
    let dialog = app.dialog().file();
    let dialog = match default_name {
        Some(default_name) => dialog.set_file_name(default_name),
        None => dialog,
    };

    dialog
        .blocking_save_file()
        .and_then(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_text_file(path: String, encoding: Option<String>) -> Result<TextFile, String> {
    let path = PathBuf::from(path);
    let metadata = fs::metadata(&path)
        .map_err(|error| format_file_error("Unable to read file metadata", &path, error))?;

    if !metadata.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }

    let bytes =
        fs::read(&path).map_err(|error| format_file_error("Unable to read file", &path, error))?;

    let decoded = match encoding.as_deref() {
        Some(encoding) => decode_text_bytes_as_encoding(&bytes, encoding),
        None => decode_text_bytes(&bytes),
    }
    .ok_or_else(|| {
        if looks_binary(&bytes) {
            format!("{} appears to be a binary file", path.display())
        } else {
            format!("{} is not a supported text encoding", path.display())
        }
    })?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled")
        .to_string();

    Ok(TextFile {
        name,
        path: path.to_string_lossy().into_owned(),
        content: decoded.content,
        size: metadata.len(),
        last_modified: modified_time_millis(&metadata),
        encoding: decoded.encoding.to_string(),
        encoding_label: decoded.encoding_label.to_string(),
        encoding_candidates: encoding_candidates_for_bytes(&bytes, Some(decoded.encoding)),
        has_bom: decoded.has_bom,
    })
}

#[tauri::command]
fn save_text_file(
    path: String,
    content: String,
    expected_last_modified: Option<u64>,
    force: Option<bool>,
    encoding: Option<String>,
    has_bom: Option<bool>,
) -> Result<SavedTextFile, SaveTextFileError> {
    let path = PathBuf::from(path);
    let metadata = fs::metadata(&path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            return save_error(
                SaveTextFileErrorKind::Deleted,
                format!(
                    "{} no longer exists. Choose a new location to save this file.",
                    path.display()
                ),
            );
        }

        save_error_from_io("Unable to read file metadata before saving", &path, error)
    })?;

    if !metadata.is_file() {
        return Err(save_error(
            SaveTextFileErrorKind::InvalidPath,
            format!("{} is not a writable file", path.display()),
        ));
    }

    if metadata.permissions().readonly() {
        return Err(save_error(
            SaveTextFileErrorKind::Permission,
            format!("{} is read-only and cannot be saved.", path.display()),
        ));
    }

    let should_check_mtime = !force.unwrap_or(false);
    let current_last_modified = modified_time_millis(&metadata);

    if should_check_mtime
        && expected_last_modified.is_some()
        && current_last_modified != expected_last_modified
    {
        return Err(save_error(
            SaveTextFileErrorKind::Modified,
            format!(
                "{} was changed outside Norn. Review the conflict before saving.",
                path.display()
            ),
        ));
    }

    let encoding_name = encoding.as_deref().unwrap_or("utf-8");
    let encoded = encode_text_bytes(&content, encoding_name, has_bom.unwrap_or(false))?;
    atomic_write_text_file(&path, &encoded)?;
    saved_text_file_from_path(&path, encoding_name, has_bom.unwrap_or(false))
}

#[tauri::command]
fn save_text_file_as(
    path: String,
    content: String,
    encoding: Option<String>,
    has_bom: Option<bool>,
) -> Result<SavedTextFile, SaveTextFileError> {
    let path = PathBuf::from(path);

    if path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.trim().is_empty())
        .unwrap_or(true)
    {
        return Err(save_error(
            SaveTextFileErrorKind::InvalidPath,
            "Choose a valid file name before saving.".to_string(),
        ));
    }

    if fs::metadata(&path)
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
    {
        return Err(save_error(
            SaveTextFileErrorKind::InvalidPath,
            format!(
                "{} is a directory. Choose a file path instead.",
                path.display()
            ),
        ));
    }

    let encoding_name = encoding.as_deref().unwrap_or("utf-8");
    let encoded = encode_text_bytes(&content, encoding_name, has_bom.unwrap_or(false))?;
    atomic_write_text_file(&path, &encoded)?;
    saved_text_file_from_path(&path, encoding_name, has_bom.unwrap_or(false))
}

#[tauri::command]
fn inspect_text_file(path: String) -> Result<TextFileInspection, String> {
    const SAMPLE_BYTES: usize = 16 * 1024;

    let path = PathBuf::from(path);
    let metadata = fs::metadata(&path)
        .map_err(|error| format_file_error("Unable to read file metadata", &path, error))?;

    if !metadata.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }

    let mut file = File::open(&path)
        .map_err(|error| format_file_error("Unable to open file", &path, error))?;
    let mut buffer = vec![0; SAMPLE_BYTES.min(metadata.len() as usize)];
    let bytes_read = file
        .read(&mut buffer)
        .map_err(|error| format_file_error("Unable to inspect file", &path, error))?;
    buffer.truncate(bytes_read);

    let decoded = decode_text_bytes(&buffer);
    let is_binary = decoded.is_none() && looks_binary(&buffer);
    let is_utf8 = decoded
        .as_ref()
        .map(|decoded| decoded.encoding == "utf-8" || decoded.encoding == "utf-8-bom")
        .unwrap_or(false);
    let sample = if let Some(decoded) = &decoded {
        decoded.content.clone()
    } else {
        String::new()
    };
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled")
        .to_string();

    Ok(TextFileInspection {
        name,
        path: path.to_string_lossy().into_owned(),
        size: metadata.len(),
        last_modified: modified_time_millis(&metadata),
        is_binary,
        is_utf8,
        is_text: decoded.is_some(),
        encoding: decoded.as_ref().map(|decoded| decoded.encoding.to_string()),
        encoding_label: decoded
            .as_ref()
            .map(|decoded| decoded.encoding_label.to_string()),
        encoding_confidence: decoded
            .as_ref()
            .map(|decoded| decoded.confidence)
            .unwrap_or(0.0),
        encoding_candidates: encoding_candidates_for_bytes(
            &buffer,
            decoded.as_ref().map(|decoded| decoded.encoding),
        ),
        has_bom: decoded
            .as_ref()
            .map(|decoded| decoded.has_bom)
            .unwrap_or(false),
        sample,
    })
}

#[tauri::command]
fn read_text_file_range(
    path: String,
    offset: u64,
    length: u64,
    encoding: Option<String>,
) -> Result<TextFileRange, String> {
    const MAX_RANGE_BYTES: u64 = 1024 * 1024;

    let path = PathBuf::from(path);
    let metadata = fs::metadata(&path)
        .map_err(|error| format_file_error("Unable to read file metadata", &path, error))?;

    if !metadata.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }

    let file_size = metadata.len();
    let requested_offset = offset.min(file_size);
    let read_length = length
        .min(MAX_RANGE_BYTES)
        .min(file_size.saturating_sub(requested_offset));
    let start_offset = align_range_start(&path, requested_offset)?;
    let target_end_offset = requested_offset.saturating_add(read_length).min(file_size);
    let end_offset = align_range_end(&path, target_end_offset, file_size)?;
    let byte_count = end_offset.saturating_sub(start_offset);

    let mut file = File::open(&path)
        .map_err(|error| format_file_error("Unable to open file", &path, error))?;
    file.seek(SeekFrom::Start(start_offset))
        .map_err(|error| format_file_error("Unable to seek file", &path, error))?;

    let mut buffer = vec![0; byte_count as usize];
    file.read_exact(&mut buffer)
        .map_err(|error| format_file_error("Unable to read file range", &path, error))?;

    let decoded = match encoding.as_deref() {
        Some(encoding) => decode_text_bytes_as_encoding(&buffer, encoding),
        None => decode_text_bytes(&buffer),
    }
    .ok_or_else(|| {
        if looks_binary(&buffer) {
            format!("{} appears to be a binary file", path.display())
        } else {
            format!("{} range is not a supported text encoding", path.display())
        }
    })?;

    Ok(TextFileRange {
        path: path.to_string_lossy().into_owned(),
        content: decoded.content,
        size: file_size,
        requested_offset,
        start_offset,
        end_offset,
        has_more_before: start_offset > 0,
        has_more_after: end_offset < file_size,
        encoding: decoded.encoding.to_string(),
        encoding_label: decoded.encoding_label.to_string(),
        encoding_candidates: encoding_candidates_for_bytes(&buffer, Some(decoded.encoding)),
        has_bom: decoded.has_bom,
    })
}

#[tauri::command]
fn watch_directory(
    app: tauri::AppHandle,
    state: tauri::State<'_, FsWatchState>,
    path: String,
) -> Result<(), String> {
    let root = PathBuf::from(&path);

    if !root.is_dir() {
        return Err(format!("{} is not a directory", root.display()));
    }

    let emitter = app.clone();
    // 去抖 400ms:把 git checkout / npm install 这类成千上万次事件合并成几批,
    // 每批只把「受影响条目的父目录」去重后发给前端,由前端按需刷新已加载的那几层。
    let mut debouncer = new_debouncer(
        Duration::from_millis(400),
        move |result: DebounceEventResult| {
            let Ok(events) = result else {
                return;
            };

            let mut dirs: HashSet<String> = HashSet::new();

            for event in events {
                // .git / node_modules 内部 churn 不影响树展示,跳过以免无谓刷新风暴。
                // ponytail: 仅过滤上报,递归监听仍会为这些目录占用 inotify 句柄(见 watch_directory 调用方注释)。
                if event.path.components().any(|component| {
                    matches!(
                        component.as_os_str().to_str(),
                        Some(".git") | Some("node_modules")
                    )
                }) {
                    continue;
                }

                // 新建/删除/重命名都体现在「父目录」的列表里 → 重新 list 父目录即可。
                if let Some(parent) = event.path.parent() {
                    dirs.insert(parent.to_string_lossy().into_owned());
                }
            }

            if !dirs.is_empty() {
                let _ = emitter.emit(FS_CHANGE_EVENT, dirs.into_iter().collect::<Vec<_>>());
            }
        },
    )
    .map_err(|error| format!("Unable to start file watcher: {error}"))?;

    debouncer
        .watcher()
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|error| format!("Unable to watch {}: {error}", root.display()))?;

    *state.0.lock().unwrap() = Some(debouncer);
    Ok(())
}

#[tauri::command]
fn unwatch_directory(state: tauri::State<'_, FsWatchState>) {
    *state.0.lock().unwrap() = None;
}

// 「复制为文件」:把文件引用写入系统剪贴板的原生格式(Windows CF_HDROP / macOS NSPasteboard 文件 URL),
// 使其能粘贴到外部应用(资源管理器/访达等)为真实文件;同时附带文件名纯文本,让文本框粘贴得到文件名。
// 返回 true = 已写入原生文件格式(Windows/macOS);false = 当前平台不支持(Linux),由前端退回只写文件名文本。
#[tauri::command]
fn copy_files_to_clipboard(paths: Vec<String>, text: String) -> Result<bool, String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        use clipboard_rs::{Clipboard, ClipboardContent, ClipboardContext};

        let context = ClipboardContext::new().map_err(|error| error.to_string())?;
        context
            .set(vec![
                ClipboardContent::Files(paths),
                ClipboardContent::Text(text),
            ])
            .map_err(|error| error.to_string())?;
        Ok(true)
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (&paths, &text);
        Ok(false)
    }
}

// 在该路径所在目录打开系统终端(文件 → 其所在目录;目录 → 该目录本身)。
#[tauri::command]
fn open_terminal_at(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let directory = if target.is_dir() {
        target.clone()
    } else {
        target
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| target.clone())
    };

    if !directory.is_dir() {
        return Err(format!("{} is not a directory", directory.display()));
    }

    #[cfg(target_os = "windows")]
    {
        // 优先 Windows Terminal;不可用时回退到 cmd。
        if Command::new("wt.exe")
            .arg("-d")
            .arg(&directory)
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
        Command::new("cmd")
            .args(["/C", "start", "cmd", "/K"])
            .arg(format!("cd /d {}", directory.display()))
            .spawn()
            .map_err(|error| format!("Unable to open terminal: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", "Terminal"])
            .arg(&directory)
            .spawn()
            .map_err(|error| format!("Unable to open Terminal: {error}"))?;
        return Ok(());
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        // Linux:依次尝试常见终端,以目标目录为工作目录启动。
        for terminal in ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"] {
            if Command::new(terminal)
                .current_dir(&directory)
                .spawn()
                .is_ok()
            {
                return Ok(());
            }
        }
        Err("No supported terminal emulator found".to_string())
    }
}

// 在系统文件管理器中显示该路径(文件 → 打开所在目录并选中;目录 → 同样定位)。
#[tauri::command]
fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);

    if !target.exists() {
        return Err(format!("{} does not exist", target.display()));
    }

    #[cfg(target_os = "windows")]
    {
        // explorer /select 即便成功也常返回非 0 退出码,故只 spawn、不校验状态。
        Command::new("explorer")
            .arg(format!("/select,{}", target.display()))
            .spawn()
            .map_err(|error| format!("Unable to open File Explorer: {error}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &target.to_string_lossy()])
            .spawn()
            .map_err(|error| format!("Unable to open Finder: {error}"))?;
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        // 多数 Linux 文件管理器不支持「选中」,退而打开其所在目录(目录本身则直接打开)。
        let directory = if target.is_dir() {
            target.clone()
        } else {
            target
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| target.clone())
        };
        Command::new("xdg-open")
            .arg(&directory)
            .spawn()
            .map_err(|error| format!("Unable to open file manager: {error}"))?;
    }

    Ok(())
}

#[tauri::command]
fn list_directory(path: String) -> Result<Vec<DirectoryEntry>, String> {
    let root = PathBuf::from(path);
    let metadata = fs::metadata(&root)
        .map_err(|error| format_file_error("Unable to read directory metadata", &root, error))?;

    if !metadata.is_dir() {
        return Err(format!("{} is not a directory", root.display()));
    }

    let mut entries = Vec::new();

    for entry in fs::read_dir(&root)
        .map_err(|error| format_file_error("Unable to read directory", &root, error))?
    {
        let entry = entry
            .map_err(|error| format_file_error("Unable to read directory entry", &root, error))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();

        entries.push(directory_entry_from_path(&path, &name));
    }

    entries.sort_by(|left, right| match (&left.kind, &right.kind) {
        (DirectoryEntryKind::Directory, DirectoryEntryKind::File) => std::cmp::Ordering::Less,
        (DirectoryEntryKind::File, DirectoryEntryKind::Directory) => std::cmp::Ordering::Greater,
        _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
    });

    Ok(entries)
}

/// 工作区搜索:遍历规则只靠两个开关——尊重忽略文件(.gitignore/.ignore,无需仓库)+
/// 排除隐藏项(`.` 开头)。不硬编码任何项目目录名,前端把用户设置转成这两个 bool 传进来。
const SEARCH_MAX_FILES: usize = 50_000;
const SEARCH_MAX_HITS: usize = 2_000;
const SEARCH_LINE_MAX_CHARS: usize = 400;

#[derive(Serialize)]
struct SearchHit {
    path: String,
    line: u32,
    text: String,
}

fn build_search_walker(
    root: &Path,
    exclude_hidden: bool,
    respect_ignore_files: bool,
) -> ignore::WalkBuilder {
    let mut builder = ignore::WalkBuilder::new(root);
    builder
        .hidden(exclude_hidden)
        .git_ignore(respect_ignore_files)
        .git_global(respect_ignore_files)
        .git_exclude(respect_ignore_files)
        .ignore(respect_ignore_files)
        .parents(respect_ignore_files)
        .require_git(false)
        .threads(0);
    builder
}

/// 把搜索词编译成正则:字面量先转义,整词裹 `\b`,大小写不敏感时设 case_insensitive。
fn build_search_regex(
    query: &str,
    case_sensitive: bool,
    whole_word: bool,
    is_regex: bool,
) -> Result<regex::Regex, String> {
    let mut pattern = if is_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    if whole_word {
        pattern = format!(r"\b(?:{pattern})\b");
    }
    regex::RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|error| format!("Invalid search pattern: {error}"))
}

/// 文件名搜索:列出工作区内全部文件的绝对路径,前端做模糊过滤。
#[tauri::command]
fn search_file_names(
    root: String,
    exclude_hidden: bool,
    respect_ignore_files: bool,
) -> Result<Vec<String>, String> {
    let root_path = PathBuf::from(&root);
    let mut paths = Vec::new();
    for entry in build_search_walker(&root_path, exclude_hidden, respect_ignore_files)
        .build()
        .flatten()
    {
        if entry.file_type().is_some_and(|kind| kind.is_file()) {
            paths.push(entry.path().to_string_lossy().into_owned());
            if paths.len() >= SEARCH_MAX_FILES {
                break;
            }
        }
    }
    Ok(paths)
}

/// 内容搜索:并行遍历(`threads(0)` = 全部 CPU 核),每个文件复用 decode_text_bytes
/// 跳过二进制并按编码解码,逐行匹配。命中总数封顶后提前退出,结果按 path+line 排序。
#[tauri::command]
fn search_in_files(
    root: String,
    query: String,
    case_sensitive: bool,
    whole_word: bool,
    regex: bool,
    exclude_hidden: bool,
    respect_ignore_files: bool,
) -> Result<Vec<SearchHit>, String> {
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let matcher = build_search_regex(&query, case_sensitive, whole_word, regex)?;
    let root_path = PathBuf::from(&root);
    let hits = Arc::new(Mutex::new(Vec::new()));
    let total = Arc::new(AtomicUsize::new(0));

    build_search_walker(&root_path, exclude_hidden, respect_ignore_files)
        .build_parallel()
        .run(|| {
            let hits = Arc::clone(&hits);
            let total = Arc::clone(&total);
            let matcher = matcher.clone();
            Box::new(move |entry| {
                if total.load(Ordering::Relaxed) >= SEARCH_MAX_HITS {
                    return ignore::WalkState::Quit;
                }
                let Ok(entry) = entry else {
                    return ignore::WalkState::Continue;
                };
                if !entry.file_type().is_some_and(|kind| kind.is_file()) {
                    return ignore::WalkState::Continue;
                }
                let path = entry.path();
                let Ok(bytes) = fs::read(path) else {
                    return ignore::WalkState::Continue;
                };
                // decode_text_bytes 对二进制返回 None,顺带处理多编码。
                let Some(decoded) = decode_text_bytes(&bytes) else {
                    return ignore::WalkState::Continue;
                };

                let mut local = Vec::new();
                for (index, line) in decoded.content.lines().enumerate() {
                    if matcher.is_match(line) {
                        let text: String = line.chars().take(SEARCH_LINE_MAX_CHARS).collect();
                        local.push(SearchHit {
                            path: path.to_string_lossy().into_owned(),
                            line: (index as u32) + 1,
                            text,
                        });
                        if total.fetch_add(1, Ordering::Relaxed) + 1 >= SEARCH_MAX_HITS {
                            break;
                        }
                    }
                }
                if !local.is_empty() {
                    if let Ok(mut guard) = hits.lock() {
                        guard.extend(local);
                    }
                }
                ignore::WalkState::Continue
            })
        });

    let mut results = Arc::try_unwrap(hits)
        .map(|mutex| mutex.into_inner().unwrap_or_default())
        .unwrap_or_default();
    results.sort_by(|left, right| left.path.cmp(&right.path).then(left.line.cmp(&right.line)));
    results.truncate(SEARCH_MAX_HITS);
    Ok(results)
}

#[tauri::command]
fn scratch_folder(app: tauri::AppHandle) -> Result<ScratchFolder, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;
    let path = base_dir.join("Scratch");
    fs::create_dir_all(&path)
        .map_err(|error| format_file_error("Unable to create scratch folder", &path, error))?;

    let default_file_path = path.join("Scratch.md");
    if !default_file_path.try_exists().map_err(|error| {
        format_file_error(
            "Unable to inspect scratch default file",
            &default_file_path,
            error,
        )
    })? {
        fs::write(&default_file_path, "# Scratch\n\n").map_err(|error| {
            format_file_error(
                "Unable to create scratch default file",
                &default_file_path,
                error,
            )
        })?;
    }

    Ok(ScratchFolder {
        name: "Scratch".to_string(),
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn create_file(
    workspace_root: String,
    parent_path: String,
    name: String,
) -> Result<DirectoryEntry, FileOperationError> {
    let parent = writable_directory_in_workspace(&workspace_root, &parent_path)?;
    validate_child_name(&name)?;
    let target = parent.join(&name);
    ensure_absent(&target)?;

    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|error| operation_error_from_io("Unable to create file", &target, error))?;

    Ok(directory_entry_from_path(&target, &name))
}

#[tauri::command]
fn create_directory(
    workspace_root: String,
    parent_path: String,
    name: String,
) -> Result<DirectoryEntry, FileOperationError> {
    let parent = writable_directory_in_workspace(&workspace_root, &parent_path)?;
    validate_child_name(&name)?;
    let target = parent.join(&name);
    ensure_absent(&target)?;

    fs::create_dir(&target)
        .map_err(|error| operation_error_from_io("Unable to create directory", &target, error))?;

    Ok(directory_entry_from_path(&target, &name))
}

#[tauri::command]
fn rename_path(
    workspace_root: String,
    path: String,
    new_name: String,
) -> Result<DirectoryEntry, FileOperationError> {
    let source = writable_path_in_workspace(&workspace_root, &path)?;
    ensure_not_workspace_root(&workspace_root, &source)?;
    validate_child_name(&new_name)?;

    let parent = source.parent().ok_or_else(|| {
        operation_error(
            FileOperationErrorKind::InvalidPath,
            format!("{} does not have a parent directory", source.display()),
        )
    })?;
    let target = parent.join(&new_name);
    ensure_absent(&target)?;

    fs::rename(&source, &target)
        .map_err(|error| operation_error_from_io("Unable to rename path", &source, error))?;

    Ok(directory_entry_from_path(&target, &new_name))
}

#[tauri::command]
fn move_path(
    workspace_root: String,
    source_path: String,
    target_directory: String,
) -> Result<DirectoryEntry, FileOperationError> {
    let source = writable_path_in_workspace(&workspace_root, &source_path)?;
    ensure_not_workspace_root(&workspace_root, &source)?;
    let target_parent = writable_directory_in_workspace(&workspace_root, &target_directory)?;
    ensure_not_descendant_move(&source, &target_parent)?;

    let name = path_file_name(&source)?;
    let target = target_parent.join(&name);
    ensure_absent(&target)?;

    fs::rename(&source, &target)
        .map_err(|error| operation_error_from_io("Unable to move path", &source, error))?;

    Ok(directory_entry_from_path(&target, &name))
}

#[tauri::command]
fn copy_path(
    workspace_root: String,
    source_path: String,
    target_directory: String,
) -> Result<DirectoryEntry, FileOperationError> {
    let source = writable_path_in_workspace(&workspace_root, &source_path)?;
    let target_parent = writable_directory_in_workspace(&workspace_root, &target_directory)?;
    let name = path_file_name(&source)?;
    let target = target_parent.join(&name);
    ensure_absent(&target)?;

    copy_path_recursive(&source, &target)?;

    Ok(directory_entry_from_path(&target, &name))
}

#[tauri::command]
fn copy_external_paths(
    workspace_root: String,
    source_paths: Vec<String>,
    target_directory: String,
) -> Result<Vec<DirectoryEntry>, FileOperationError> {
    let target_parent = writable_directory_in_workspace(&workspace_root, &target_directory)?;
    let mut copied_entries = Vec::new();

    for source_path in source_paths {
        let source = PathBuf::from(source_path);
        if !source.exists() {
            return Err(operation_error(
                FileOperationErrorKind::NotFound,
                format!("{} does not exist", source.display()),
            ));
        }

        let name = path_file_name(&source)?;
        let target = target_parent.join(&name);
        ensure_absent(&target)?;
        copy_path_recursive(&source, &target)?;
        copied_entries.push(directory_entry_from_path(&target, &name));
    }

    Ok(copied_entries)
}

#[tauri::command]
fn trash_path(workspace_root: String, path: String) -> Result<(), FileOperationError> {
    let target = writable_path_in_workspace(&workspace_root, &path)?;
    ensure_not_workspace_root(&workspace_root, &target)?;

    trash::delete(&target).map_err(|error| {
        operation_error(
            FileOperationErrorKind::Io,
            format!("Unable to move {} to Trash: {error}", target.display()),
        )
    })
}

fn directory_entry_from_path(path: &Path, name: &str) -> DirectoryEntry {
    let symlink_metadata = fs::symlink_metadata(path);
    let target_metadata = fs::metadata(path);
    let is_symlink = symlink_metadata
        .as_ref()
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false);
    let metadata = target_metadata
        .as_ref()
        .ok()
        .or(symlink_metadata.as_ref().ok());
    let kind = target_metadata
        .as_ref()
        .map(|metadata| {
            if metadata.is_dir() {
                DirectoryEntryKind::Directory
            } else {
                DirectoryEntryKind::File
            }
        })
        .unwrap_or(DirectoryEntryKind::File);
    let target_kind = if is_symlink {
        target_metadata.as_ref().ok().map(|metadata| {
            if metadata.is_dir() {
                DirectoryEntryKind::Directory
            } else {
                DirectoryEntryKind::File
            }
        })
    } else {
        None
    };
    let error = target_metadata
        .as_ref()
        .err()
        .map(|error| format!("Unable to read metadata: {error}"));

    DirectoryEntry {
        relative_path: name.to_string(),
        name: name.to_string(),
        path: path.to_string_lossy().into_owned(),
        kind,
        size: metadata.and_then(|metadata| metadata.is_file().then_some(metadata.len())),
        last_modified: metadata.and_then(modified_time_millis),
        is_hidden: is_hidden_path(path, name),
        is_symlink,
        target_kind,
        canonical_path: fs::canonicalize(path)
            .ok()
            .map(|path| path.to_string_lossy().into_owned()),
        is_readonly: metadata
            .map(|metadata| metadata.permissions().readonly())
            .unwrap_or(false),
        error,
    }
}

fn is_hidden_path(_path: &Path, name: &str) -> bool {
    name.starts_with('.')
}

fn writable_directory_in_workspace(
    workspace_root: &str,
    path: &str,
) -> Result<PathBuf, FileOperationError> {
    let target = writable_path_in_workspace(workspace_root, path)?;
    let metadata = fs::metadata(&target).map_err(|error| {
        operation_error_from_io("Unable to read directory metadata", &target, error)
    })?;

    if !metadata.is_dir() {
        return Err(operation_error(
            FileOperationErrorKind::InvalidPath,
            format!("{} is not a directory", target.display()),
        ));
    }

    Ok(target)
}

fn writable_path_in_workspace(
    workspace_root: &str,
    path: &str,
) -> Result<PathBuf, FileOperationError> {
    let root = canonicalize_path(Path::new(workspace_root), "Unable to read workspace root")?;
    let raw_target = PathBuf::from(path);
    let target = canonicalize_path(&raw_target, "Unable to read path")?;

    if !target.starts_with(&root) {
        return Err(operation_error(
            FileOperationErrorKind::InvalidPath,
            format!("{} is outside the active workspace", target.display()),
        ));
    }

    Ok(raw_target)
}

fn ensure_not_workspace_root(workspace_root: &str, path: &Path) -> Result<(), FileOperationError> {
    let root = canonicalize_path(Path::new(workspace_root), "Unable to read workspace root")?;
    let target = canonicalize_path(path, "Unable to read path")?;

    if target == root {
        return Err(operation_error(
            FileOperationErrorKind::RootOperation,
            "The workspace root cannot be renamed, moved, or deleted.".to_string(),
        ));
    }

    Ok(())
}

fn validate_child_name(name: &str) -> Result<(), FileOperationError> {
    let trimmed = name.trim();

    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
    {
        return Err(operation_error(
            FileOperationErrorKind::InvalidPath,
            "Enter a valid name without path separators.".to_string(),
        ));
    }

    Ok(())
}

fn ensure_absent(path: &Path) -> Result<(), FileOperationError> {
    if path
        .try_exists()
        .map_err(|error| operation_error_from_io("Unable to check destination path", path, error))?
    {
        return Err(operation_error(
            FileOperationErrorKind::Conflict,
            format!("{} already exists", path.display()),
        ));
    }

    Ok(())
}

fn ensure_not_descendant_move(
    source: &Path,
    target_parent: &Path,
) -> Result<(), FileOperationError> {
    let source_metadata = fs::metadata(source).map_err(|error| {
        operation_error_from_io("Unable to read source metadata", source, error)
    })?;

    if !source_metadata.is_dir() {
        return Ok(());
    }

    let source = canonicalize_path(source, "Unable to read source path")?;
    let target_parent = canonicalize_path(target_parent, "Unable to read target directory")?;

    if target_parent == source || target_parent.starts_with(&source) {
        return Err(operation_error(
            FileOperationErrorKind::WouldNest,
            "A directory cannot be moved into itself or one of its descendants.".to_string(),
        ));
    }

    Ok(())
}

fn copy_path_recursive(source: &Path, target: &Path) -> Result<(), FileOperationError> {
    let metadata = fs::metadata(source).map_err(|error| {
        operation_error_from_io("Unable to read source metadata", source, error)
    })?;

    if metadata.is_dir() {
        fs::create_dir(target).map_err(|error| {
            operation_error_from_io("Unable to create destination directory", target, error)
        })?;

        for entry in fs::read_dir(source).map_err(|error| {
            operation_error_from_io("Unable to read source directory", source, error)
        })? {
            let entry = entry.map_err(|error| {
                operation_error_from_io("Unable to read source directory entry", source, error)
            })?;
            let child_source = entry.path();
            let child_target = target.join(entry.file_name());
            copy_path_recursive(&child_source, &child_target)?;
        }

        return Ok(());
    }

    fs::copy(source, target)
        .map_err(|error| operation_error_from_io("Unable to copy file", source, error))?;
    Ok(())
}

fn canonicalize_path(path: &Path, context: &str) -> Result<PathBuf, FileOperationError> {
    fs::canonicalize(path).map_err(|error| operation_error_from_io(context, path, error))
}

fn path_file_name(path: &Path) -> Result<String, FileOperationError> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .ok_or_else(|| {
            operation_error(
                FileOperationErrorKind::InvalidPath,
                format!("{} does not have a valid file name", path.display()),
            )
        })
}

fn operation_error(kind: FileOperationErrorKind, message: String) -> FileOperationError {
    FileOperationError { kind, message }
}

fn operation_error_from_io(
    context: &str,
    path: &Path,
    error: std::io::Error,
) -> FileOperationError {
    let kind = match error.kind() {
        std::io::ErrorKind::AlreadyExists => FileOperationErrorKind::Conflict,
        std::io::ErrorKind::NotFound => FileOperationErrorKind::NotFound,
        std::io::ErrorKind::PermissionDenied => FileOperationErrorKind::Permission,
        _ => FileOperationErrorKind::Io,
    };

    operation_error(kind, format_file_error(context, path, error))
}

fn align_range_start(path: &Path, offset: u64) -> Result<u64, String> {
    const MAX_ALIGNMENT_SCAN_BYTES: u64 = 64 * 1024;

    if offset == 0 {
        return Ok(0);
    }

    let mut file =
        File::open(path).map_err(|error| format_file_error("Unable to open file", path, error))?;
    let mut position = offset;
    let stop_at = offset.saturating_sub(MAX_ALIGNMENT_SCAN_BYTES);
    let mut byte = [0; 1];

    while position > stop_at {
        position -= 1;
        file.seek(SeekFrom::Start(position))
            .map_err(|error| format_file_error("Unable to seek file", path, error))?;
        file.read_exact(&mut byte)
            .map_err(|error| format_file_error("Unable to align file range", path, error))?;

        if byte[0] == b'\n' {
            return Ok(position + 1);
        }
    }

    Ok(position)
}

fn align_range_end(path: &Path, offset: u64, file_size: u64) -> Result<u64, String> {
    const MAX_ALIGNMENT_SCAN_BYTES: u64 = 64 * 1024;

    if offset >= file_size {
        return Ok(file_size);
    }

    let mut file =
        File::open(path).map_err(|error| format_file_error("Unable to open file", path, error))?;
    let mut position = offset;
    let stop_at = offset
        .saturating_add(MAX_ALIGNMENT_SCAN_BYTES)
        .min(file_size);
    let mut byte = [0; 1];

    while position < stop_at {
        file.seek(SeekFrom::Start(position))
            .map_err(|error| format_file_error("Unable to seek file", path, error))?;
        file.read_exact(&mut byte)
            .map_err(|error| format_file_error("Unable to align file range", path, error))?;
        position += 1;

        if byte[0] == b'\n' {
            return Ok(position);
        }
    }

    Ok(position)
}

fn modified_time_millis(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| duration.as_millis().try_into().ok())
}

struct DecodedText {
    content: String,
    encoding: &'static str,
    encoding_label: &'static str,
    confidence: f32,
    has_bom: bool,
}

fn decode_text_bytes(bytes: &[u8]) -> Option<DecodedText> {
    if bytes.starts_with(b"\xEF\xBB\xBF") {
        let content = std::str::from_utf8(&bytes[3..]).ok()?.to_string();
        return Some(DecodedText {
            content,
            encoding: "utf-8-bom",
            encoding_label: "UTF-8 with BOM",
            confidence: 1.0,
            has_bom: true,
        });
    }

    if bytes.starts_with(b"\xFF\xFE") {
        let content = decode_with_encoding(UTF_16LE, &bytes[2..])?;
        return Some(DecodedText {
            content,
            encoding: "utf-16le",
            encoding_label: "UTF-16 LE",
            confidence: 1.0,
            has_bom: true,
        });
    }

    if bytes.starts_with(b"\xFE\xFF") {
        let content = decode_with_encoding(UTF_16BE, &bytes[2..])?;
        return Some(DecodedText {
            content,
            encoding: "utf-16be",
            encoding_label: "UTF-16 BE",
            confidence: 1.0,
            has_bom: true,
        });
    }

    if looks_binary(bytes) {
        return None;
    }

    if let Ok(content) = std::str::from_utf8(bytes) {
        return Some(DecodedText {
            content: content.to_string(),
            encoding: "utf-8",
            encoding_label: "UTF-8",
            confidence: 0.98,
            has_bom: false,
        });
    }

    let mut best: Option<(DecodedText, f32)> = None;

    for (encoding, name, label, confidence) in [
        (GBK, "gb18030", "GB18030 / GBK", 0.78),
        (BIG5, "big5", "Big5", 0.72),
        (SHIFT_JIS, "shift_jis", "Shift_JIS", 0.72),
        (EUC_JP, "euc-jp", "EUC-JP", 0.7),
        (EUC_KR, "euc-kr", "EUC-KR", 0.7),
        (WINDOWS_1252, "windows-1252", "Windows-1252", 0.62),
    ] {
        if let Some(content) = decode_with_encoding(encoding, bytes) {
            let score = decoding_candidate_score(&content, name, confidence);
            let candidate = DecodedText {
                content,
                encoding: name,
                encoding_label: label,
                confidence: score.clamp(0.01, 1.0),
                has_bom: false,
            };

            if best
                .as_ref()
                .map(|(_, best_score)| score > *best_score)
                .unwrap_or(true)
            {
                best = Some((candidate, score));
            }
        }
    }

    best.and_then(|(candidate, score)| (score >= 0.55).then_some(candidate))
}

fn decode_text_bytes_as_encoding(bytes: &[u8], encoding_name: &str) -> Option<DecodedText> {
    let normalized = normalize_encoding_name(encoding_name);
    let normalized = encoding_static_name(normalized);
    let (content, has_bom) = match normalized {
        "utf-8-bom" => {
            let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
            (std::str::from_utf8(bytes).ok()?.to_string(), true)
        }
        "utf-8" => {
            let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
            (std::str::from_utf8(bytes).ok()?.to_string(), false)
        }
        "utf-16le" => {
            let has_bom = bytes.starts_with(b"\xFF\xFE");
            let bytes = bytes.strip_prefix(b"\xFF\xFE").unwrap_or(bytes);
            (decode_with_encoding(UTF_16LE, bytes)?, has_bom)
        }
        "utf-16be" => {
            let has_bom = bytes.starts_with(b"\xFE\xFF");
            let bytes = bytes.strip_prefix(b"\xFE\xFF").unwrap_or(bytes);
            (decode_with_encoding(UTF_16BE, bytes)?, has_bom)
        }
        _ => {
            let encoding = encoding_for_name(normalized)?;
            (decode_with_encoding(encoding, bytes)?, false)
        }
    };

    Some(DecodedText {
        content,
        encoding: normalized,
        encoding_label: encoding_label_for_name(normalized),
        confidence: 1.0,
        has_bom: has_bom || normalized == "utf-8-bom",
    })
}

fn decode_with_encoding(encoding: &'static Encoding, bytes: &[u8]) -> Option<String> {
    encoding
        .decode_without_bom_handling_and_without_replacement(bytes)
        .map(|content| content.into_owned())
}

fn encoding_candidates_for_bytes(
    bytes: &[u8],
    recommended_encoding: Option<&str>,
) -> Vec<TextEncodingCandidate> {
    let mut candidates = Vec::new();
    let recommended = recommended_encoding.map(encoding_static_name);

    for (encoding, name, label, base_confidence) in [
        (UTF_8, "utf-8", "UTF-8", 0.98),
        (UTF_16LE, "utf-16le", "UTF-16 LE", 0.82),
        (UTF_16BE, "utf-16be", "UTF-16 BE", 0.82),
        (GBK, "gb18030", "GB18030 / GBK", 0.78),
        (BIG5, "big5", "Big5", 0.72),
        (SHIFT_JIS, "shift_jis", "Shift_JIS", 0.72),
        (EUC_JP, "euc-jp", "EUC-JP", 0.7),
        (EUC_KR, "euc-kr", "EUC-KR", 0.7),
        (WINDOWS_1252, "windows-1252", "Windows-1252", 0.62),
    ] {
        let valid = match name {
            "utf-16le" => bytes.starts_with(b"\xFF\xFE"),
            "utf-16be" => bytes.starts_with(b"\xFE\xFF"),
            _ => decode_with_encoding(encoding, bytes).is_some(),
        };
        let confidence = if valid {
            if let Some(content) = decode_with_encoding(encoding, bytes) {
                decoding_candidate_score(&content, name, base_confidence).clamp(0.01, 1.0)
            } else {
                base_confidence
            }
        } else {
            0.0
        };

        candidates.push(TextEncodingCandidate {
            encoding: name.to_string(),
            label: label.to_string(),
            confidence,
            valid,
            recommended: recommended == Some(name),
        });
    }

    candidates.sort_by(|left, right| {
        right
            .valid
            .cmp(&left.valid)
            .then_with(|| right.confidence.total_cmp(&left.confidence))
            .then_with(|| left.label.cmp(&right.label))
    });

    candidates
}

fn encode_text_bytes(
    content: &str,
    encoding_name: &str,
    has_bom: bool,
) -> Result<Vec<u8>, SaveTextFileError> {
    let normalized = normalize_encoding_name(encoding_name);

    if normalized == "utf-16le" {
        let mut bytes = Vec::with_capacity(content.len() * 2 + if has_bom { 2 } else { 0 });
        if has_bom {
            bytes.extend_from_slice(b"\xFF\xFE");
        }
        for unit in content.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        return Ok(bytes);
    }

    if normalized == "utf-16be" {
        let mut bytes = Vec::with_capacity(content.len() * 2 + if has_bom { 2 } else { 0 });
        if has_bom {
            bytes.extend_from_slice(b"\xFE\xFF");
        }
        for unit in content.encode_utf16() {
            bytes.extend_from_slice(&unit.to_be_bytes());
        }
        return Ok(bytes);
    }

    let encoding = encoding_for_name(normalized).ok_or_else(|| {
        save_error(
            SaveTextFileErrorKind::Encoding,
            format!("Unsupported text encoding: {encoding_name}"),
        )
    })?;
    let (encoded, _, had_errors) = encoding.encode(content);

    if had_errors {
        return Err(save_error(
            SaveTextFileErrorKind::Encoding,
            format!(
                "This file contains characters that cannot be saved as {}. Convert it to UTF-8 before saving.",
                encoding_label_for_name(normalized)
            ),
        ));
    }

    let mut bytes = Vec::new();
    if has_bom && (normalized == "utf-8" || normalized == "utf-8-bom") {
        bytes.extend_from_slice(b"\xEF\xBB\xBF");
    }
    bytes.extend_from_slice(encoded.as_ref());
    Ok(bytes)
}

fn normalize_encoding_name(name: &str) -> &str {
    match name.trim().to_ascii_lowercase().as_str() {
        "utf-8-bom" | "utf8-bom" => "utf-8-bom",
        "utf8" | "utf-8" => "utf-8",
        "utf-16le" | "utf-16-le" => "utf-16le",
        "utf-16be" | "utf-16-be" => "utf-16be",
        "gbk" | "gb18030" | "gb2312" => "gb18030",
        "big5" => "big5",
        "shift_jis" | "shift-jis" | "sjis" => "shift_jis",
        "euc-jp" | "euc_jp" => "euc-jp",
        "euc-kr" | "euc_kr" => "euc-kr",
        "windows-1252" | "cp1252" | "iso-8859-1" | "latin1" | "latin-1" => "windows-1252",
        _ => "utf-8",
    }
}

fn encoding_for_name(name: &str) -> Option<&'static Encoding> {
    match name {
        "utf-8" | "utf-8-bom" => Some(UTF_8),
        "gb18030" => Some(GBK),
        "big5" => Some(BIG5),
        "shift_jis" => Some(SHIFT_JIS),
        "euc-jp" => Some(EUC_JP),
        "euc-kr" => Some(EUC_KR),
        "windows-1252" => Some(WINDOWS_1252),
        _ => Encoding::for_label(name.as_bytes()),
    }
}

fn encoding_label_for_name(name: &str) -> &'static str {
    match name {
        "utf-8-bom" => "UTF-8 with BOM",
        "utf-8" => "UTF-8",
        "utf-16le" => "UTF-16 LE",
        "utf-16be" => "UTF-16 BE",
        "gb18030" => "GB18030 / GBK",
        "big5" => "Big5",
        "shift_jis" => "Shift_JIS",
        "euc-jp" => "EUC-JP",
        "euc-kr" => "EUC-KR",
        "windows-1252" => "Windows-1252",
        _ => "UTF-8",
    }
}

fn encoding_static_name(name: &str) -> &'static str {
    match name {
        "utf-8-bom" => "utf-8-bom",
        "utf-8" => "utf-8",
        "utf-16le" => "utf-16le",
        "utf-16be" => "utf-16be",
        "gb18030" => "gb18030",
        "big5" => "big5",
        "shift_jis" => "shift_jis",
        "euc-jp" => "euc-jp",
        "euc-kr" => "euc-kr",
        "windows-1252" => "windows-1252",
        _ => "utf-8",
    }
}

fn decoding_candidate_score(content: &str, encoding_name: &str, confidence: f32) -> f32 {
    let mut total = 0usize;
    let mut control = 0usize;
    let mut cjk = 0usize;
    let mut kana = 0usize;
    let mut hangul = 0usize;
    let mut latin = 0usize;

    for character in content.chars() {
        if character.is_whitespace() {
            continue;
        }

        total += 1;

        if character.is_control() {
            control += 1;
        }

        let code = character as u32;
        if (0x4E00..=0x9FFF).contains(&code)
            || (0x3400..=0x4DBF).contains(&code)
            || (0xF900..=0xFAFF).contains(&code)
        {
            cjk += 1;
        } else if (0x3040..=0x30FF).contains(&code) {
            kana += 1;
        } else if (0xAC00..=0xD7AF).contains(&code) {
            hangul += 1;
        } else if character.is_ascii_alphanumeric() || (0x00C0..=0x024F).contains(&code) {
            latin += 1;
        }
    }

    if total == 0 {
        return confidence;
    }

    let total = total as f32;
    let control_ratio = control as f32 / total;
    let script_ratio = match encoding_name {
        "gb18030" | "big5" => cjk as f32 / total,
        "shift_jis" | "euc-jp" => (kana + cjk) as f32 / total,
        "euc-kr" => hangul as f32 / total,
        "windows-1252" => latin as f32 / total,
        _ => 0.0,
    };

    confidence - (control_ratio * 0.7) + script_ratio.min(0.55) * 0.35
}

fn looks_binary(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }

    let sample_len = bytes.len().min(4096);
    let sample = &bytes[..sample_len];
    let control_bytes = sample
        .iter()
        .filter(|byte| matches!(**byte, 0x00..=0x08 | 0x0B | 0x0C | 0x0E..=0x1F))
        .count();

    control_bytes > 0 && control_bytes * 100 / sample_len > 10
}

fn saved_text_file_from_path(
    path: &Path,
    encoding_name: &str,
    has_bom: bool,
) -> Result<SavedTextFile, SaveTextFileError> {
    let metadata = fs::metadata(path)
        .map_err(|error| save_error_from_io("Unable to read saved file metadata", path, error))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled")
        .to_string();
    let normalized = normalize_encoding_name(encoding_name);

    Ok(SavedTextFile {
        name,
        path: path.to_string_lossy().into_owned(),
        size: metadata.len(),
        last_modified: modified_time_millis(&metadata),
        encoding: normalized.to_string(),
        encoding_label: encoding_label_for_name(normalized).to_string(),
        has_bom,
    })
}

fn atomic_write_text_file(path: &Path, bytes: &[u8]) -> Result<(), SaveTextFileError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));

    if !parent.exists() {
        return Err(save_error(
            SaveTextFileErrorKind::InvalidPath,
            format!("The folder {} does not exist.", parent.display()),
        ));
    }

    if !parent.is_dir() {
        return Err(save_error(
            SaveTextFileErrorKind::InvalidPath,
            format!("{} is not a folder.", parent.display()),
        ));
    }

    let existing_permissions = match fs::metadata(path) {
        Ok(metadata) => {
            if metadata.permissions().readonly() {
                return Err(save_error(
                    SaveTextFileErrorKind::Permission,
                    format!("{} is read-only and cannot be saved.", path.display()),
                ));
            }

            Some(metadata.permissions())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(save_error_from_io(
                "Unable to read existing file metadata",
                path,
                error,
            ))
        }
    };

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            save_error(
                SaveTextFileErrorKind::InvalidPath,
                "Choose a valid file name before saving.".to_string(),
            )
        })?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let mut last_create_error = None;

    for attempt in 0..10 {
        let temp_path = parent.join(format!(
            ".{}.norn-save-{}-{}-{}.tmp",
            file_name,
            std::process::id(),
            timestamp,
            attempt
        ));

        let mut file = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                last_create_error = Some(error);
                continue;
            }
            Err(error) => {
                return Err(save_error_from_io(
                    "Unable to create temporary save file",
                    &temp_path,
                    error,
                ))
            }
        };

        if let Err(error) = file.write_all(bytes) {
            let _ = fs::remove_file(&temp_path);
            return Err(save_error_from_io(
                "Unable to write temporary save file",
                &temp_path,
                error,
            ));
        }

        if let Err(error) = file.sync_all() {
            let _ = fs::remove_file(&temp_path);
            return Err(save_error_from_io(
                "Unable to flush temporary save file",
                &temp_path,
                error,
            ));
        }

        drop(file);

        if let Some(permissions) = existing_permissions.clone() {
            if let Err(error) = fs::set_permissions(&temp_path, permissions) {
                let _ = fs::remove_file(&temp_path);
                return Err(save_error_from_io(
                    "Unable to preserve file permissions while saving",
                    &temp_path,
                    error,
                ));
            }
        }

        if let Err(error) = fs::rename(&temp_path, path) {
            let _ = fs::remove_file(&temp_path);
            return Err(save_error_from_io(
                "Unable to replace file while saving",
                path,
                error,
            ));
        }

        return Ok(());
    }

    Err(save_error_from_io(
        "Unable to create a unique temporary save file",
        parent,
        last_create_error
            .unwrap_or_else(|| std::io::Error::from(std::io::ErrorKind::AlreadyExists)),
    ))
}

fn save_error(kind: SaveTextFileErrorKind, message: String) -> SaveTextFileError {
    SaveTextFileError { kind, message }
}

fn save_error_from_io(context: &str, path: &Path, error: std::io::Error) -> SaveTextFileError {
    let kind = match error.kind() {
        std::io::ErrorKind::NotFound => SaveTextFileErrorKind::Deleted,
        std::io::ErrorKind::PermissionDenied => SaveTextFileErrorKind::Permission,
        _ => SaveTextFileErrorKind::Io,
    };

    save_error(kind, format_file_error(context, path, error))
}

fn format_file_error(context: &str, path: &Path, error: std::io::Error) -> String {
    format!("{} for {}: {}", context, path.display(), error)
}

// ---------------------------------------------------------------------------
// keybindings.json:前端自定义快捷键的单一存储,放 appConfigDir。
// JS 通过 read/write 命令读写;mac 原生菜单加速键也从这里取,使两者一致。
// ---------------------------------------------------------------------------
fn keybindings_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Unable to resolve app config directory: {error}"))?;
    Ok(dir.join("keybindings.json"))
}

#[tauri::command]
fn read_keybindings(app: tauri::AppHandle) -> Result<String, String> {
    let path = keybindings_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(contents),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok("{}".to_string()),
        Err(error) => Err(format!("Unable to read keybindings: {error}")),
    }
}

#[tauri::command]
fn write_keybindings(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    let path = keybindings_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create config directory: {error}"))?;
    }
    fs::write(&path, contents).map_err(|error| format!("Unable to write keybindings: {error}"))?;
    Ok(())
}

// 通用应用配置文件读写(appConfigDir 下的命名 JSON,如 settings.json)。
// name 必须是单纯文件名:禁止分隔符与 ..,防止路径穿越。
fn app_config_file_path<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    name: &str,
) -> Result<PathBuf, String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.contains('\0')
    {
        return Err(format!("Invalid config file name: {name}"));
    }
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Unable to resolve app config directory: {error}"))?;
    Ok(dir.join(name))
}

#[tauri::command]
fn read_config_file(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let path = app_config_file_path(&app, &name)?;
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Unable to read {name}: {error}")),
    }
}

#[tauri::command]
fn write_config_file(app: tauri::AppHandle, name: String, contents: String) -> Result<(), String> {
    let path = app_config_file_path(&app, &name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create config directory: {error}"))?;
    }
    fs::write(&path, contents).map_err(|error| format!("Unable to write {name}: {error}"))?;
    Ok(())
}

/// 由前端主题设置驱动原生窗口外观:"light"/"dark" 固定,其它(system/null)跟随系统。
/// 不固定窗口主题时,webview 的 prefers-color-scheme 才会反映真实系统明暗。
#[tauri::command]
fn set_window_theme(app: tauri::AppHandle, theme: Option<String>) -> Result<(), String> {
    let resolved = match theme.as_deref() {
        Some("light") => Some(Theme::Light),
        Some("dark") => Some(Theme::Dark),
        _ => None,
    };
    app.set_theme(resolved);
    if let Some(window) = app.get_webview_window("main") {
        window.set_theme(resolved).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// 返回 appConfigDir 绝对路径,给设置页「显示配置位置」用。
#[tauri::command]
fn app_config_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.to_string_lossy().into_owned())
        .map_err(|error| format!("Unable to resolve app config directory: {error}"))
}

/// 读 keybindings.json 为 actionId → 键位串数组。任何错误都退化为空表(用默认加速键)。
#[cfg(target_os = "macos")]
fn read_keybindings_map<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> HashMap<String, Vec<String>> {
    let Ok(path) = keybindings_path(app) else {
        return HashMap::new();
    };
    let Ok(contents) = fs::read_to_string(&path) else {
        return HashMap::new();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

/// 前端键位串("Mod+Shift+S")→ Tauri 加速键串("CmdOrCtrl+Shift+S")。
#[cfg(target_os = "macos")]
fn spec_to_accelerator(spec: &str) -> String {
    spec.split('+')
        .map(|part| match part {
            "Mod" => "CmdOrCtrl".to_string(),
            "Meta" | "Cmd" | "Command" => "Cmd".to_string(),
            "Ctrl" | "Control" => "Ctrl".to_string(),
            "Alt" | "Option" => "Alt".to_string(),
            "Shift" => "Shift".to_string(),
            other if other.chars().count() == 1 => other.to_uppercase(),
            other => other.to_string(),
        })
        .collect::<Vec<_>>()
        .join("+")
}

/// 某菜单动作的加速键:用户自定义的第一个键位,否则回退默认。
#[cfg(target_os = "macos")]
fn menu_accelerator(map: &HashMap<String, Vec<String>>, action_id: &str, default: &str) -> String {
    match map.get(action_id).and_then(|keys| keys.first()) {
        Some(spec) => spec_to_accelerator(spec),
        None => default.to_string(),
    }
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy)]
enum MenuLanguage {
    En,
    Zh,
}

#[cfg(target_os = "macos")]
impl MenuLanguage {
    fn from_code(language: &str) -> Self {
        match language {
            "zh" | "zh-CN" | "zh-Hans" => Self::Zh,
            _ => Self::En,
        }
    }

    fn text(self, key: &str) -> &'static str {
        match (self, key) {
            (Self::Zh, "file") => "文件",
            (Self::Zh, "new_file") => "新建文件",
            (Self::Zh, "open_file") => "打开文件...",
            (Self::Zh, "open_folder") => "打开文件夹...",
            (Self::Zh, "save") => "保存",
            (Self::Zh, "save_as") => "另存为...",
            (Self::Zh, "edit") => "编辑",
            (Self::Zh, "find") => "查找",
            (Self::Zh, "view") => "视图",
            (Self::Zh, "explorer") => "资源管理器",
            (Self::Zh, "git_panel") => "Git 面板",
            (Self::Zh, "terminal") => "终端",
            (Self::Zh, "window") => "窗口",
            (Self::Zh, "help") => "帮助",
            (Self::Zh, "welcome") => "欢迎",
            (Self::Zh, "documentation") => "文档",
            (Self::Zh, "keyboard_shortcuts") => "键盘快捷键",
            (Self::Zh, "release_notes") => "发行说明",
            (Self::Zh, "report_issue") => "报告问题",
            (Self::Zh, "view_logs") => "查看日志",
            (Self::Zh, "check_for_updates") => "检查更新",
            (Self::Zh, "community") => "社区",
            (Self::Zh, "privacy_statement") => "隐私声明",
            (Self::Zh, "about_norn") => "关于 Norn",
            (_, "file") => "File",
            (_, "new_file") => "New File",
            (_, "open_file") => "Open File...",
            (_, "open_folder") => "Open Folder...",
            (_, "save") => "Save",
            (_, "save_as") => "Save As...",
            (_, "edit") => "Edit",
            (_, "find") => "Find",
            (_, "view") => "View",
            (_, "explorer") => "Explorer",
            (_, "git_panel") => "Git Panel",
            (_, "terminal") => "Terminal",
            (_, "window") => "Window",
            (_, "help") => "Help",
            (_, "welcome") => "Welcome",
            (_, "documentation") => "Documentation",
            (_, "keyboard_shortcuts") => "Keyboard Shortcuts",
            (_, "release_notes") => "Release Notes",
            (_, "report_issue") => "Report Issue",
            (_, "view_logs") => "View Logs",
            (_, "check_for_updates") => "Check for Updates",
            (_, "community") => "Community",
            (_, "privacy_statement") => "Privacy Statement",
            (_, "about_norn") => "About Norn",
            _ => "",
        }
    }
}

#[cfg(target_os = "macos")]
fn build_macos_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    language: MenuLanguage,
) -> tauri::Result<Menu<R>> {
    let package_info = app.package_info();
    let config = app.config();
    let about_metadata = AboutMetadata {
        name: Some(package_info.name.clone()),
        version: Some(package_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config
            .bundle
            .publisher
            .clone()
            .map(|publisher| vec![publisher]),
        ..Default::default()
    };

    let app_menu = Submenu::with_items(
        app,
        package_info.name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(about_metadata))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    // 菜单加速键从 keybindings.json 取(没改过则用默认),与前端 action 键位保持一致。
    let bindings = read_keybindings_map(app);
    let new_file_accel = menu_accelerator(&bindings, "file.new", "CmdOrCtrl+N");
    let open_file_accel = menu_accelerator(&bindings, "file.open", "CmdOrCtrl+O");
    let open_folder_accel = menu_accelerator(&bindings, "file.openFolder", "CmdOrCtrl+Shift+O");
    let save_accel = menu_accelerator(&bindings, "file.save", "CmdOrCtrl+S");
    let save_as_accel = menu_accelerator(&bindings, "file.saveAs", "CmdOrCtrl+Shift+S");
    let find_accel = menu_accelerator(&bindings, "navigate.goToFile", "CmdOrCtrl+P");

    let file_menu = Submenu::with_items(
        app,
        language.text("file"),
        true,
        &[
            &MenuItem::with_id(
                app,
                MENU_NEW_FILE,
                language.text("new_file"),
                true,
                Some(new_file_accel.as_str()),
            )?,
            &MenuItem::with_id(
                app,
                MENU_OPEN_FILE,
                language.text("open_file"),
                true,
                Some(open_file_accel.as_str()),
            )?,
            &MenuItem::with_id(
                app,
                MENU_OPEN_FOLDER,
                language.text("open_folder"),
                true,
                Some(open_folder_accel.as_str()),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                MENU_SAVE_FILE,
                language.text("save"),
                true,
                Some(save_accel.as_str()),
            )?,
            &MenuItem::with_id(
                app,
                MENU_SAVE_FILE_AS,
                language.text("save_as"),
                true,
                Some(save_as_accel.as_str()),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        language.text("edit"),
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                MENU_FIND,
                language.text("find"),
                true,
                Some(find_accel.as_str()),
            )?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        language.text("view"),
        true,
        &[
            &MenuItem::with_id(
                app,
                MENU_SHOW_EXPLORER,
                language.text("explorer"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                MENU_TOGGLE_GIT_PANEL,
                language.text("git_panel"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                MENU_TOGGLE_TERMINAL,
                language.text("terminal"),
                true,
                None::<&str>,
            )?,
        ],
    )?;

    let window_menu = Submenu::with_id_and_items(
        app,
        tauri::menu::WINDOW_SUBMENU_ID,
        language.text("window"),
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let help_menu = Submenu::with_id_and_items(
        app,
        tauri::menu::HELP_SUBMENU_ID,
        language.text("help"),
        true,
        &[
            &MenuItem::with_id(app, MENU_WELCOME, language.text("welcome"), true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                MENU_DOCUMENTATION,
                language.text("documentation"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                MENU_KEYBOARD_SHORTCUTS,
                language.text("keyboard_shortcuts"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                MENU_RELEASE_NOTES,
                language.text("release_notes"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                MENU_REPORT_ISSUE,
                language.text("report_issue"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(app, MENU_VIEW_LOGS, language.text("view_logs"), true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                MENU_CHECK_FOR_UPDATES,
                language.text("check_for_updates"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(app, MENU_COMMUNITY, language.text("community"), true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                MENU_PRIVACY_STATEMENT,
                language.text("privacy_statement"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(app, MENU_ABOUT_NORN, language.text("about_norn"), true, None::<&str>)?,
        ],
    )?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn set_app_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    let menu = build_macos_menu(&app, MenuLanguage::from_code(&language)).map_err(|error| error.to_string())?;
    app.set_menu(menu).map(|_| ()).map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn set_app_language(_app: tauri::AppHandle, _language: String) -> Result<(), String> {
    Ok(())
}

fn is_forwarded_menu_event(id: &str) -> bool {
    matches!(
        id,
        MENU_NEW_FILE
            | MENU_OPEN_FILE
            | MENU_OPEN_FOLDER
            | MENU_SAVE_FILE
            | MENU_SAVE_FILE_AS
            | MENU_FIND
            | MENU_SHOW_EXPLORER
            | MENU_TOGGLE_GIT_PANEL
            | MENU_TOGGLE_TERMINAL
            | MENU_WELCOME
            | MENU_DOCUMENTATION
            | MENU_KEYBOARD_SHORTCUTS
            | MENU_RELEASE_NOTES
            | MENU_REPORT_ISSUE
            | MENU_VIEW_LOGS
            | MENU_CHECK_FOR_UPDATES
            | MENU_COMMUNITY
            | MENU_PRIVACY_STATEMENT
            | MENU_ABOUT_NORN
    )
}

fn collect_open_file_args<I, S>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .filter_map(|arg| {
            let value = arg.as_ref();

            if value.starts_with('-') || value.starts_with("tauri://") {
                return None;
            }

            let path = PathBuf::from(value);

            if path.is_file() {
                Some(path.to_string_lossy().into_owned())
            } else {
                None
            }
        })
        .collect()
}

fn emit_open_files<R: tauri::Runtime>(app: &tauri::AppHandle<R>, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    let _ = app.emit(OPEN_FILES_EVENT, paths);

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_open_files = collect_open_file_args(std::env::args().skip(1));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            emit_open_files(app, collect_open_file_args(args));
        }))
        .plugin(tauri_plugin_shell::init())
        .manage(FsWatchState::default())
        .manage(PendingOpenFilesState(Mutex::new(initial_open_files)))
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();

            if is_forwarded_menu_event(id) {
                let _ = app.emit(MENU_EVENT, id);
            }
        })
        .setup(|app| {
            app.handle().set_theme(Some(Theme::Light));

            if let Some(window) = app.get_webview_window("main") {
                window.set_theme(Some(Theme::Light))?;
            }

            #[cfg(target_os = "macos")]
            {
                let menu = build_macos_menu(app.handle(), MenuLanguage::Zh)?;
                app.set_menu(menu)?;
            }

            #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
            {
                let menu = tauri::menu::Menu::default(app.handle())?;
                app.set_menu(menu)?;
            }

            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                window.set_decorations(false)?;
            }

            // 窗口初始 visible:false(避免启动透明框),正常情况下前端挂载后会调用 show()。
            // 兜底:万一前端加载/渲染失败,这里在短延时后也强制显示窗口,避免永久空白卡死。
            let show_handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(3000));
                if let Some(window) = show_handle.get_webview_window("main") {
                    let _ = window.show();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            debug_log,
            destroy_current_window,
            take_initial_open_files,
            detect_git_cli,
            inspect_git_workspace,
            open_file_dialog,
            open_folder_dialog,
            open_save_dialog,
            inspect_text_file,
            read_text_file,
            read_text_file_range,
            save_text_file,
            save_text_file_as,
            list_directory,
            search_file_names,
            search_in_files,
            watch_directory,
            unwatch_directory,
            reveal_in_file_manager,
            open_terminal_at,
            copy_files_to_clipboard,
            scratch_folder,
            create_file,
            create_directory,
            rename_path,
            move_path,
            copy_path,
            copy_external_paths,
            trash_path,
            read_keybindings,
            write_keybindings,
            read_config_file,
            write_config_file,
            set_window_theme,
            set_app_language,
            app_config_dir,
            git::git_status,
            git::git_file_diff,
            git::git_file_versions,
            git::git_commit_file_versions,
            git::git_ignore_path,
            git::git_ignored_files,
            git::git_resolve_conflict,
            git::git_commit,
            git::git_push,
            git::git_pull,
            git::git_checkout,
            git::git_create_branch,
            git::git_init,
            git::git_branches,
            git::git_recent_commits,
            git::git_log,
            git::git_commit_files,
            git::git_branch_divergence,
        ])
        .build(tauri::generate_context!())
        .expect("error while building norn")
        .run(|app, event| {
            let _ = (&app, &event);

            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            if let tauri::RunEvent::Opened { urls } = event {
                let paths = urls
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter(|path| path.is_file())
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect::<Vec<_>>();
                emit_open_files(app, paths);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    struct TestWorkspace {
        root: PathBuf,
        _temp_dir: TempDir,
    }

    impl TestWorkspace {
        fn new() -> Self {
            let temp_dir = tempfile::Builder::new()
                .prefix("norn-file-tree-test-")
                .tempdir()
                .expect("test workspace should be created");
            let root = temp_dir
                .path()
                .canonicalize()
                .expect("test workspace should be canonicalized");

            Self {
                root,
                _temp_dir: temp_dir,
            }
        }

        fn root_string(&self) -> String {
            self.root.to_string_lossy().into_owned()
        }

        fn path_string(&self, path: &Path) -> String {
            path.to_string_lossy().into_owned()
        }
    }

    #[test]
    fn search_regex_modes_behave() {
        // 字面量:特殊字符被转义,大小写不敏感。
        let literal = build_search_regex("a.b", false, false, false).unwrap();
        assert!(literal.is_match("A.B"));
        assert!(!literal.is_match("aXb"));

        // 整词:不匹配子串。
        let word = build_search_regex("cat", true, true, false).unwrap();
        assert!(word.is_match("a cat sat"));
        assert!(!word.is_match("category"));

        // 正则模式 + 大小写敏感。
        let re = build_search_regex("a.c", true, false, true).unwrap();
        assert!(re.is_match("abc"));
        assert!(!re.is_match("ABC"));

        // 非法正则报错。
        assert!(build_search_regex("(", false, false, true).is_err());
    }

    #[test]
    fn search_in_files_finds_matches_and_skips_binary_and_ignored() {
        let workspace = TestWorkspace::new();
        fs::write(workspace.root.join("a.txt"), "hello world\nsecond line").unwrap();
        fs::write(workspace.root.join("b.txt"), "no match here").unwrap();
        fs::write(workspace.root.join(".gitignore"), "ignored.txt\n").unwrap();
        fs::write(workspace.root.join("ignored.txt"), "hello ignored").unwrap();
        fs::write(
            workspace.root.join("bin.dat"),
            [0u8, 159, 146, 150, b'h', b'i'],
        )
        .unwrap();

        let hits = search_in_files(
            workspace.root_string(),
            "hello".to_string(),
            false,
            false,
            false,
            true,
            true,
        )
        .unwrap();

        assert_eq!(hits.len(), 1, "binary + gitignored files excluded");
        assert!(hits[0].path.ends_with("a.txt"));
        assert_eq!(hits[0].line, 1);
    }

    #[test]
    fn create_file_rejects_existing_destination() {
        let workspace = TestWorkspace::new();
        fs::write(workspace.root.join("notes.txt"), "hello").expect("seed file should be written");

        let error = create_file(
            workspace.root_string(),
            workspace.root_string(),
            "notes.txt".to_string(),
        )
        .expect_err("existing destination should be rejected");

        assert_eq!(error.kind, FileOperationErrorKind::Conflict);
    }

    #[test]
    fn move_path_rejects_descendant_destination() {
        let workspace = TestWorkspace::new();
        let source = workspace.root.join("source");
        let child = source.join("child");
        fs::create_dir_all(&child).expect("nested directories should be created");

        let error = move_path(
            workspace.root_string(),
            workspace.path_string(&source),
            workspace.path_string(&child),
        )
        .expect_err("moving a directory into a descendant should be rejected");

        assert_eq!(error.kind, FileOperationErrorKind::WouldNest);
    }

    #[test]
    fn trash_path_rejects_workspace_root() {
        let workspace = TestWorkspace::new();

        let error = trash_path(workspace.root_string(), workspace.root_string())
            .expect_err("workspace root should not be moved to trash");

        assert_eq!(error.kind, FileOperationErrorKind::RootOperation);
    }

    #[test]
    fn read_text_file_reads_utf8_file() {
        let workspace = TestWorkspace::new();
        let file_path = workspace.root.join("notes.txt");
        fs::write(&file_path, "hello\nworld\n").expect("text file should be written");

        let file = read_text_file(workspace.path_string(&file_path), None)
            .expect("utf-8 file should be read");

        assert_eq!(file.name, "notes.txt");
        assert_eq!(file.content, "hello\nworld\n");
        assert_eq!(file.size, 12);
        assert_eq!(file.encoding, "utf-8");
    }

    #[test]
    fn read_text_file_rejects_binary_file() {
        let workspace = TestWorkspace::new();
        let file_path = workspace.root.join("binary.bin");
        fs::write(&file_path, [b'a', 0, b'b']).expect("binary file should be written");

        let error = match read_text_file(workspace.path_string(&file_path), None) {
            Ok(_) => panic!("binary file should be rejected"),
            Err(error) => error,
        };

        assert!(error.contains("appears to be a binary file"));
    }

    #[test]
    fn inspect_text_file_detects_gbk_file() {
        let workspace = TestWorkspace::new();
        let file_path = workspace.root.join("gbk.txt");
        fs::write(&file_path, [0xc4, 0xe3, 0xba, 0xc3]).expect("gbk file should be written");

        let inspection = inspect_text_file(workspace.path_string(&file_path))
            .expect("inspection should decode supported legacy encodings");

        assert!(!inspection.is_binary);
        assert!(!inspection.is_utf8);
        assert!(inspection.is_text);
        assert_eq!(inspection.encoding.as_deref(), Some("gb18030"));
        assert_eq!(inspection.sample, "你好");
    }

    #[test]
    fn read_text_file_can_force_big5_encoding() {
        let workspace = TestWorkspace::new();
        let file_path = workspace.root.join("big5.txt");
        fs::write(
            &file_path,
            [
                0xc1, 0x63, 0xc5, 0xe9, 0xa4, 0xa4, 0xa4, 0xe5, 0xa1, 0x47, 0xa7, 0x41, 0xa6, 0x6e,
            ],
        )
        .expect("big5 file should be written");

        let file = read_text_file(workspace.path_string(&file_path), Some("big5".to_string()))
            .expect("big5 file should be decoded with the requested encoding");

        assert_eq!(file.encoding, "big5");
        assert_eq!(file.content, "繁體中文：你好");
        assert!(file
            .encoding_candidates
            .iter()
            .any(|candidate| candidate.encoding == "big5" && candidate.valid));
    }

    #[test]
    fn save_text_file_preserves_requested_legacy_encoding() {
        let workspace = TestWorkspace::new();
        let file_path = workspace.root.join("gbk.txt");
        fs::write(&file_path, [0xc4, 0xe3]).expect("gbk seed file should be written");
        let before = fs::metadata(&file_path)
            .ok()
            .and_then(|metadata| modified_time_millis(&metadata));

        let saved = save_text_file(
            workspace.path_string(&file_path),
            "你好".to_string(),
            before,
            Some(false),
            Some("gb18030".to_string()),
            Some(false),
        )
        .expect("gbk-compatible content should save");

        assert_eq!(saved.encoding, "gb18030");
        assert_eq!(
            fs::read(&file_path).expect("saved file should be readable"),
            vec![0xc4, 0xe3, 0xba, 0xc3]
        );
    }

    #[test]
    fn read_text_file_range_reads_requested_slice() {
        let workspace = TestWorkspace::new();
        let file_path = workspace.root.join("range.txt");
        fs::write(&file_path, "first\nsecond\nthird\n").expect("range file should be written");

        let range = read_text_file_range(workspace.path_string(&file_path), 2, 4, None)
            .expect("range should be read");

        assert_eq!(range.content, "first\nsecond\n");
        assert_eq!(range.requested_offset, 2);
        assert_eq!(range.start_offset, 0);
        assert_eq!(range.end_offset, 13);
        assert!(!range.has_more_before);
        assert!(range.has_more_after);
    }

    #[test]
    fn read_text_file_range_handles_offset_beyond_end() {
        let workspace = TestWorkspace::new();
        let file_path = workspace.root.join("small.txt");
        fs::write(&file_path, "abc").expect("small file should be written");

        let range = read_text_file_range(workspace.path_string(&file_path), 99, 10, None)
            .expect("out-of-range offset should be clamped");

        assert_eq!(range.content, "abc");
        assert_eq!(range.requested_offset, 3);
        assert_eq!(range.start_offset, 0);
        assert_eq!(range.end_offset, 3);
        assert!(!range.has_more_before);
        assert!(!range.has_more_after);
    }

    #[test]
    fn read_text_file_range_aligns_to_utf8_boundary() {
        let workspace = TestWorkspace::new();
        let file_path = workspace.root.join("utf8.txt");
        fs::write(&file_path, "a你b").expect("utf-8 file should be written");

        let range = read_text_file_range(workspace.path_string(&file_path), 2, 1, None)
            .expect("range should align to utf-8 character boundaries");

        assert_eq!(range.content, "a你b");
        assert_eq!(range.start_offset, 0);
        assert_eq!(range.end_offset, 5);
    }

    #[test]
    fn read_text_file_range_rejects_binary_content() {
        let workspace = TestWorkspace::new();
        let file_path = workspace.root.join("binary-range.bin");
        fs::write(&file_path, [b'a', 0, b'b']).expect("binary file should be written");

        let error = match read_text_file_range(workspace.path_string(&file_path), 0, 3, None) {
            Ok(_) => panic!("binary range should be rejected"),
            Err(error) => error,
        };

        assert!(error.contains("appears to be a binary file"));
    }

    #[cfg(unix)]
    #[test]
    fn directory_entry_marks_symlink_and_canonical_target() {
        use std::os::unix::fs::symlink;

        let workspace = TestWorkspace::new();
        let real_dir = workspace.root.join("real");
        let linked_dir = workspace.root.join("linked");
        fs::create_dir_all(&real_dir).expect("real directory should be created");
        symlink(&real_dir, &linked_dir).expect("symlink should be created");

        let entry = directory_entry_from_path(&linked_dir, "linked");

        assert!(entry.is_symlink);
        assert_eq!(entry.kind, DirectoryEntryKind::Directory);
        assert_eq!(entry.target_kind, Some(DirectoryEntryKind::Directory));
        assert_eq!(
            entry.canonical_path,
            Some(
                real_dir
                    .canonicalize()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            )
        );
    }
}

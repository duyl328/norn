use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu},
    Emitter, Manager, Theme,
};
use tauri_plugin_dialog::DialogExt;

use serde::Serialize;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

const MENU_EVENT: &str = "norn-menu";
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedTextFile {
    name: String,
    path: String,
    size: u64,
    last_modified: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveTextFileError {
    kind: SaveTextFileErrorKind,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "kebab-case")]
enum SaveTextFileErrorKind {
    Deleted,
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

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
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
fn read_text_file(path: String) -> Result<TextFile, String> {
    let path = PathBuf::from(path);
    let metadata = fs::metadata(&path)
        .map_err(|error| format_file_error("Unable to read file metadata", &path, error))?;

    if !metadata.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }

    let bytes =
        fs::read(&path).map_err(|error| format_file_error("Unable to read file", &path, error))?;

    if bytes.contains(&0) {
        return Err(format!("{} appears to be a binary file", path.display()));
    }

    let content = String::from_utf8(bytes)
        .map_err(|_| format!("{} is not valid UTF-8 text", path.display()))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled")
        .to_string();

    Ok(TextFile {
        name,
        path: path.to_string_lossy().into_owned(),
        content,
        size: metadata.len(),
        last_modified: modified_time_millis(&metadata),
    })
}

#[tauri::command]
fn save_text_file(
    path: String,
    content: String,
    expected_last_modified: Option<u64>,
    force: Option<bool>,
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

    atomic_write_text_file(&path, &content)?;
    saved_text_file_from_path(&path)
}

#[tauri::command]
fn save_text_file_as(path: String, content: String) -> Result<SavedTextFile, SaveTextFileError> {
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

    atomic_write_text_file(&path, &content)?;
    saved_text_file_from_path(&path)
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

    let is_binary = buffer.contains(&0);
    let is_utf8 = !is_binary && std::str::from_utf8(&buffer).is_ok();
    let sample = if is_utf8 {
        String::from_utf8_lossy(&buffer).into_owned()
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
        sample,
    })
}

#[tauri::command]
fn read_text_file_range(path: String, offset: u64, length: u64) -> Result<TextFileRange, String> {
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

    if buffer.contains(&0) {
        return Err(format!("{} appears to be a binary file", path.display()));
    }

    let content = String::from_utf8(buffer)
        .map_err(|_| format!("{} range is not valid UTF-8 text", path.display()))?;

    Ok(TextFileRange {
        path: path.to_string_lossy().into_owned(),
        content,
        size: file_size,
        requested_offset,
        start_offset,
        end_offset,
        has_more_before: start_offset > 0,
        has_more_after: end_offset < file_size,
    })
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

fn saved_text_file_from_path(path: &Path) -> Result<SavedTextFile, SaveTextFileError> {
    let metadata = fs::metadata(path)
        .map_err(|error| save_error_from_io("Unable to read saved file metadata", path, error))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled")
        .to_string();

    Ok(SavedTextFile {
        name,
        path: path.to_string_lossy().into_owned(),
        size: metadata.len(),
        last_modified: modified_time_millis(&metadata),
    })
}

fn atomic_write_text_file(path: &Path, content: &str) -> Result<(), SaveTextFileError> {
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

        if let Err(error) = file.write_all(content.as_bytes()) {
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

#[cfg(target_os = "macos")]
fn build_macos_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
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

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, MENU_NEW_FILE, "New File", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(
                app,
                MENU_OPEN_FILE,
                "Open File...",
                true,
                Some("CmdOrCtrl+O"),
            )?,
            &MenuItem::with_id(
                app,
                MENU_OPEN_FOLDER,
                "Open Folder...",
                true,
                Some("CmdOrCtrl+Shift+O"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MENU_SAVE_FILE, "Save", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(
                app,
                MENU_SAVE_FILE_AS,
                "Save As...",
                true,
                Some("CmdOrCtrl+Shift+S"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
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
            &MenuItem::with_id(app, MENU_FIND, "Find", true, Some("CmdOrCtrl+P"))?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, MENU_SHOW_EXPLORER, "Explorer", true, None::<&str>)?,
            &MenuItem::with_id(app, MENU_TOGGLE_GIT_PANEL, "Git Panel", true, None::<&str>)?,
            &MenuItem::with_id(app, MENU_TOGGLE_TERMINAL, "Terminal", true, None::<&str>)?,
        ],
    )?;

    let window_menu = Submenu::with_id_and_items(
        app,
        tauri::menu::WINDOW_SUBMENU_ID,
        "Window",
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
        "Help",
        true,
        &[
            &MenuItem::with_id(app, MENU_WELCOME, "Welcome", true, None::<&str>)?,
            &MenuItem::with_id(app, MENU_DOCUMENTATION, "Documentation", true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                MENU_KEYBOARD_SHORTCUTS,
                "Keyboard Shortcuts",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(app, MENU_RELEASE_NOTES, "Release Notes", true, None::<&str>)?,
            &MenuItem::with_id(app, MENU_REPORT_ISSUE, "Report Issue", true, None::<&str>)?,
            &MenuItem::with_id(app, MENU_VIEW_LOGS, "View Logs", true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                MENU_CHECK_FOR_UPDATES,
                "Check for Updates",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(app, MENU_COMMUNITY, "Community", true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                MENU_PRIVACY_STATEMENT,
                "Privacy Statement",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(app, MENU_ABOUT_NORN, "About Norn", true, None::<&str>)?,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
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
                let menu = build_macos_menu(app.handle())?;
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
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
            scratch_folder,
            create_file,
            create_directory,
            rename_path,
            move_path,
            copy_path,
            copy_external_paths,
            trash_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running norn");
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

        let file =
            read_text_file(workspace.path_string(&file_path)).expect("utf-8 file should be read");

        assert_eq!(file.name, "notes.txt");
        assert_eq!(file.content, "hello\nworld\n");
        assert_eq!(file.size, 12);
    }

    #[test]
    fn read_text_file_rejects_binary_file() {
        let workspace = TestWorkspace::new();
        let file_path = workspace.root.join("binary.bin");
        fs::write(&file_path, [b'a', 0, b'b']).expect("binary file should be written");

        let error = match read_text_file(workspace.path_string(&file_path)) {
            Ok(_) => panic!("binary file should be rejected"),
            Err(error) => error,
        };

        assert!(error.contains("appears to be a binary file"));
    }

    #[test]
    fn inspect_text_file_flags_non_utf8_file() {
        let workspace = TestWorkspace::new();
        let file_path = workspace.root.join("latin1.txt");
        fs::write(&file_path, [0xff, 0xfe, b'a']).expect("non utf-8 file should be written");

        let inspection = inspect_text_file(workspace.path_string(&file_path))
            .expect("inspection should not require full utf-8 content");

        assert!(!inspection.is_binary);
        assert!(!inspection.is_utf8);
        assert!(inspection.sample.is_empty());
    }

    #[test]
    fn read_text_file_range_reads_requested_slice() {
        let workspace = TestWorkspace::new();
        let file_path = workspace.root.join("range.txt");
        fs::write(&file_path, "first\nsecond\nthird\n").expect("range file should be written");

        let range = read_text_file_range(workspace.path_string(&file_path), 2, 4)
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

        let range = read_text_file_range(workspace.path_string(&file_path), 99, 10)
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

        let range = read_text_file_range(workspace.path_string(&file_path), 2, 1)
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

        let error = match read_text_file_range(workspace.path_string(&file_path), 0, 3) {
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

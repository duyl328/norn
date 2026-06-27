//! 系统 `git` CLI 对接：参数数组执行，禁止拼接 shell 字符串，
//! 向前端返回结构化错误 `{ kind, message }`。变更模型是扁平的——
//! 不区分已暂存/未暂存，提交即提交全部改动（`git add -A` + `git commit`）。

use std::{collections::HashMap, path::Path, path::PathBuf, process::Command};

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum GitErrorKind {
    GitNotFound,
    NotRepository,
    IdentityMissing,
    HookFailed,
    NothingToCommit,
    NoUpstream,
    AuthFailed,
    Conflict,
    Io,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitError {
    kind: GitErrorKind,
    message: String,
}

impl GitError {
    fn new(kind: GitErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    path: String,
    status: String,
    additions: u32,
    deletions: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResult {
    branch: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    changes: Vec<GitChange>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_commit: Option<String>,
    current: bool,
    kind: String, // "local" | "remote"
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchesResult {
    current: Option<String>,
    local: Vec<GitBranch>,
    remote: Vec<GitBranch>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    hash: String,
    subject: String,
    author: String,
    relative_time: String,
    refs: Vec<String>,
    is_merge: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogCommit {
    hash: String,
    parents: Vec<String>,
    subject: String,
    body: String,
    author: String,
    date: String,
    relative_time: String,
    refs: Vec<String>,
    is_merge: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFile {
    path: String,
    status: String,
    additions: u32,
    deletions: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitRef {
    hash: String,
    subject: String,
    relative_time: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDivergence {
    base: Option<String>,
    fork_point: Option<GitCommitRef>,
    own_commits: Vec<GitCommitRef>,
    base_new_commits: Vec<GitCommitRef>,
    ahead_of_base: u32,
    behind_base: u32,
}

// --- 进程执行 -------------------------------------------------------------

fn run_git(workspace: &Path, args: &[&str]) -> Result<std::process::Output, GitError> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(workspace).args(args);
    match cmd.output() {
        Ok(output) => Ok(output),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(GitError::new(
            GitErrorKind::GitNotFound,
            "未检测到 Git 命令，请先安装 Git。",
        )),
        Err(error) => Err(GitError::new(GitErrorKind::Io, error.to_string())),
    }
}

/// 运行 git 并要求成功，失败时把 stderr/stdout 映射成结构化错误。
fn git_text(workspace: &Path, args: &[&str]) -> Result<String, GitError> {
    let output = run_git(workspace, args)?;
    if !output.status.success() {
        return Err(map_failure(&output));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn map_failure(output: &std::process::Output) -> GitError {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let kind = classify(&stderr, &stdout);
    let message = stderr.trim();
    let message = if message.is_empty() {
        stdout.trim()
    } else {
        message
    };
    GitError::new(kind, message.to_string())
}

fn classify(stderr: &str, stdout: &str) -> GitErrorKind {
    let haystack = format!("{stderr}\n{stdout}").to_lowercase();
    let has = |needle: &str| haystack.contains(needle);
    if has("not a git repository") {
        GitErrorKind::NotRepository
    } else if has("please tell me who you are") || has("empty ident") || has("user.name") {
        GitErrorKind::IdentityMissing
    } else if has("nothing to commit") || has("no changes added") {
        GitErrorKind::NothingToCommit
    } else if has("hook") {
        GitErrorKind::HookFailed
    } else if has("has no upstream branch") || has("no upstream configured") {
        GitErrorKind::NoUpstream
    } else if has("authentication failed")
        || has("could not read username")
        || has("permission denied")
        || has("publickey")
    {
        GitErrorKind::AuthFailed
    } else if has("conflict") || has("would be overwritten") || has("overwritten by checkout") {
        GitErrorKind::Conflict
    } else {
        GitErrorKind::Io
    }
}

// --- 解析 -----------------------------------------------------------------

/// 解析 `git status --porcelain=v2 --branch -z` 的输出。
/// 返回 (branch, upstream, ahead, behind, changes)。numstat 行数后续回填。
fn parse_status(stdout: &[u8]) -> GitStatusResult {
    let text = String::from_utf8_lossy(stdout);
    let tokens: Vec<&str> = text.split('\0').collect();
    let mut branch = None;
    let mut upstream = None;
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut changes = Vec::new();

    let mut index = 0;
    while index < tokens.len() {
        let token = tokens[index];
        index += 1;
        if token.is_empty() {
            continue;
        }
        match token.chars().next().unwrap() {
            '#' => {
                if let Some(rest) = token.strip_prefix("# branch.head ") {
                    branch = (rest != "(detached)").then(|| rest.to_string());
                } else if let Some(rest) = token.strip_prefix("# branch.upstream ") {
                    upstream = Some(rest.to_string());
                } else if let Some(rest) = token.strip_prefix("# branch.ab ") {
                    for part in rest.split_whitespace() {
                        if let Some(value) = part.strip_prefix('+') {
                            ahead = value.parse().unwrap_or(0);
                        } else if let Some(value) = part.strip_prefix('-') {
                            behind = value.parse().unwrap_or(0);
                        }
                    }
                }
            }
            '1' => {
                // 1 <xy> <sub> <mH> <mI> <mW> <hH> <hI> <path>
                let fields: Vec<&str> = token.splitn(9, ' ').collect();
                if fields.len() == 9 {
                    changes.push(GitChange {
                        path: fields[8].to_string(),
                        status: status_from_xy(fields[1]).to_string(),
                        additions: 0,
                        deletions: 0,
                        previous_path: None,
                    });
                }
            }
            '2' => {
                // 2 <xy> ... <Xscore> <path>  紧跟一个 NUL 分隔的 origPath
                let fields: Vec<&str> = token.splitn(10, ' ').collect();
                if fields.len() == 10 {
                    let previous_path = tokens.get(index).map(|value| value.to_string());
                    index += 1; // 消费 origPath
                    changes.push(GitChange {
                        path: fields[9].to_string(),
                        status: "renamed".to_string(),
                        additions: 0,
                        deletions: 0,
                        previous_path,
                    });
                }
            }
            '?' => {
                if let Some(path) = token.strip_prefix("? ") {
                    changes.push(GitChange {
                        path: path.to_string(),
                        status: "untracked".to_string(),
                        additions: 0,
                        deletions: 0,
                        previous_path: None,
                    });
                }
            }
            'u' => {
                // u <xy> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
                let fields: Vec<&str> = token.splitn(11, ' ').collect();
                if fields.len() == 11 {
                    changes.push(GitChange {
                        path: fields[10].to_string(),
                        status: "conflict".to_string(),
                        additions: 0,
                        deletions: 0,
                        previous_path: None,
                    });
                }
            }
            _ => {}
        }
    }

    GitStatusResult {
        branch,
        upstream,
        ahead,
        behind,
        changes,
    }
}

/// XY 两字符 → 扁平状态。A/D 优先，其余按修改处理。
fn status_from_xy(xy: &str) -> &'static str {
    if xy.contains('A') {
        "added"
    } else if xy.contains('D') {
        "deleted"
    } else {
        "modified"
    }
}

/// 解析 `git diff --numstat HEAD`：`<add>\t<del>\t<path>`，二进制为 `-`。
fn parse_numstat(text: &str) -> HashMap<String, (u32, u32)> {
    let mut map = HashMap::new();
    for line in text.lines() {
        let mut parts = line.splitn(3, '\t');
        let (Some(add), Some(del), Some(path)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        let additions = add.parse().unwrap_or(0);
        let deletions = del.parse().unwrap_or(0);
        map.insert(normalize_numstat_path(path), (additions, deletions));
    }
    map
}

/// numstat 重命名路径形如 `old => new` 或 `pre{old => new}post`，取最终路径。
fn normalize_numstat_path(path: &str) -> String {
    if let (Some(open), Some(arrow), Some(close)) =
        (path.find('{'), path.find(" => "), path.find('}'))
    {
        if open < arrow && arrow < close {
            let prefix = &path[..open];
            let new_part = &path[arrow + 4..close];
            let suffix = &path[close + 1..];
            return format!("{prefix}{new_part}{suffix}").replace("//", "/");
        }
    }
    if let Some((_, new)) = path.split_once(" => ") {
        return new.to_string();
    }
    path.to_string()
}

fn parse_track(track: &str) -> (u32, u32) {
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let cleaned = track.trim_matches(|c| c == '[' || c == ']');
    for part in cleaned.split(", ") {
        if let Some(value) = part.strip_prefix("ahead ") {
            ahead = value.trim().parse().unwrap_or(0);
        } else if let Some(value) = part.strip_prefix("behind ") {
            behind = value.trim().parse().unwrap_or(0);
        }
    }
    (ahead, behind)
}

// --- 命令 -----------------------------------------------------------------

#[tauri::command]
pub fn git_status(path: String) -> Result<GitStatusResult, GitError> {
    let workspace = PathBuf::from(path);
    let output = run_git(&workspace, &["status", "--porcelain=v2", "--branch", "-z"])?;
    if !output.status.success() {
        return Err(map_failure(&output));
    }
    let mut result = parse_status(&output.stdout);

    // 行数 best-effort：未跟踪文件不在 HEAD diff 中，保持 0。
    if let Ok(numstat) = git_text(&workspace, &["diff", "--numstat", "HEAD"]) {
        let counts = parse_numstat(&numstat);
        for change in result.changes.iter_mut() {
            if let Some((additions, deletions)) = counts.get(&change.path) {
                change.additions = *additions;
                change.deletions = *deletions;
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn git_file_diff(path: String, file: String) -> Result<String, GitError> {
    let workspace = PathBuf::from(path);
    let diff = git_text(&workspace, &["diff", "HEAD", "--", &file])?;
    if !diff.trim().is_empty() {
        return Ok(diff);
    }
    // HEAD 中没有（多为未跟踪文件）→ 用 --no-index 兜底，退出码 1 表示有差异，不算错误。
    let null_device = if cfg!(windows) { "NUL" } else { "/dev/null" };
    let output = run_git(&workspace, &["diff", "--no-index", "--", null_device, &file])?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileVersions {
    original: String,
    modified: String,
}

/// 取某文件的两个完整版本,供并排 diff(MergeView)使用:
/// original = HEAD 中的内容(新文件 / HEAD 无此文件时为空),
/// modified = 工作区当前文件内容(已删除时为空)。
#[tauri::command]
pub fn git_file_versions(path: String, file: String) -> Result<GitFileVersions, GitError> {
    let workspace = PathBuf::from(path);
    let original = run_git(&workspace, &["show", &format!("HEAD:{file}")])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
        .unwrap_or_default();
    let modified = std::fs::read_to_string(workspace.join(&file)).unwrap_or_default();
    Ok(GitFileVersions { original, modified })
}

/// 取某历史提交里某文件的两个版本:original = 父提交版本(新增 / 根提交时为空),
/// modified = 该提交版本(删除时为空)。供历史页点击文件查看该次改动。
#[tauri::command]
pub fn git_commit_file_versions(
    path: String,
    hash: String,
    file: String,
) -> Result<GitFileVersions, GitError> {
    let workspace = PathBuf::from(path);
    let show = |spec: String| {
        run_git(&workspace, &["show", &spec])
            .ok()
            .filter(|output| output.status.success())
            .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
            .unwrap_or_default()
    };
    let original = show(format!("{hash}^:{file}"));
    let modified = show(format!("{hash}:{file}"));
    Ok(GitFileVersions { original, modified })
}

#[tauri::command]
pub fn git_commit(
    path: String,
    message: String,
    push: bool,
    amend: bool,
    files: Vec<String>,
) -> Result<(), GitError> {
    let workspace = PathBuf::from(path);

    // 暂存:有选中文件就只暂存这些(含未跟踪 / 删除),否则全量。
    if files.is_empty() {
        git_text(&workspace, &["add", "-A"])?;
    } else {
        let mut args: Vec<&str> = vec!["add", "-A", "--"];
        args.extend(files.iter().map(String::as_str));
        git_text(&workspace, &args)?;
    }

    // 提交:选中文件用 pathspec 限定;amend 改写上一条(无新说明则保留原说明)。
    let mut args: Vec<&str> = vec!["commit"];
    if amend {
        args.push("--amend");
        if message.trim().is_empty() {
            args.push("--no-edit");
        } else {
            args.push("-m");
            args.push(message.as_str());
        }
    } else {
        args.push("-m");
        args.push(message.as_str());
    }
    if !files.is_empty() {
        args.push("--");
        args.extend(files.iter().map(String::as_str));
    }
    git_text(&workspace, &args)?;

    if push {
        push_current(&workspace)?;
    }
    Ok(())
}

/// 把一条规则追加进 .gitignore(去重、自动补换行、文件不存在则创建)。
#[tauri::command]
pub fn git_ignore_path(path: String, entry: String) -> Result<(), GitError> {
    let workspace = PathBuf::from(path);
    let gitignore = workspace.join(".gitignore");
    let rule = entry.trim();
    if rule.is_empty() {
        return Ok(());
    }
    let mut content = std::fs::read_to_string(&gitignore).unwrap_or_default();
    if content.lines().any(|line| line.trim() == rule) {
        return Ok(());
    }
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(rule);
    content.push('\n');
    std::fs::write(&gitignore, content).map_err(|error| GitError::new(GitErrorKind::Io, error.to_string()))?;
    Ok(())
}

/// 列出被忽略的条目(目录折叠为 dir/,避免 node_modules 之类铺出上千文件)。
#[tauri::command]
pub fn git_ignored_files(path: String) -> Result<Vec<String>, GitError> {
    let workspace = PathBuf::from(path);
    let text = git_text(
        &workspace,
        &["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"],
    )?;
    Ok(text.lines().filter(|line| !line.is_empty()).map(|line| line.to_string()).collect())
}

/// 写入解决冲突后的文件内容,并 git add 标记为已解决。
#[tauri::command]
pub fn git_resolve_conflict(path: String, file: String, content: String) -> Result<(), GitError> {
    let workspace = PathBuf::from(path);
    std::fs::write(workspace.join(&file), content)
        .map_err(|error| GitError::new(GitErrorKind::Io, error.to_string()))?;
    git_text(&workspace, &["add", "--", &file])?;
    Ok(())
}

#[tauri::command]
pub fn git_push(path: String) -> Result<(), GitError> {
    push_current(&PathBuf::from(path))
}

fn push_current(workspace: &Path) -> Result<(), GitError> {
    let output = run_git(workspace, &["push"])?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
    if stderr.contains("has no upstream branch") || stderr.contains("no upstream configured") {
        let branch = current_branch(workspace)?;
        git_text(workspace, &["push", "-u", "origin", &branch])?;
        return Ok(());
    }
    Err(map_failure(&output))
}

#[tauri::command]
pub fn git_pull(path: String) -> Result<(), GitError> {
    git_text(&PathBuf::from(path), &["pull"])?;
    Ok(())
}

#[tauri::command]
pub fn git_checkout(path: String, branch: String) -> Result<(), GitError> {
    git_text(&PathBuf::from(path), &["switch", &branch])?;
    Ok(())
}

#[tauri::command]
pub fn git_create_branch(path: String, name: String) -> Result<(), GitError> {
    git_text(&PathBuf::from(path), &["switch", "-c", &name])?;
    Ok(())
}

#[tauri::command]
pub fn git_init(path: String) -> Result<(), GitError> {
    git_text(&PathBuf::from(path), &["init"])?;
    Ok(())
}

fn current_branch(workspace: &Path) -> Result<String, GitError> {
    Ok(git_text(workspace, &["branch", "--show-current"])?
        .trim()
        .to_string())
}

#[tauri::command]
pub fn git_branches(path: String) -> Result<GitBranchesResult, GitError> {
    let workspace = PathBuf::from(path);
    let current = current_branch(&workspace).ok().filter(|b| !b.is_empty());

    let local_text = git_text(
        &workspace,
        &[
            "for-each-ref",
            "--format=%(refname:short)%09%(upstream:short)%09%(upstream:track)%09%(HEAD)%09%(contents:subject)",
            "refs/heads",
        ],
    )?;
    let mut local = Vec::new();
    for line in local_text.lines() {
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.is_empty() || fields[0].is_empty() {
            continue;
        }
        let upstream = fields.get(1).filter(|v| !v.is_empty()).map(|v| v.to_string());
        let (ahead, behind) = parse_track(fields.get(2).copied().unwrap_or(""));
        let current_flag = fields.get(3).copied().unwrap_or("") == "*";
        let last_commit = fields.get(4).filter(|v| !v.is_empty()).map(|v| v.to_string());
        local.push(GitBranch {
            name: fields[0].to_string(),
            upstream,
            ahead,
            behind,
            last_commit,
            current: current_flag,
            kind: "local".to_string(),
        });
    }

    let remote_text = git_text(
        &workspace,
        &[
            "for-each-ref",
            "--format=%(refname:short)%09%(contents:subject)",
            "refs/remotes",
        ],
    )?;
    let mut remote = Vec::new();
    for line in remote_text.lines() {
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.is_empty() || fields[0].is_empty() || fields[0].ends_with("/HEAD") {
            continue;
        }
        let last_commit = fields.get(1).filter(|v| !v.is_empty()).map(|v| v.to_string());
        remote.push(GitBranch {
            name: fields[0].to_string(),
            upstream: None,
            ahead: 0,
            behind: 0,
            last_commit,
            current: false,
            kind: "remote".to_string(),
        });
    }

    Ok(GitBranchesResult {
        current,
        local,
        remote,
    })
}

#[tauri::command]
pub fn git_recent_commits(path: String, limit: u32) -> Result<Vec<GitCommit>, GitError> {
    let workspace = PathBuf::from(path);
    let limit_arg = format!("-n{limit}");
    // 空仓库 / 无提交时 git log 会失败，这里视为空血缘而非错误。
    let Ok(text) = git_text(
        &workspace,
        &[
            "log",
            &limit_arg,
            "--pretty=format:%h%x09%s%x09%an%x09%cr%x09%P%x09%D",
        ],
    ) else {
        return Ok(Vec::new());
    };

    let mut commits = Vec::new();
    for line in text.lines() {
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.len() < 5 {
            continue;
        }
        let parents = fields.get(4).copied().unwrap_or("");
        let refs = fields
            .get(5)
            .copied()
            .unwrap_or("")
            .split(", ")
            .filter(|r| !r.is_empty())
            .map(|r| r.to_string())
            .collect();
        commits.push(GitCommit {
            hash: fields[0].to_string(),
            subject: fields[1].to_string(),
            author: fields[2].to_string(),
            relative_time: fields[3].to_string(),
            refs,
            is_merge: parents.split_whitespace().count() > 1,
        });
    }
    Ok(commits)
}

#[tauri::command]
pub fn git_log(path: String, limit: u32) -> Result<Vec<GitLogCommit>, GitError> {
    let workspace = PathBuf::from(path);
    let n = format!("-n{limit}");
    // 空仓库无提交时 git log 失败，视为空图谱。\x1f 分隔字段、\x1e 分隔提交（body 可含换行）。
    let Ok(text) = git_text(
        &workspace,
        &[
            "log",
            &n,
            "--date=format:%m-%d %H:%M",
            // %h/%p 都用缩写形式,父 hash 才能和子 hash 对上,图谱连线才连得起来(否则只有散点)。
            "--pretty=format:%h%x1f%p%x1f%s%x1f%b%x1f%an%x1f%ad%x1f%cr%x1f%D%x1e",
        ],
    ) else {
        return Ok(Vec::new());
    };

    let mut commits = Vec::new();
    for record in text.split('\u{1e}') {
        let record = record.trim_start_matches('\n');
        if record.trim().is_empty() {
            continue;
        }
        let fields: Vec<&str> = record.split('\u{1f}').collect();
        if fields.len() < 8 {
            continue;
        }
        let parents: Vec<String> = fields[1].split_whitespace().map(|s| s.to_string()).collect();
        let refs = fields[7]
            .split(", ")
            .filter(|r| !r.is_empty())
            .map(|s| s.to_string())
            .collect();
        commits.push(GitLogCommit {
            is_merge: parents.len() > 1,
            hash: fields[0].to_string(),
            parents,
            subject: fields[2].to_string(),
            body: fields[3].trim().to_string(),
            author: fields[4].to_string(),
            date: fields[5].to_string(),
            relative_time: fields[6].to_string(),
            refs,
        });
    }
    Ok(commits)
}

#[tauri::command]
pub fn git_commit_files(path: String, hash: String) -> Result<Vec<GitCommitFile>, GitError> {
    let workspace = PathBuf::from(path);
    let stats = git_commit_file_stats(&workspace, &hash)?;
    let text = git_text(&workspace, &["show", &hash, "--name-status", "--format=", "-M"])?;
    let mut files = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let mut parts = line.split('\t');
        let Some(status_raw) = parts.next() else {
            continue;
        };
        // 普通项 "M\tpath"；重命名 "R100\told\tnew" → 取最后一段。
        let path = parts.last().unwrap_or("").to_string();
        if path.is_empty() {
            continue;
        }
        let (additions, deletions) = stats.get(&path).copied().unwrap_or((0, 0));
        files.push(GitCommitFile {
            status: status_letter(status_raw).to_string(),
            path,
            additions,
            deletions,
        });
    }
    Ok(files)
}

fn git_commit_file_stats(workspace: &Path, hash: &str) -> Result<HashMap<String, (u32, u32)>, GitError> {
    let text = git_text(workspace, &["show", hash, "--numstat", "--format=", "-M"])?;
    Ok(parse_commit_numstat(&text))
}

fn parse_commit_numstat(text: &str) -> HashMap<String, (u32, u32)> {
    let mut stats = HashMap::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let mut parts = line.split('\t');
        let additions = parse_numstat_count(parts.next());
        let deletions = parse_numstat_count(parts.next());
        let Some(path) = parts.last() else {
            continue;
        };
        if path.is_empty() {
            continue;
        }
        stats.insert(normalize_numstat_path(path), (additions, deletions));
    }
    stats
}

fn parse_numstat_count(value: Option<&str>) -> u32 {
    value.and_then(|raw| raw.parse::<u32>().ok()).unwrap_or(0)
}

fn status_letter(raw: &str) -> &'static str {
    match raw.chars().next() {
        Some('A') => "added",
        Some('D') => "deleted",
        Some('R') => "renamed",
        Some('?') => "untracked",
        _ => "modified",
    }
}

#[tauri::command]
pub fn git_branch_divergence(
    path: String,
    branch: String,
    base: Option<String>,
) -> Result<GitDivergence, GitError> {
    let workspace = PathBuf::from(path);
    let base = match base {
        Some(value) if !value.is_empty() => value,
        _ => default_base(&workspace),
    };

    if base.is_empty() || base == branch {
        return Ok(GitDivergence {
            base: None,
            fork_point: None,
            own_commits: Vec::new(),
            base_new_commits: Vec::new(),
            ahead_of_base: 0,
            behind_base: 0,
        });
    }

    let own_commits = log_refs(&workspace, &format!("{base}..{branch}"));
    let base_new_commits = log_refs(&workspace, &format!("{branch}..{base}"));
    let fork_point = merge_base_ref(&workspace, &branch, &base);

    Ok(GitDivergence {
        ahead_of_base: own_commits.len() as u32,
        behind_base: base_new_commits.len() as u32,
        base: Some(base),
        fork_point,
        own_commits,
        base_new_commits,
    })
}

/// 默认基线分支：优先 main，其次 master，否则当前分支。
fn default_base(workspace: &Path) -> String {
    for candidate in ["main", "master"] {
        let exists = git_text(workspace, &["rev-parse", "--verify", "--quiet", candidate])
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);
        if exists {
            return candidate.to_string();
        }
    }
    current_branch(workspace).unwrap_or_default()
}

fn log_refs(workspace: &Path, range: &str) -> Vec<GitCommitRef> {
    let Ok(text) = git_text(workspace, &["log", range, "--pretty=format:%h%x1f%s%x1f%cr"]) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split('\u{1f}').collect();
            (fields.len() >= 3).then(|| GitCommitRef {
                hash: fields[0].to_string(),
                subject: fields[1].to_string(),
                relative_time: fields[2].to_string(),
            })
        })
        .collect()
}

fn merge_base_ref(workspace: &Path, a: &str, b: &str) -> Option<GitCommitRef> {
    let hash = git_text(workspace, &["merge-base", a, b]).ok()?.trim().to_string();
    if hash.is_empty() {
        return None;
    }
    let text = git_text(workspace, &["show", "-s", "--pretty=format:%h%x1f%s%x1f%cr", &hash]).ok()?;
    let fields: Vec<&str> = text.split('\u{1f}').collect();
    (fields.len() >= 3).then(|| GitCommitRef {
        hash: fields[0].to_string(),
        subject: fields[1].to_string(),
        relative_time: fields[2].to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_header_and_changes() {
        let raw = "# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\01 .M N... 100644 100644 100644 aaa bbb src/app.tsx\0? new file.txt\0";
        let result = parse_status(raw.as_bytes());
        assert_eq!(result.branch.as_deref(), Some("main"));
        assert_eq!(result.upstream.as_deref(), Some("origin/main"));
        assert_eq!(result.ahead, 2);
        assert_eq!(result.behind, 1);
        assert_eq!(result.changes.len(), 2);
        assert_eq!(result.changes[0].path, "src/app.tsx");
        assert_eq!(result.changes[0].status, "modified");
        assert_eq!(result.changes[1].path, "new file.txt");
        assert_eq!(result.changes[1].status, "untracked");
    }

    #[test]
    fn parses_rename_with_previous_path() {
        let raw =
            "1 A. N... 0 100644 100644 0 aaa added.txt\02 R. N... 100644 100644 100644 aaa bbb R100 new/name.txt\0old/name.txt\0";
        let result = parse_status(raw.as_bytes());
        assert_eq!(result.changes.len(), 2);
        assert_eq!(result.changes[0].status, "added");
        let rename = &result.changes[1];
        assert_eq!(rename.status, "renamed");
        assert_eq!(rename.path, "new/name.txt");
        assert_eq!(rename.previous_path.as_deref(), Some("old/name.txt"));
    }

    #[test]
    fn numstat_normalizes_rename_paths() {
        let text = "3\t1\tsrc/app.tsx\n5\t0\tsrc/{old => new}/file.ts\n-\t-\timg.png\n";
        let map = parse_numstat(text);
        assert_eq!(map.get("src/app.tsx"), Some(&(3, 1)));
        assert_eq!(map.get("src/new/file.ts"), Some(&(5, 0)));
        assert_eq!(map.get("img.png"), Some(&(0, 0)));
    }

    #[test]
    fn commit_numstat_normalizes_rename_paths() {
        let text = "2\t3\tsrc/app.tsx\n7\t1\tsrc/{old => new}/file.ts\n-\t-\tasset.bin\n";
        let map = parse_commit_numstat(text);
        assert_eq!(map.get("src/app.tsx"), Some(&(2, 3)));
        assert_eq!(map.get("src/new/file.ts"), Some(&(7, 1)));
        assert_eq!(map.get("asset.bin"), Some(&(0, 0)));
    }

    #[test]
    fn parses_track_ahead_behind() {
        assert_eq!(parse_track("[ahead 3, behind 2]"), (3, 2));
        assert_eq!(parse_track("[ahead 1]"), (1, 0));
        assert_eq!(parse_track(""), (0, 0));
    }

    #[test]
    fn status_command_errors_on_non_repository() {
        let temp = tempfile::tempdir().expect("temp dir");
        let result = git_status(temp.path().to_string_lossy().into_owned());
        assert!(result.is_err());
    }
}

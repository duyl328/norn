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
    detached: bool,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktree {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    branch: Option<String>,
    detached: bool,
    is_current: bool,
}

// --- 进程执行 -------------------------------------------------------------

fn run_git(workspace: &Path, args: &[&str]) -> Result<std::process::Output, GitError> {
    let mut cmd = Command::new("git");
    // 强制 C locale：classify() 靠英文 stderr 子串识别错误类型，本地化 git 会让
    // IdentityMissing/NoUpstream/Conflict 等全部塌缩成 Io（含新分支首推无法回退 -u）。
    cmd.env("LC_ALL", "C").env("LANG", "C");
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

/// 校验前端传入的 `file` 是工作区内的相对路径并返回其绝对路径，供文件读写使用
/// （lib.rs 的文件命令有等价校验，git.rs 此前缺失）。两道防线：
/// 1. 词法层先拒绝绝对路径与 `..`/盘符越界；
/// 2. canonicalize 解析符号链接后确认真实落点仍在工作区内——堵住「工作区内 symlink 指向外部」。
///    目标不存在（如已删除文件）时退回校验其父目录，保留「读已删除文件→空」的语义。
fn workspace_file_path(workspace: &Path, file: &str) -> Result<PathBuf, GitError> {
    use std::path::Component;
    let escape = || GitError::new(GitErrorKind::Io, "路径越出工作区范围。");
    let rel = Path::new(file);
    let lexically_escapes = rel.is_absolute()
        || rel
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_)));
    if lexically_escapes {
        return Err(escape());
    }
    let joined = workspace.join(rel);
    let root = workspace
        .canonicalize()
        .map_err(|error| GitError::new(GitErrorKind::Io, error.to_string()))?;
    // 目标存在 → 直接 canonicalize；不存在 → 解析父目录再拼回文件名。
    let resolved = match joined.canonicalize() {
        Ok(real) => real,
        Err(_) => {
            let parent = joined.parent().ok_or_else(escape)?;
            let parent_real = parent
                .canonicalize()
                .map_err(|error| GitError::new(GitErrorKind::Io, error.to_string()))?;
            match joined.file_name() {
                Some(name) => parent_real.join(name),
                None => parent_real,
            }
        }
    };
    if !resolved.starts_with(&root) {
        return Err(escape());
    }
    Ok(joined)
}

/// 返回 `files` 中当前被 .gitignore 忽略的子集。`git check-ignore -q` 命中退出 0、未命中退出 1
/// （均非错误），spawn 失败才返回 Err——这里把任何非「命中」一律当作未忽略，宁可后续 add 报真错。
fn ignored_paths(workspace: &Path, files: &[String]) -> Vec<String> {
    files
        .iter()
        .filter(|file| {
            run_git(workspace, &["check-ignore", "-q", "--", file])
                .map(|out| out.status.success())
                .unwrap_or(false)
        })
        .cloned()
        .collect()
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
    let mut detached = false;
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
                    detached = rest == "(detached)";
                    branch = (!detached).then(|| rest.to_string());
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
        detached,
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
pub async fn git_status(path: String) -> Result<GitStatusResult, GitError> {
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
pub async fn git_file_diff(path: String, file: String) -> Result<String, GitError> {
    let workspace = PathBuf::from(path);
    workspace_file_path(&workspace, &file)?;
    let diff = git_text(&workspace, &["diff", "HEAD", "--", &file])?;
    if !diff.trim().is_empty() {
        return Ok(diff);
    }
    // HEAD 中没有（多为未跟踪文件）→ 用 --no-index 兜底，退出码 1 表示有差异，不算错误。
    let null_device = if cfg!(windows) { "NUL" } else { "/dev/null" };
    let output = run_git(
        &workspace,
        &["diff", "--no-index", "--", null_device, &file],
    )?;
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
pub async fn git_file_versions(path: String, file: String) -> Result<GitFileVersions, GitError> {
    let workspace = PathBuf::from(path);
    let original = run_git(&workspace, &["show", &format!("HEAD:{file}")])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
        .unwrap_or_default();
    let modified =
        std::fs::read_to_string(workspace_file_path(&workspace, &file)?).unwrap_or_default();
    Ok(GitFileVersions { original, modified })
}

/// 取某历史提交里某文件的两个版本:original = 父提交版本(新增 / 根提交时为空),
/// modified = 该提交版本(删除时为空)。供历史页点击文件查看该次改动。
#[tauri::command]
pub async fn git_commit_file_versions(
    path: String,
    hash: String,
    file: String,
) -> Result<GitFileVersions, GitError> {
    let workspace = PathBuf::from(path);
    let show = |spec: String| {
        run_git(&workspace, &["show", "--end-of-options", &spec])
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
pub async fn git_commit(
    path: String,
    message: String,
    push: bool,
    amend: bool,
    files: Vec<String>,
) -> Result<(), GitError> {
    let workspace = PathBuf::from(path);

    // 选中文件里可能含被 .gitignore 忽略的路径:典型场景是刚把已跟踪文件加入忽略(git_ignore_path
    // 做了 rm --cached),其「已暂存删除」仍显示在变更列表里被勾选提交。显式 `git add <被忽略路径>`
    // 会报错中断整条提交,故先识别忽略子集。
    let ignored = if files.is_empty() {
        Vec::new()
    } else {
        ignored_paths(&workspace, &files)
    };

    // 暂存:有选中文件就只暂存这些(剔除被忽略项,避免 add 报错),否则全量。
    if files.is_empty() {
        git_text(&workspace, &["add", "-A"])?;
    } else {
        let to_add: Vec<&str> = files
            .iter()
            .filter(|file| !ignored.iter().any(|ig| ig == *file))
            .map(String::as_str)
            .collect();
        if !to_add.is_empty() {
            let mut args: Vec<&str> = vec!["add", "-A", "--"];
            args.extend(to_add);
            git_text(&workspace, &args)?;
        }
    }

    // 选中项含被忽略的「缓存删除」时不能用 pathspec 偏提交:pathspec 提交按工作区比对,而文件仍在
    // 磁盘上(rm --cached 保留磁盘文件),删除只存在于索引层,偏提交看不到它。此时改走索引提交(无
    // pathspec):索引里恰好是上面 add 的选中项 + git_ignore_path 暂存的删除。
    let use_pathspec = !files.is_empty() && ignored.is_empty();

    // 提交:amend 改写上一条(无新说明则保留原说明)。
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
    if use_pathspec {
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
pub async fn git_ignore_path(path: String, entry: String) -> Result<(), GitError> {
    let workspace = PathBuf::from(path);
    let gitignore = workspace.join(".gitignore");
    let rule = entry.trim();
    if rule.is_empty() {
        return Ok(());
    }
    let mut content = std::fs::read_to_string(&gitignore).unwrap_or_default();
    if !content.lines().any(|line| line.trim() == rule) {
        if !content.is_empty() && !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(rule);
        content.push('\n');
        std::fs::write(&gitignore, content)
            .map_err(|error| GitError::new(GitErrorKind::Io, error.to_string()))?;
    }
    // 已被跟踪的文件加进 .gitignore 不会生效。从索引移除(--cached 保留磁盘文件),
    // 它才会变成「未跟踪 + 被忽略」,落入底部已忽略区;暂存的删除随下次提交落定。
    // --ignore-unmatch:本就是未跟踪的新文件时不报错。
    git_text(
        &workspace,
        &["rm", "-r", "--cached", "--ignore-unmatch", "--", rule],
    )?;
    Ok(())
}

/// 列出被忽略的条目(目录折叠为 dir/,避免 node_modules 之类铺出上千文件)。
#[tauri::command]
pub async fn git_ignored_files(path: String) -> Result<Vec<String>, GitError> {
    let workspace = PathBuf::from(path);
    let text = git_text(
        &workspace,
        &[
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
        ],
    )?;
    Ok(text
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| line.to_string())
        .collect())
}

/// 写入解决冲突后的文件内容,并 git add 标记为已解决。
#[tauri::command]
pub async fn git_resolve_conflict(
    path: String,
    file: String,
    content: String,
) -> Result<(), GitError> {
    let workspace = PathBuf::from(path);
    std::fs::write(workspace_file_path(&workspace, &file)?, content)
        .map_err(|error| GitError::new(GitErrorKind::Io, error.to_string()))?;
    git_text(&workspace, &["add", "--", &file])?;
    Ok(())
}

#[tauri::command]
pub async fn git_push(path: String) -> Result<(), GitError> {
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
pub async fn git_pull(path: String) -> Result<(), GitError> {
    git_text(&PathBuf::from(path), &["pull"])?;
    Ok(())
}

#[tauri::command]
pub async fn git_checkout(path: String, branch: String) -> Result<(), GitError> {
    git_text(&PathBuf::from(path), &["switch", &branch])?;
    Ok(())
}

#[tauri::command]
pub async fn git_create_branch(path: String, name: String) -> Result<(), GitError> {
    git_text(&PathBuf::from(path), &["switch", "-c", &name])?;
    Ok(())
}

/// 从指定提交新建并切换到分支(常用于把「分离 HEAD」固化成一条分支)。
#[tauri::command]
pub async fn git_create_branch_at(
    path: String,
    name: String,
    hash: String,
) -> Result<(), GitError> {
    git_text(
        &PathBuf::from(path),
        &["switch", "-c", &name, "--end-of-options", &hash],
    )?;
    Ok(())
}

/// 把指定分支合并进当前分支。冲突时 git 返回非零 → classify 归为 Conflict,
/// 前端「合并进行中」横幅 + 中止按钮接管后续(已有逻辑)。能快进时即快进。
#[tauri::command]
pub async fn git_merge(path: String, branch: String) -> Result<(), GitError> {
    git_text(
        &PathBuf::from(path),
        &["merge", "--no-edit", "--end-of-options", &branch],
    )?;
    Ok(())
}

/// 检测当前是否有进行中的 revert / merge / cherry-pick(冲突卡住时用)。
#[tauri::command]
pub async fn git_pending_op(path: String) -> Result<String, GitError> {
    let workspace = PathBuf::from(path);
    for (marker, op) in [
        ("REVERT_HEAD", "revert"),
        ("MERGE_HEAD", "merge"),
        ("CHERRY_PICK_HEAD", "cherry-pick"),
    ] {
        if run_git(&workspace, &["rev-parse", "-q", "--verify", marker])
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return Ok(op.to_string());
        }
    }
    Ok(String::new())
}

/// 中止进行中的 revert / merge / cherry-pick,回到操作前的状态。
#[tauri::command]
pub async fn git_abort_op(path: String, op: String) -> Result<(), GitError> {
    let sub = match op.as_str() {
        "merge" => "merge",
        "cherry-pick" => "cherry-pick",
        _ => "revert",
    };
    git_text(&PathBuf::from(path), &[sub, "--abort"])?;
    Ok(())
}

/// 签出某个提交(分离 HEAD)。用于历史里「单独签出此节点」。
#[tauri::command]
pub async fn git_checkout_commit(path: String, hash: String) -> Result<(), GitError> {
    // --detach + --end-of-options：明确按提交分离签出，避免 hash 被当作 flag 或 pathspec
    // （如 hash="." 会丢弃工作区）。
    git_text(
        &PathBuf::from(path),
        &["checkout", "--detach", "--end-of-options", &hash],
    )?;
    Ok(())
}

/// 重置当前分支到某提交。mode: soft(保留改动+暂存)/mixed(保留改动)/hard(丢弃改动)。
#[tauri::command]
pub async fn git_reset(path: String, hash: String, mode: String) -> Result<(), GitError> {
    let flag = match mode.as_str() {
        "soft" => "--soft",
        "hard" => "--hard",
        _ => "--mixed",
    };
    git_text(
        &PathBuf::from(path),
        &["reset", flag, "--end-of-options", &hash],
    )?;
    Ok(())
}

/// 还原某个提交(生成一条反向提交,不改写历史)。
#[tauri::command]
pub async fn git_revert(path: String, hash: String) -> Result<(), GitError> {
    git_text(
        &PathBuf::from(path),
        &["revert", "--no-edit", "--end-of-options", &hash],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn git_init(path: String) -> Result<(), GitError> {
    git_text(&PathBuf::from(path), &["init"])?;
    Ok(())
}

#[tauri::command]
pub async fn git_fetch(path: String) -> Result<(), GitError> {
    git_text(&PathBuf::from(path), &["fetch", "--all", "--prune"])?;
    Ok(())
}

/// 列出本仓库的所有 worktree(含主工作区)。解析 `git worktree list --porcelain`:
/// 每条记录以空行分隔,字段行 `worktree <path>` / `branch refs/heads/<name>` / `detached`。
#[tauri::command]
pub async fn git_worktrees(path: String) -> Result<Vec<GitWorktree>, GitError> {
    let workspace = PathBuf::from(path);
    let here = workspace.canonicalize().ok();
    let text = git_text(&workspace, &["worktree", "list", "--porcelain"])?;

    let mut worktrees = parse_worktrees(&text);
    // is_current:按真实路径 canonicalize 后比较(解析阶段无文件系统访问,放到这里)。
    for worktree in worktrees.iter_mut() {
        worktree.is_current = here
            .as_ref()
            .and_then(|h| {
                PathBuf::from(&worktree.path)
                    .canonicalize()
                    .ok()
                    .map(|c| &c == h)
            })
            .unwrap_or(false);
    }
    Ok(worktrees)
}

/// 纯解析 `git worktree list --porcelain`:记录以 `worktree <path>` 行起始,
/// 跟随 `branch refs/heads/<name>` 或 `detached`。is_current 留待调用方按文件系统判定。
fn parse_worktrees(text: &str) -> Vec<GitWorktree> {
    let mut out = Vec::new();
    let mut wt_path: Option<String> = None;
    let mut branch: Option<String> = None;
    let mut detached = false;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("worktree ") {
            flush_worktree(&mut out, &mut wt_path, &mut branch, &mut detached);
            wt_path = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("branch ") {
            branch = Some(rest.trim_start_matches("refs/heads/").to_string());
        } else if line == "detached" {
            detached = true;
        }
    }
    flush_worktree(&mut out, &mut wt_path, &mut branch, &mut detached);
    out
}

fn flush_worktree(
    out: &mut Vec<GitWorktree>,
    wt_path: &mut Option<String>,
    branch: &mut Option<String>,
    detached: &mut bool,
) {
    if let Some(p) = wt_path.take() {
        out.push(GitWorktree {
            path: p,
            branch: branch.take(),
            detached: *detached,
            is_current: false,
        });
    }
    *detached = false;
}

/// 新建 worktree,返回新工作区的绝对路径(供前端直接打开)。
/// new_branch=true → 用 `-b <branch>` 从 base(默认当前 HEAD)建新分支;否则签出已有分支。
#[tauri::command]
pub async fn git_worktree_add(
    path: String,
    worktree_path: String,
    branch: String,
    new_branch: bool,
    base: Option<String>,
) -> Result<String, GitError> {
    let workspace = PathBuf::from(path);
    let base = base.unwrap_or_default();
    let mut args: Vec<&str> = vec!["worktree", "add"];
    if new_branch {
        args.push("-b");
        args.push(&branch);
        args.push(&worktree_path);
        if !base.is_empty() {
            args.push(&base);
        }
    } else {
        args.push(&worktree_path);
        args.push(&branch);
    }
    git_text(&workspace, &args)?;

    // 解析出绝对路径:相对路径按 git 的行为基于仓库根目录解析。
    let target = PathBuf::from(&worktree_path);
    let abs = if target.is_absolute() {
        target
    } else {
        workspace.join(&target)
    };
    Ok(abs
        .canonicalize()
        .unwrap_or(abs)
        .to_string_lossy()
        .into_owned())
}

/// 删除一个 worktree。force=true 时即使有未提交改动也强删(`--force`)。
#[tauri::command]
pub async fn git_worktree_remove(
    path: String,
    worktree_path: String,
    force: bool,
) -> Result<(), GitError> {
    let mut args: Vec<&str> = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(&worktree_path);
    git_text(&PathBuf::from(path), &args)?;
    Ok(())
}

/// 清理已被手动删除目录的 worktree 登记项(`git worktree prune`)。
#[tauri::command]
pub async fn git_worktree_prune(path: String) -> Result<(), GitError> {
    git_text(&PathBuf::from(path), &["worktree", "prune"])?;
    Ok(())
}

fn current_branch(workspace: &Path) -> Result<String, GitError> {
    Ok(git_text(workspace, &["branch", "--show-current"])?
        .trim()
        .to_string())
}

#[tauri::command]
pub async fn git_branches(path: String) -> Result<GitBranchesResult, GitError> {
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
        let upstream = fields
            .get(1)
            .filter(|v| !v.is_empty())
            .map(|v| v.to_string());
        let (ahead, behind) = parse_track(fields.get(2).copied().unwrap_or(""));
        let current_flag = fields.get(3).copied().unwrap_or("") == "*";
        let last_commit = fields
            .get(4)
            .filter(|v| !v.is_empty())
            .map(|v| v.to_string());
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
        let last_commit = fields
            .get(1)
            .filter(|v| !v.is_empty())
            .map(|v| v.to_string());
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
pub async fn git_recent_commits(path: String, limit: u32) -> Result<Vec<GitCommit>, GitError> {
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
pub async fn git_log(path: String, limit: u32) -> Result<Vec<GitLogCommit>, GitError> {
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
        let parents: Vec<String> = fields[1]
            .split_whitespace()
            .map(|s| s.to_string())
            .collect();
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
pub async fn git_commit_files(path: String, hash: String) -> Result<Vec<GitCommitFile>, GitError> {
    let workspace = PathBuf::from(path);
    let stats = git_commit_file_stats(&workspace, &hash)?;
    let text = git_text(
        &workspace,
        &[
            "show",
            "--name-status",
            "--format=",
            "-M",
            "--end-of-options",
            &hash,
        ],
    )?;
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
        let path = parts.next_back().unwrap_or("").to_string();
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

fn git_commit_file_stats(
    workspace: &Path,
    hash: &str,
) -> Result<HashMap<String, (u32, u32)>, GitError> {
    let text = git_text(
        workspace,
        &[
            "show",
            "--numstat",
            "--format=",
            "-M",
            "--end-of-options",
            hash,
        ],
    )?;
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
        let Some(path) = parts.next_back() else {
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
pub async fn git_branch_divergence(
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
    let Ok(text) = git_text(
        workspace,
        &["log", range, "--pretty=format:%h%x1f%s%x1f%cr"],
    ) else {
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
    let hash = git_text(workspace, &["merge-base", a, b])
        .ok()?
        .trim()
        .to_string();
    if hash.is_empty() {
        return None;
    }
    let text = git_text(
        workspace,
        &[
            "show",
            "-s",
            "--pretty=format:%h%x1f%s%x1f%cr",
            "--end-of-options",
            &hash,
        ],
    )
    .ok()?;
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
        let raw = "# branch.head main\x00# branch.upstream origin/main\x00# branch.ab +2 -1\x001 .M N... 100644 100644 100644 aaa bbb src/app.tsx\x00? new file.txt\x00";
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
            "1 A. N... 0 100644 100644 0 aaa added.txt\x002 R. N... 100644 100644 100644 aaa bbb R100 new/name.txt\x00old/name.txt\x00";
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
    fn parses_worktree_porcelain() {
        let raw = "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo-feat\nHEAD def\nbranch refs/heads/feature/x\n\nworktree /repo-detach\nHEAD 999\ndetached\n";
        let result = parse_worktrees(raw);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].path, "/repo");
        assert_eq!(result[0].branch.as_deref(), Some("main"));
        assert!(!result[0].detached);
        assert_eq!(result[1].branch.as_deref(), Some("feature/x"));
        assert_eq!(result[2].path, "/repo-detach");
        assert_eq!(result[2].branch, None);
        assert!(result[2].detached);
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
        let result =
            tauri::async_runtime::block_on(git_status(temp.path().to_string_lossy().into_owned()));
        assert!(result.is_err());
    }

    // ----- 集成测试：对真实临时仓库逐个验证 IPC 命令 -----------------------
    // 这些测试只验证现有逻辑，不改动任何业务代码。每个测试在独立的 tempdir 里
    // 建仓，命令通过 block_on 直接调用（与上面的非仓库用例同模式）。

    use std::path::{Path, PathBuf};
    use std::process::Command;

    // 仅测试构建可见：让 `Result<_, GitError>` 能 unwrap / 打印失败信息。
    // 不影响生产代码（GitError 本身仍不实现 Debug）。
    impl std::fmt::Debug for GitError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "GitError({})", self.message)
        }
    }

    /// 运行一条 git 命令，要求成功，返回 Output。
    fn sh(dir: &Path, args: &[&str]) -> std::process::Output {
        let out = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .expect("spawn git");
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
        out
    }

    /// 运行 git 命令并返回 trim 后的 stdout。
    fn sh_out(dir: &Path, args: &[&str]) -> String {
        String::from_utf8_lossy(&sh(dir, args).stdout)
            .trim()
            .to_string()
    }

    /// 往工作区写文件（自动建父目录）。
    fn write(dir: &Path, rel: &str, content: &str) {
        let p = dir.join(rel);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(p, content).unwrap();
    }

    /// 读工作区文件内容。
    fn read(dir: &Path, rel: &str) -> String {
        std::fs::read_to_string(dir.join(rel)).unwrap()
    }

    /// 初始化一个隔离配置的仓库（默认分支 main，配好身份、关掉签名与钩子）。
    fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("temp");
        configure(dir.path());
        dir
    }

    fn configure(p: &Path) {
        sh(p, &["init", "-b", "main"]);
        sh(p, &["config", "user.email", "tester@example.com"]);
        sh(p, &["config", "user.name", "Tester"]);
        sh(p, &["config", "commit.gpgsign", "false"]);
        // 屏蔽可能存在的全局钩子，避免环境干扰提交。
        sh(p, &["config", "core.hooksPath", "/dev/null"]);
    }

    fn ws(dir: &tempfile::TempDir) -> String {
        dir.path().to_string_lossy().into_owned()
    }

    /// 用底层 git 直接造一条提交（测试夹具，非被测逻辑）。
    fn commit_file(dir: &Path, rel: &str, content: &str, msg: &str) {
        write(dir, rel, content);
        sh(dir, &["add", "-A"]);
        sh(dir, &["commit", "-m", msg]);
    }

    fn run<F: std::future::Future>(f: F) -> F::Output {
        tauri::async_runtime::block_on(f)
    }

    // --- 仓库初始化 -------------------------------------------------------

    #[test]
    fn init_creates_repo() {
        let dir = tempfile::tempdir().unwrap();
        run(git_init(dir.path().to_string_lossy().into_owned())).unwrap();
        assert!(dir.path().join(".git").exists());
    }

    // --- 状态 -------------------------------------------------------------

    #[test]
    fn status_reports_branch_and_changes() {
        let dir = repo();
        commit_file(dir.path(), "a.txt", "one\n", "init");
        write(dir.path(), "a.txt", "one\ntwo\n"); // 修改已跟踪
        write(dir.path(), "b.txt", "new\n"); // 未跟踪
        let st = run(git_status(ws(&dir))).unwrap();
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert!(!st.detached);
        let a = st.changes.iter().find(|c| c.path == "a.txt").unwrap();
        assert_eq!(a.status, "modified");
        assert_eq!(a.additions, 1);
        assert_eq!(a.deletions, 0);
        let b = st.changes.iter().find(|c| c.path == "b.txt").unwrap();
        assert_eq!(b.status, "untracked");
    }

    // --- 提交 -------------------------------------------------------------

    #[test]
    fn commit_creates_commit() {
        let dir = repo();
        write(dir.path(), "f.txt", "hi\n");
        run(git_commit(ws(&dir), "first".into(), false, false, vec![])).unwrap();
        assert_eq!(sh_out(dir.path(), &["log", "--oneline"]).lines().count(), 1);
        assert_eq!(sh_out(dir.path(), &["log", "-1", "--pretty=%s"]), "first");
    }

    #[test]
    fn commit_only_selected_files() {
        let dir = repo();
        commit_file(dir.path(), "base.txt", "b\n", "init");
        write(dir.path(), "x.txt", "x\n");
        write(dir.path(), "y.txt", "y\n");
        run(git_commit(
            ws(&dir),
            "add x".into(),
            false,
            false,
            vec!["x.txt".into()],
        ))
        .unwrap();
        let st = run(git_status(ws(&dir))).unwrap();
        assert!(st
            .changes
            .iter()
            .any(|c| c.path == "y.txt" && c.status == "untracked"));
        assert!(!st.changes.iter().any(|c| c.path == "x.txt"));
    }

    #[test]
    fn commit_selected_with_ignored_cached_removal() {
        // 复现并验证修复:把已跟踪文件加入忽略后，连同其「已暂存删除」一起选中提交，
        // 不应因 `git add <被忽略路径>` 报错中断，且删除应真正落定到提交里。
        let dir = repo();
        commit_file(dir.path(), "main.txt", "v1\n", "init");
        write(dir.path(), ".idea/workspace.xml", "<x/>\n");
        run(git_commit(
            ws(&dir),
            "track idea".into(),
            false,
            false,
            vec![],
        ))
        .unwrap();
        // 改一个普通文件 + 忽略 .idea（rm --cached 留下「已暂存删除」）。
        write(dir.path(), "main.txt", "v2\n");
        run(git_ignore_path(ws(&dir), ".idea/".into())).unwrap();
        // 选中普通文件 + 被忽略的缓存删除一起提交。
        run(git_commit(
            ws(&dir),
            "edit + ignore idea".into(),
            false,
            false,
            vec!["main.txt".into(), ".idea/workspace.xml".into()],
        ))
        .unwrap();
        // .idea/workspace.xml 不再被跟踪；磁盘文件仍在。
        assert!(sh_out(dir.path(), &["ls-files"])
            .lines()
            .all(|l| l != ".idea/workspace.xml"));
        assert!(dir.path().join(".idea/workspace.xml").exists());
        // main.txt 的改动已进入本次提交。
        assert_eq!(sh_out(dir.path(), &["show", "HEAD:main.txt"]), "v2");
    }

    #[test]
    fn commit_nothing_errors_with_kind() {
        let dir = repo();
        commit_file(dir.path(), "a.txt", "a\n", "init");
        let err = run(git_commit(ws(&dir), "noop".into(), false, false, vec![])).unwrap_err();
        assert!(matches!(err.kind, GitErrorKind::NothingToCommit));
    }

    #[test]
    fn commit_amend_rewrites_message() {
        let dir = repo();
        commit_file(dir.path(), "a.txt", "a\n", "orig msg");
        write(dir.path(), "b.txt", "b\n");
        run(git_commit(
            ws(&dir),
            "amended msg".into(),
            false,
            true,
            vec![],
        ))
        .unwrap();
        assert_eq!(sh_out(dir.path(), &["log", "--oneline"]).lines().count(), 1);
        assert_eq!(
            sh_out(dir.path(), &["log", "-1", "--pretty=%s"]),
            "amended msg"
        );
        // amend 应把新文件并入这一条提交。
        assert!(sh_out(dir.path(), &["ls-files"]).contains("b.txt"));
    }

    // --- diff / 版本 ------------------------------------------------------

    #[test]
    fn file_diff_tracked_and_untracked() {
        let dir = repo();
        commit_file(dir.path(), "a.txt", "one\n", "init");
        write(dir.path(), "a.txt", "one\ntwo\n");
        let d = run(git_file_diff(ws(&dir), "a.txt".into())).unwrap();
        assert!(d.contains("+two"), "tracked diff: {d}");
        write(dir.path(), "u.txt", "fresh\n");
        let d2 = run(git_file_diff(ws(&dir), "u.txt".into())).unwrap();
        assert!(d2.contains("+fresh"), "untracked diff: {d2}");
    }

    #[test]
    fn file_versions_head_vs_working() {
        let dir = repo();
        commit_file(dir.path(), "a.txt", "head\n", "init");
        write(dir.path(), "a.txt", "work\n");
        let v = run(git_file_versions(ws(&dir), "a.txt".into())).unwrap();
        assert_eq!(v.original, "head\n");
        assert_eq!(v.modified, "work\n");
    }

    #[test]
    fn commit_file_versions_parent_vs_commit() {
        let dir = repo();
        commit_file(dir.path(), "a.txt", "v1\n", "c1");
        commit_file(dir.path(), "a.txt", "v2\n", "c2");
        let hash = sh_out(dir.path(), &["rev-parse", "HEAD"]);
        let v = run(git_commit_file_versions(ws(&dir), hash, "a.txt".into())).unwrap();
        assert_eq!(v.original, "v1\n");
        assert_eq!(v.modified, "v2\n");
    }

    #[test]
    fn file_commands_reject_workspace_escape() {
        let dir = repo();
        commit_file(dir.path(), "a.txt", "x\n", "init");
        // 绝对路径与 .. 越界都应被拒绝，而非读/写工作区外的文件。
        for bad in ["../escape.txt", "/etc/hosts"] {
            assert!(
                run(git_file_versions(ws(&dir), bad.into())).is_err(),
                "versions {bad}"
            );
            assert!(
                run(git_file_diff(ws(&dir), bad.into())).is_err(),
                "diff {bad}"
            );
            assert!(
                run(git_resolve_conflict(ws(&dir), bad.into(), "pwned".into())).is_err(),
                "resolve {bad}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn file_commands_reject_symlink_escape() {
        use std::os::unix::fs::symlink;
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), "secret\n").unwrap();
        let dir = repo();
        commit_file(dir.path(), "a.txt", "x\n", "init");
        // 工作区内一个名为 link 的符号链接指向工作区外的真实文件。
        symlink(outside.path().join("secret.txt"), dir.path().join("link")).unwrap();
        // 词法上是合法相对路径，但 canonicalize 后落在工作区外 → 必须拒绝读/写。
        assert!(run(git_file_versions(ws(&dir), "link".into())).is_err());
        assert!(run(git_resolve_conflict(
            ws(&dir),
            "link".into(),
            "pwned".into()
        ))
        .is_err());
        // 工作区外的文件内容未被改写。
        assert_eq!(
            std::fs::read_to_string(outside.path().join("secret.txt")).unwrap(),
            "secret\n"
        );
    }

    // --- ignore -----------------------------------------------------------

    #[test]
    fn ignore_path_appends_dedups_and_untracks() {
        let dir = repo();
        commit_file(dir.path(), "tracked.log", "x\n", "init");
        run(git_ignore_path(ws(&dir), "*.log".into())).unwrap();
        assert!(read(dir.path(), ".gitignore").contains("*.log"));
        run(git_ignore_path(ws(&dir), "*.log".into())).unwrap(); // 第二次不应重复
        assert_eq!(read(dir.path(), ".gitignore").matches("*.log").count(), 1);
        // 已跟踪文件应被从索引移除（暂存的删除）。
        let st = run(git_status(ws(&dir))).unwrap();
        assert!(st
            .changes
            .iter()
            .any(|c| c.path == "tracked.log" && c.status == "deleted"));
    }

    #[test]
    fn ignored_files_lists_ignored() {
        let dir = repo();
        write(dir.path(), ".gitignore", "secret.txt\n");
        write(dir.path(), "secret.txt", "x\n");
        let list = run(git_ignored_files(ws(&dir))).unwrap();
        assert!(list.iter().any(|f| f == "secret.txt"), "list: {list:?}");
    }

    // --- 冲突解决 ---------------------------------------------------------

    #[test]
    fn resolve_conflict_writes_and_stages() {
        let dir = repo();
        commit_file(dir.path(), "a.txt", "a\n", "init");
        run(git_resolve_conflict(
            ws(&dir),
            "a.txt".into(),
            "resolved\n".into(),
        ))
        .unwrap();
        assert_eq!(read(dir.path(), "a.txt"), "resolved\n");
        assert!(sh_out(dir.path(), &["diff", "--cached", "--name-only"]).contains("a.txt"));
    }

    // --- 分支 -------------------------------------------------------------

    #[test]
    fn branch_create_checkout_and_at() {
        let dir = repo();
        commit_file(dir.path(), "a.txt", "a\n", "c1");
        run(git_create_branch(ws(&dir), "feature".into())).unwrap();
        assert_eq!(sh_out(dir.path(), &["branch", "--show-current"]), "feature");
        run(git_checkout(ws(&dir), "main".into())).unwrap();
        assert_eq!(sh_out(dir.path(), &["branch", "--show-current"]), "main");
        let hash = sh_out(dir.path(), &["rev-parse", "HEAD"]);
        run(git_create_branch_at(ws(&dir), "fromhash".into(), hash)).unwrap();
        assert_eq!(
            sh_out(dir.path(), &["branch", "--show-current"]),
            "fromhash"
        );
    }

    #[test]
    fn branches_reports_local_remote_current_and_track() {
        let origin = tempfile::tempdir().unwrap();
        sh(origin.path(), &["init", "--bare", "-b", "main"]);
        let dir = repo();
        commit_file(dir.path(), "a.txt", "1\n", "c1");
        let o = origin.path().to_string_lossy().into_owned();
        sh(dir.path(), &["remote", "add", "origin", o.as_str()]);
        sh(dir.path(), &["push", "-u", "origin", "main"]);
        sh(dir.path(), &["branch", "feature"]);
        commit_file(dir.path(), "b.txt", "b\n", "c2"); // 让 main 领先 origin 一条
        let br = run(git_branches(ws(&dir))).unwrap();
        assert_eq!(br.current.as_deref(), Some("main"));
        let main = br.local.iter().find(|b| b.name == "main").unwrap();
        assert!(main.current);
        assert_eq!(main.upstream.as_deref(), Some("origin/main"));
        assert_eq!(main.ahead, 1);
        assert!(br.local.iter().any(|b| b.name == "feature"));
        assert!(br.remote.iter().any(|b| b.name == "origin/main"));
    }

    // --- 合并 / 进行中操作 ------------------------------------------------

    #[test]
    fn merge_fast_forward() {
        let dir = repo();
        commit_file(dir.path(), "a.txt", "a\n", "c1");
        sh(dir.path(), &["checkout", "-b", "feature"]);
        commit_file(dir.path(), "b.txt", "b\n", "c2");
        sh(dir.path(), &["checkout", "main"]);
        run(git_merge(ws(&dir), "feature".into())).unwrap();
        assert!(dir.path().join("b.txt").exists());
    }

    #[test]
    fn merge_conflict_pending_and_abort() {
        let dir = repo();
        commit_file(dir.path(), "a.txt", "base\n", "c1");
        sh(dir.path(), &["checkout", "-b", "feature"]);
        write(dir.path(), "a.txt", "feature\n");
        sh(dir.path(), &["commit", "-am", "fc"]);
        sh(dir.path(), &["checkout", "main"]);
        write(dir.path(), "a.txt", "main\n");
        sh(dir.path(), &["commit", "-am", "mc"]);
        let err = run(git_merge(ws(&dir), "feature".into())).unwrap_err();
        assert!(matches!(err.kind, GitErrorKind::Conflict));
        assert_eq!(run(git_pending_op(ws(&dir))).unwrap(), "merge");
        run(git_abort_op(ws(&dir), "merge".into())).unwrap();
        assert_eq!(run(git_pending_op(ws(&dir))).unwrap(), "");
    }

    // --- 历史导航：签出 / 重置 / 还原 ------------------------------------

    #[test]
    fn checkout_commit_detaches() {
        let dir = repo();
        commit_file(dir.path(), "a.txt", "1\n", "c1");
        let h1 = sh_out(dir.path(), &["rev-parse", "HEAD"]);
        commit_file(dir.path(), "c.txt", "2\n", "c2");
        run(git_checkout_commit(ws(&dir), h1)).unwrap();
        let st = run(git_status(ws(&dir))).unwrap();
        assert!(st.detached);
        assert_eq!(st.branch, None);
    }

    #[test]
    fn reset_hard_discards_to_commit() {
        let dir = repo();
        commit_file(dir.path(), "a.txt", "1\n", "c1");
        let h1 = sh_out(dir.path(), &["rev-parse", "HEAD"]);
        commit_file(dir.path(), "a.txt", "2\n", "c2");
        run(git_reset(ws(&dir), h1.clone(), "hard".into())).unwrap();
        assert_eq!(read(dir.path(), "a.txt"), "1\n");
        assert_eq!(sh_out(dir.path(), &["rev-parse", "HEAD"]), h1);
    }

    #[test]
    fn reset_soft_keeps_working_and_staged() {
        let dir = repo();
        commit_file(dir.path(), "a.txt", "1\n", "c1");
        let h1 = sh_out(dir.path(), &["rev-parse", "HEAD"]);
        commit_file(dir.path(), "a.txt", "2\n", "c2");
        run(git_reset(ws(&dir), h1.clone(), "soft".into())).unwrap();
        assert_eq!(sh_out(dir.path(), &["rev-parse", "HEAD"]), h1);
        assert_eq!(read(dir.path(), "a.txt"), "2\n"); // 改动保留
        assert!(sh_out(dir.path(), &["diff", "--cached", "--name-only"]).contains("a.txt"));
    }

    #[test]
    fn revert_creates_inverse_commit() {
        let dir = repo();
        commit_file(dir.path(), "a.txt", "base\n", "c1");
        commit_file(dir.path(), "a.txt", "base\nadded\n", "c2");
        let h2 = sh_out(dir.path(), &["rev-parse", "HEAD"]);
        run(git_revert(ws(&dir), h2)).unwrap();
        assert_eq!(read(dir.path(), "a.txt"), "base\n");
        assert_eq!(sh_out(dir.path(), &["log", "--oneline"]).lines().count(), 3);
    }

    // --- 远端：push / pull / fetch（本地裸仓库当 origin）-----------------

    #[test]
    fn push_pull_fetch_with_local_remote() {
        let origin = tempfile::tempdir().unwrap();
        sh(origin.path(), &["init", "--bare", "-b", "main"]);
        let o = origin.path().to_string_lossy().into_owned();

        let dir = repo();
        commit_file(dir.path(), "a.txt", "1\n", "c1");
        sh(dir.path(), &["remote", "add", "origin", o.as_str()]);
        // 无 upstream → push_current 应回退到 `push -u origin main`。
        run(git_push(ws(&dir))).unwrap();
        assert_eq!(
            sh_out(origin.path(), &["rev-parse", "main"]),
            sh_out(dir.path(), &["rev-parse", "HEAD"])
        );

        run(git_fetch(ws(&dir))).unwrap();

        // 第二个克隆推一条新提交，验证 pull 能拉回。
        let two = tempfile::tempdir().unwrap();
        let st = Command::new("git")
            .args(["clone", o.as_str(), two.path().to_string_lossy().as_ref()])
            .output()
            .unwrap();
        assert!(
            st.status.success(),
            "clone: {}",
            String::from_utf8_lossy(&st.stderr)
        );
        sh(two.path(), &["config", "user.email", "t2@example.com"]);
        sh(two.path(), &["config", "user.name", "T2"]);
        sh(two.path(), &["config", "commit.gpgsign", "false"]);
        sh(two.path(), &["config", "core.hooksPath", "/dev/null"]);
        commit_file(two.path(), "fromclone.txt", "c\n", "from clone2");
        sh(two.path(), &["push"]);

        run(git_pull(ws(&dir))).unwrap();
        assert!(dir.path().join("fromclone.txt").exists());
    }

    // --- worktree ---------------------------------------------------------

    #[test]
    fn worktree_add_list_remove_prune() {
        let dir = repo();
        commit_file(dir.path(), "a.txt", "1\n", "c1");
        let parent = tempfile::tempdir().unwrap();
        let wt = parent
            .path()
            .join("wt-feature")
            .to_string_lossy()
            .into_owned();

        let abs = run(git_worktree_add(
            ws(&dir),
            wt.clone(),
            "feature".into(),
            true,
            None,
        ))
        .unwrap();
        assert!(PathBuf::from(&abs).join("a.txt").exists());

        let list = run(git_worktrees(ws(&dir))).unwrap();
        assert!(list.iter().any(|w| w.branch.as_deref() == Some("feature")));
        assert!(list.iter().any(|w| w.is_current)); // 主工作区应标记为当前

        run(git_worktree_remove(ws(&dir), wt.clone(), false)).unwrap();
        run(git_worktree_prune(ws(&dir))).unwrap();
        let list2 = run(git_worktrees(ws(&dir))).unwrap();
        assert!(!list2.iter().any(|w| w.branch.as_deref() == Some("feature")));
    }

    // --- 提交列表 / 图谱 / 文件 ------------------------------------------

    #[test]
    fn recent_commits_limit_and_merge_flag() {
        let dir = merged_history();
        let commits = run(git_recent_commits(ws(&dir), 10)).unwrap();
        assert!(commits.len() >= 4, "got {}", commits.len());
        assert_eq!(commits[0].subject, "merge feature");
        assert!(commits[0].is_merge);
        assert_eq!(run(git_recent_commits(ws(&dir), 2)).unwrap().len(), 2);
    }

    #[test]
    fn log_reports_parents_and_merge() {
        let dir = merged_history();
        let log = run(git_log(ws(&dir), 10)).unwrap();
        let merge = log.iter().find(|c| c.subject == "merge feature").unwrap();
        assert!(merge.is_merge);
        assert_eq!(merge.parents.len(), 2);
    }

    /// 造一段带合并提交的历史，供 recent_commits / log 复用。
    fn merged_history() -> tempfile::TempDir {
        let dir = repo();
        commit_file(dir.path(), "a.txt", "1\n", "c1");
        sh(dir.path(), &["checkout", "-b", "feature"]);
        commit_file(dir.path(), "b.txt", "b\n", "c2");
        sh(dir.path(), &["checkout", "main"]);
        commit_file(dir.path(), "c.txt", "c\n", "c3");
        sh(
            dir.path(),
            &["merge", "--no-ff", "-m", "merge feature", "feature"],
        );
        dir
    }

    #[test]
    fn commit_files_status_and_stats() {
        let dir = repo();
        commit_file(dir.path(), "keep.txt", "k\n", "c1");
        commit_file(dir.path(), "del.txt", "d\n", "add del");
        write(dir.path(), "keep.txt", "k\nmore\n");
        std::fs::remove_file(dir.path().join("del.txt")).unwrap();
        write(dir.path(), "added.txt", "new\n");
        sh(dir.path(), &["add", "-A"]);
        sh(dir.path(), &["commit", "-m", "mix"]);
        let h = sh_out(dir.path(), &["rev-parse", "HEAD"]);
        let files = run(git_commit_files(ws(&dir), h)).unwrap();
        let get = |p: &str| files.iter().find(|f| f.path == p).unwrap();
        assert_eq!(get("keep.txt").status, "modified");
        assert_eq!(get("keep.txt").additions, 1);
        assert_eq!(get("del.txt").status, "deleted");
        assert_eq!(get("added.txt").status, "added");
    }

    // --- 分支分叉 ---------------------------------------------------------

    #[test]
    fn branch_divergence_counts_ahead_behind() {
        let dir = repo();
        commit_file(dir.path(), "a.txt", "1\n", "c1");
        sh(dir.path(), &["checkout", "-b", "feature"]);
        commit_file(dir.path(), "f1.txt", "f1\n", "feat1");
        commit_file(dir.path(), "f2.txt", "f2\n", "feat2");
        sh(dir.path(), &["checkout", "main"]);
        commit_file(dir.path(), "m1.txt", "m1\n", "main2");
        // 显式 base，以及默认 base（应解析为 main）两种都验。
        for base in [Some("main".to_string()), None] {
            let div = run(git_branch_divergence(ws(&dir), "feature".into(), base)).unwrap();
            assert_eq!(div.ahead_of_base, 2);
            assert_eq!(div.behind_base, 1);
            assert_eq!(div.base.as_deref(), Some("main"));
            assert!(div.fork_point.is_some());
            assert_eq!(div.own_commits.len(), 2);
            assert_eq!(div.base_new_commits.len(), 1);
        }
    }
}

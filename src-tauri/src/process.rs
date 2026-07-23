//! 子进程创建的统一入口。
//!
//! release 构建下 `norn.exe` 是 GUI 子系统进程（见 main.rs 的 `windows_subsystem`），
//! 自身不附着控制台。此时 spawn `git.exe` / `cmd.exe` 这类 console 子系统程序，
//! Windows 会为每个子进程新分配一个控制台窗口——表现为启动时一片黑框闪烁。
//! 因此除「用户主动要求开终端」外，所有子进程一律走 `hidden_command`。
//!
//! dev 构建（console 子系统，子进程继承父控制台）复现不出该问题，改动需在打包产物上验证。

use std::process::Command;

/// 不弹控制台窗口的子进程。用于所有后台调用（git、explorer、start 等）。
pub fn hidden_command(program: &str) -> Command {
    let command = Command::new(program);
    #[cfg(target_os = "windows")]
    let command = {
        let mut command = command;
        use std::os::windows::process::CommandExt;
        // winbase.h: CREATE_NO_WINDOW
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
        command
    };
    command
}

/// 显式给用户开一个新控制台窗口。仅用于 `open_terminal_at`——
/// 那里窗口本身就是用户要的结果，套 CREATE_NO_WINDOW 会让终端根本开不出来。
#[cfg(target_os = "windows")]
pub fn console_command(program: &str) -> Command {
    use std::os::windows::process::CommandExt;
    // winbase.h: CREATE_NEW_CONSOLE。不继承父进程控制台（GUI 进程也没有），自己开一个。
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NEW_CONSOLE);
    command
}

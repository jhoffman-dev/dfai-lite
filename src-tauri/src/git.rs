//! Runs the Mac's own `git` in the open vault, with fixed argument shapes
//! only. The webview names a command; this file alone turns it into
//! arguments, so a note's name never becomes an option. No shell, no prompt,
//! a time limit that stops git and everything it started. The output goes
//! back untouched: what it means is decided in TypeScript.

use std::fs::{self, OpenOptions};
use std::io::Read;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::files::EXISTS;
use crate::paths::{git_path, inside};
use crate::vault::VaultRoot;

/// Where `git` is looked for, in order: Homebrew's, then Apple's.
const GIT_DIRS: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
/// What a run's PATH ends with, after the folder git was found in.
const SYSTEM_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";
/// The host's variables a run is handed: the home folder (git's own config and
/// credential helper), the ssh agent, the account, and the temp folder.
const PASSED_ENV: &[&str] = &["HOME", "SSH_AUTH_SOCK", "USER", "LOGNAME", "TMPDIR"];
/// Nothing ever waits on a prompt nobody can see or on a silent network, and
/// git speaks English, so TypeScript can tell a refused login from an
/// unreachable remote. `GIT_SSH_COMMAND` wins over `core.sshCommand`.
const QUIET_ENV: &[(&str, &str)] = &[
    ("GIT_TERMINAL_PROMPT", "0"),
    ("GCM_INTERACTIVE", "never"),
    (
        "GIT_SSH_COMMAND",
        "ssh -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=2",
    ),
    ("LC_ALL", "C"),
];
/// Before every command: no hook or fsmonitor program runs, no `ext::`
/// remote, paths come back as spelled, nothing signs or rewrites line
/// endings, a merge is a merge, a push goes to the branch's upstream, and a
/// path is always a literal path. `git-shapes.json` holds the same list.
const FIXED_PREFIX: &[&str] = &[
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.quotePath=false",
    "-c",
    "protocol.ext.allow=never",
    "-c",
    "color.ui=never",
    "-c",
    "commit.gpgSign=false",
    "-c",
    "merge.ff=true",
    "-c",
    "core.autocrlf=false",
    "-c",
    "merge.conflictStyle=merge",
    "-c",
    "push.default=upstream",
    "--literal-pathspecs",
    "--no-optional-locks",
];
const LOCAL_LIMIT: Duration = Duration::from_secs(60);
const NETWORK_LIMIT: Duration = Duration::from_secs(120);
/// How long output is waited for after git ends: a helper it left behind may hold the pipe.
const PIPE_GRACE: Duration = Duration::from_secs(1);
const POLL: Duration = Duration::from_millis(5);

/// The commands TypeScript may run: every shape there is.
#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum GitCommand {
    IsRepo,
    Status,
    AddAll,
    Commit {
        message: String,
    },
    Fetch,
    Merge {
        message: String,
    },
    Push,
    /// Whether a merge, cherry-pick, revert or rebase waits to be finished.
    RefExists {
        name: SpecialRef,
    },
    /// One side of a conflicted file, as git holds it.
    ShowSide {
        side: Side,
        path: String,
    },
    /// One side of a conflicted file, byte for byte, into a new file `to`.
    SaveSide {
        side: Side,
        path: String,
        to: String,
    },
    CheckoutOurs {
        path: String,
    },
    /// Tells git a tracked file's name changed only in case.
    MoveCase {
        from: String,
        to: String,
    },
    TrackedFiles,
    UpstreamMessage,
    RemoteUrl,
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Ours,
    Theirs,
}

#[derive(Deserialize, Debug, Clone, Copy)]
pub enum SpecialRef {
    #[serde(rename = "MERGE_HEAD")]
    Merge,
    #[serde(rename = "CHERRY_PICK_HEAD")]
    CherryPick,
    #[serde(rename = "REVERT_HEAD")]
    Revert,
    #[serde(rename = "REBASE_HEAD")]
    Rebase,
}

impl SpecialRef {
    fn name(self) -> &'static str {
        match self {
            SpecialRef::Merge => "MERGE_HEAD",
            SpecialRef::CherryPick => "CHERRY_PICK_HEAD",
            SpecialRef::Revert => "REVERT_HEAD",
            SpecialRef::Rebase => "REBASE_HEAD",
        }
    }
}

#[derive(Serialize, Debug)]
pub struct GitOutput {
    /// None when the run was stopped at its time limit.
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

fn fixed(args: &[&str]) -> Vec<String> {
    args.iter().map(|arg| arg.to_string()).collect()
}

fn with(mut args: Vec<String>, more: &[&str]) -> Vec<String> {
    args.extend(more.iter().map(|arg| arg.to_string()));
    args
}

fn stage(side: Side) -> u8 {
    if side == Side::Ours {
        2
    } else {
        3
    }
}

/// The arguments after the fixed prefix, or why the command is refused.
pub fn args_of(command: &GitCommand) -> Result<Vec<String>, String> {
    Ok(match command {
        GitCommand::IsRepo => fixed(&["rev-parse", "--is-inside-work-tree"]),
        GitCommand::Status => fixed(&[
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
        ]),
        GitCommand::AddAll => fixed(&["add", "--all"]),
        GitCommand::Commit { message } => with(
            fixed(&["commit", "--quiet", "--no-verify"]),
            &[&format!("--message={}", plain_message(message)?)],
        ),
        GitCommand::Fetch => fixed(&["fetch", "--quiet"]),
        GitCommand::Merge { message } => with(
            fixed(&["merge", "--no-edit", "--no-stat"]),
            &[
                &format!("--message={}", plain_message(message)?),
                "@{upstream}",
            ],
        ),
        GitCommand::Push => fixed(&["push", "--quiet"]),
        GitCommand::RefExists { name } => fixed(&["rev-parse", "-q", "--verify", name.name()]),
        GitCommand::ShowSide { side, path } | GitCommand::SaveSide { side, path, .. } => {
            git_path(path)?;
            // `:2:<path>` starts with a colon: git never reads it as an option.
            with(
                fixed(&["cat-file", "blob"]),
                &[&format!(":{}:{path}", stage(*side))],
            )
        }
        GitCommand::CheckoutOurs { path } => {
            git_path(path)?;
            with(fixed(&["checkout", "--ours", "--"]), &[path])
        }
        GitCommand::MoveCase { from, to } => {
            git_path(from)?;
            git_path(to)?;
            if from == to || from.to_lowercase() != to.to_lowercase() {
                return Err("a case move changes only the case of a name".to_string());
            }
            with(fixed(&["mv", "--"]), &[from, to])
        }
        GitCommand::TrackedFiles => fixed(&["ls-files", "-z"]),
        GitCommand::UpstreamMessage => fixed(&["log", "-1", "--format=%B", "@{upstream}", "--"]),
        GitCommand::RemoteUrl => fixed(&["ls-remote", "--get-url"]),
    })
}

fn plain_message(message: &str) -> Result<&str, String> {
    if message.trim().is_empty() || message.contains('\0') {
        return Err("a commit message must be plain text".to_string());
    }
    Ok(message)
}

fn reaches_network(command: &GitCommand) -> bool {
    matches!(command, GitCommand::Fetch | GitCommand::Push)
}

/// The first executable `git` in `dirs`, and the PATH a run gets.
fn locate(dirs: &[&str]) -> Result<(PathBuf, String), String> {
    let program = dirs
        .iter()
        .map(|dir| Path::new(dir).join("git"))
        .find(|candidate| {
            candidate
                .metadata()
                .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        })
        .ok_or_else(|| format!("git is not installed: none in {}", dirs.join(", ")))?;
    let mut path: Vec<&str> = dirs.to_vec();
    path.push(SYSTEM_PATH);
    Ok((program, path.join(":")))
}

/// Where `saveSide` writes: a new file inside the vault, never one already there or through a link.
fn side_file(root: &Path, to: &str) -> Result<fs::File, String> {
    let target = inside(root, to)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("cannot make a folder: {error}"))?;
    }
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&target)
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::AlreadyExists => format!("{EXISTS} a file is already at {to}"),
            _ => format!("cannot create {to}: {error}"),
        })
}

pub fn run(root: &Path, command: &GitCommand) -> Result<GitOutput, String> {
    let args = args_of(command)?;
    let (program, path) = locate(GIT_DIRS)?;
    let mut git = Command::new(program);
    git.env_clear().env("PATH", path);
    for name in PASSED_ENV {
        if let Some(value) = std::env::var_os(name) {
            git.env(name, value);
        }
    }
    // A vault that is not a repository is never taken for part of one around it.
    if let Some(parent) = root.parent() {
        git.env("GIT_CEILING_DIRECTORIES", parent);
    }
    let stdout = match command {
        GitCommand::SaveSide { to, .. } => Stdio::from(side_file(root, to)?),
        _ => Stdio::piped(),
    };
    git.envs(QUIET_ENV.iter().copied())
        .args(FIXED_PREFIX)
        .args(&args)
        .current_dir(root)
        .stdout(stdout);
    let limit = if reaches_network(command) {
        NETWORK_LIMIT
    } else {
        LOCAL_LIMIT
    };
    Ok(run_limited(git, limit))
}

/// Runs the program in a process group of its own, so the time limit stops
/// it and everything it started (ssh, a credential helper); output is read
/// only until the limit, plus a moment.
pub fn run_limited(mut command: Command, limit: Duration) -> GitOutput {
    let spawned = command
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn();
    match spawned {
        Ok(child) => collect(child, limit),
        Err(error) => GitOutput {
            code: Some(127),
            stdout: String::new(),
            stderr: format!("cannot start git: {error}"),
        },
    }
}

fn read_into(pipe: Option<impl Read + Send + 'static>) -> Receiver<String> {
    let (send, receive) = channel();
    if let Some(mut pipe) = pipe {
        thread::spawn(move || {
            let mut bytes = Vec::new();
            // A read error ends the output early; the exit code says whether git failed.
            let _ = pipe.read_to_end(&mut bytes);
            // Nobody listening means the run was given up on; the text is not needed.
            let _ = send.send(String::from_utf8_lossy(&bytes).into_owned());
        });
    } else {
        // No pipe (stdout went to a file): nothing to read.
        let _ = send.send(String::new());
    }
    receive
}

fn collect(mut child: Child, limit: Duration) -> GitOutput {
    let stdout = read_into(child.stdout.take());
    let stderr = read_into(child.stderr.take());
    let deadline = Instant::now() + limit;
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) if Instant::now() < deadline => thread::sleep(POLL),
            _ => break None,
        }
    };
    if code.is_none() {
        kill_group(&mut child);
    }
    let until = deadline.min(Instant::now()) + PIPE_GRACE;
    let take = |receive: Receiver<String>| {
        receive
            .recv_timeout(until.saturating_duration_since(Instant::now()))
            .unwrap_or_default()
    };
    let mut output = GitOutput {
        code,
        stdout: take(stdout),
        stderr: take(stderr),
    };
    if code.is_none() {
        output
            .stderr
            .push_str(&format!("\nDFAI Lite stopped git after {limit:?}."));
    }
    output
}

/// Stops the program and every process in its group.
fn kill_group(child: &mut Child) {
    if let Ok(group) = i32::try_from(child.id()) {
        // SAFETY: kill(2) with a negative pid signals that process group and
        // touches no memory. The group is the child's own (`process_group(0)`)
        // and the child is not reaped yet, so the id is still its.
        unsafe {
            libc::kill(-group, libc::SIGKILL);
        }
    }
    // Fails only when it has already exited, which is what was wanted.
    let _ = child.kill();
    let _ = child.wait();
}

/// This Mac's name as Sharing shows it, for commit messages and conflict copies.
fn computer_name() -> String {
    let asked = |program: &str, args: &[&str]| {
        Command::new(program)
            .args(args)
            .env_clear()
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
            .filter(|name| !name.is_empty())
    };
    asked("/usr/sbin/scutil", &["--get", "ComputerName"])
        .or_else(|| asked("/bin/hostname", &["-s"]))
        .unwrap_or_else(|| "this Mac".to_string())
}

#[tauri::command]
pub async fn git_run(root: State<'_, VaultRoot>, command: GitCommand) -> Result<GitOutput, String> {
    let root = root.get()?;
    tauri::async_runtime::spawn_blocking(move || run(&root, &command))
        .await
        .map_err(|error| format!("the git run did not finish: {error}"))?
}

#[tauri::command]
pub async fn mac_name() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(computer_name)
        .await
        .map_err(|error| format!("cannot read this Mac's name: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_folder;

    #[derive(Deserialize)]
    struct Shapes {
        prefix: Vec<String>,
        commands: Vec<Shape>,
    }

    #[derive(Deserialize)]
    struct Shape {
        command: GitCommand,
        args: Vec<String>,
    }

    #[test]
    fn the_shapes_match_the_file_the_node_adapter_reads_too() {
        let shapes: Shapes = serde_json::from_str(include_str!("../git-shapes.json")).unwrap();
        assert_eq!(shapes.prefix, FIXED_PREFIX);
        for shape in shapes.commands {
            assert_eq!(
                args_of(&shape.command).unwrap(),
                shape.args,
                "{:?}",
                shape.command
            );
        }
    }

    #[test]
    fn a_path_into_git_s_folder_an_odd_case_move_or_an_empty_message_is_refused() {
        let refused = [
            r#"{"kind":"checkoutOurs","path":"../x.md"}"#,
            r#"{"kind":"checkoutOurs","path":".GIT/config"}"#,
            r#"{"kind":"moveCase","from":"a.md","to":"b.md"}"#,
            r#"{"kind":"commit","message":" "}"#,
        ];
        for json in refused {
            let command: GitCommand = serde_json::from_str(json).unwrap();
            assert!(args_of(&command).is_err(), "{json}");
        }
    }

    #[test]
    fn only_the_known_shapes_deserialize() {
        for json in [
            r#"{"kind":"reset"}"#,
            r#"{"kind":"showSide","side":"base","path":"a.md"}"#,
            r#"{"kind":"refExists","name":"HEAD"}"#,
        ] {
            assert!(serde_json::from_str::<GitCommand>(json).is_err(), "{json}");
        }
    }

    #[test]
    fn git_runs_in_the_vault_and_says_when_it_is_not_a_repository() {
        let root = temp_folder();
        let output = run(&root, &GitCommand::IsRepo).unwrap();
        assert_ne!(output.code, Some(0));
        assert!(
            output.stderr.contains("not a git repository"),
            "{}",
            output.stderr
        );
    }

    #[test]
    fn the_time_limit_stops_what_git_started_even_when_it_holds_the_pipes() {
        // A child that leaves a grandchild holding stderr: stopping only the
        // child would leave the read waiting for the grandchild.
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", "sleep 30 >&2 & sleep 30"])
            .stdout(Stdio::piped());
        let started = Instant::now();
        let output = run_limited(command, Duration::from_millis(200));
        assert_eq!(output.code, None);
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "{:?}",
            started.elapsed()
        );
        assert!(output.stderr.contains("stopped git"), "{}", output.stderr);
    }

    #[test]
    fn git_is_found_where_a_mac_or_linux_keeps_it() {
        let (program, path) = locate(GIT_DIRS).unwrap();
        assert!(program.ends_with("git"));
        assert!(path.ends_with(SYSTEM_PATH));
        assert!(locate(&["/nowhere"]).is_err());
    }
}

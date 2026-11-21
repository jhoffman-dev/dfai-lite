//! Runs the Mac's own `git` in the open vault, with fixed argument shapes
//! only. The webview names a command; this file alone turns it into
//! arguments, so a note's name never becomes an option. No shell, no prompt,
//! a time limit. The output goes back untouched: what it means is decided in
//! TypeScript.

use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::vault::{inside, VaultRoot};

/// Where `git` is looked for, in order: Homebrew's, then Apple's.
const GIT_DIRS: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
/// What a run's PATH ends with, after the folder git was found in.
const SYSTEM_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";
/// The host's variables a run is handed: the home folder (git's own config and
/// credential helper), the ssh agent, the account, and the temp folder.
const PASSED_ENV: &[&str] = &["HOME", "SSH_AUTH_SOCK", "USER", "LOGNAME", "TMPDIR"];
/// Nothing ever waits on a prompt nobody can see, and git speaks English, so
/// TypeScript can tell a refused login from an unreachable remote.
const QUIET_ENV: &[(&str, &str)] = &[
    ("GIT_TERMINAL_PROMPT", "0"),
    ("GCM_INTERACTIVE", "never"),
    ("GIT_SSH_COMMAND", "ssh -o BatchMode=yes"),
    ("LC_ALL", "C"),
];
/// Before every command: no hook or fsmonitor program runs, no `ext::`
/// remote, paths come back as spelled, nothing signs or rewrites line
/// endings, a merge is a merge, a push goes to the branch's upstream, and a
/// path is always a literal path.
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
const POLL: Duration = Duration::from_millis(5);

/// The commands TypeScript may run: every shape there is.
#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
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
    MergeInProgress,
    /// One side of a conflicted file, as git holds it.
    ShowSide {
        side: Side,
        path: String,
    },
    CheckoutOurs {
        path: String,
    },
    UpstreamMessage,
    RemoteUrl,
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Ours,
    Theirs,
}

#[derive(Serialize, Debug)]
pub struct GitOutput {
    /// None when the run was stopped at its time limit.
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

/// The arguments after the fixed prefix, or why the command is refused.
pub fn args_of(command: &GitCommand, root: &Path) -> Result<Vec<String>, String> {
    let fixed = |args: &[&str]| args.iter().map(|arg| arg.to_string()).collect();
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
        GitCommand::Commit { message } => {
            let mut args = fixed(&["commit", "--quiet", "--no-verify"]);
            args.push(format!("--message={}", plain_message(message)?));
            args
        }
        GitCommand::Fetch => fixed(&["fetch", "--quiet"]),
        GitCommand::Merge { message } => {
            let mut args = fixed(&["merge", "--no-edit", "--no-stat"]);
            args.push(format!("--message={}", plain_message(message)?));
            args.push("@{upstream}".to_string());
            args
        }
        GitCommand::Push => fixed(&["push", "--quiet"]),
        GitCommand::MergeInProgress => fixed(&["rev-parse", "-q", "--verify", "MERGE_HEAD"]),
        GitCommand::ShowSide { side, path } => {
            inside(root, path)?;
            let stage = if *side == Side::Ours { 2 } else { 3 };
            // `:2:<path>` starts with a colon: git never reads it as an option.
            vec!["cat-file".into(), "blob".into(), format!(":{stage}:{path}")]
        }
        GitCommand::CheckoutOurs { path } => {
            inside(root, path)?;
            let mut args = fixed(&["checkout", "--ours", "--"]);
            args.push(path.clone());
            args
        }
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

pub fn run(root: &Path, command: &GitCommand) -> Result<GitOutput, String> {
    let args = args_of(command, root)?;
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
    let child = git
        .envs(QUIET_ENV.iter().copied())
        .args(FIXED_PREFIX)
        .args(&args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("cannot start git: {error}"))?;
    let limit = if reaches_network(command) {
        NETWORK_LIMIT
    } else {
        LOCAL_LIMIT
    };
    Ok(collect(child, limit))
}

/// Reads the run to its end, or stops it at `limit`.
fn collect(mut child: Child, limit: Duration) -> GitOutput {
    let stdout = child
        .stdout
        .take()
        .map(|pipe| thread::spawn(|| read_all(pipe)));
    let stderr = child
        .stderr
        .take()
        .map(|pipe| thread::spawn(|| read_all(pipe)));
    let deadline = Instant::now() + limit;
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) if Instant::now() < deadline => thread::sleep(POLL),
            _ => {
                // Fails only when git has exited meanwhile, which is what was wanted.
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let joined = |handle: Option<thread::JoinHandle<String>>| {
        handle.and_then(|h| h.join().ok()).unwrap_or_default()
    };
    let mut output = GitOutput {
        code,
        stdout: joined(stdout),
        stderr: joined(stderr),
    };
    if code.is_none() {
        output
            .stderr
            .push_str(&format!("\nDFAI Lite stopped git after {limit:?}."));
    }
    output
}

fn read_all(mut pipe: impl Read) -> String {
    let mut bytes = Vec::new();
    // A read error ends the output early; the exit code says whether git failed.
    let _ = pipe.read_to_end(&mut bytes);
    String::from_utf8_lossy(&bytes).into_owned()
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

    fn args(command: GitCommand) -> Vec<String> {
        args_of(&command, Path::new("/vault")).unwrap()
    }

    #[test]
    fn a_note_named_like_an_option_stays_a_path() {
        assert_eq!(
            args(GitCommand::CheckoutOurs {
                path: "--force.md".into()
            }),
            ["checkout", "--ours", "--", "--force.md"]
        );
        assert_eq!(
            args(GitCommand::ShowSide {
                side: Side::Theirs,
                path: "-x.md".into()
            }),
            ["cat-file", "blob", ":3:-x.md"]
        );
    }

    #[test]
    fn a_message_is_the_value_of_one_argument() {
        assert_eq!(
            args(GitCommand::Commit {
                message: "--amend".into()
            }),
            ["commit", "--quiet", "--no-verify", "--message=--amend"]
        );
        let merge = args(GitCommand::Merge {
            message: "Notes: merge".into(),
        });
        assert_eq!(merge.last().map(String::as_str), Some("@{upstream}"));
    }

    #[test]
    fn a_path_outside_the_vault_or_an_empty_message_is_refused() {
        let root = Path::new("/vault");
        let escape = GitCommand::CheckoutOurs {
            path: "../x.md".into(),
        };
        assert!(args_of(&escape, root).is_err());
        let blank = GitCommand::Commit {
            message: " ".into(),
        };
        assert!(args_of(&blank, root).is_err());
    }

    #[test]
    fn only_the_known_shapes_deserialize() {
        let known: GitCommand = serde_json::from_str(r#"{"kind":"addAll"}"#).unwrap();
        assert!(matches!(known, GitCommand::AddAll));
        assert!(serde_json::from_str::<GitCommand>(r#"{"kind":"reset"}"#).is_err());
        let extra = r#"{"kind":"showSide","side":"base","path":"a.md"}"#;
        assert!(serde_json::from_str::<GitCommand>(extra).is_err());
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
    fn git_is_found_where_a_mac_or_linux_keeps_it() {
        let (program, path) = locate(GIT_DIRS).unwrap();
        assert!(program.ends_with("git"));
        assert!(path.ends_with(SYSTEM_PATH));
        assert!(locate(&["/nowhere"]).is_err());
    }
}

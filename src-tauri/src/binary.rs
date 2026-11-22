//! Files that are not text: a note's pictures. Read whole and written new,
//! through the same path rules as a note (`paths::inside`), as DFAI's host
//! does. Which files these are, and where a new one goes, is decided in
//! TypeScript; this only refuses what would be unsafe for the disk.

use std::fs::OpenOptions;
use std::io::{ErrorKind, Read};
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::State;

use crate::files;
use crate::paths::inside;
use crate::vault::VaultRoot;

/// The largest file read or written here, DFAI's ceiling: well past the
/// 20 MiB an image in a note may be, and far under the 100 MB a push holds.
pub const MAX_BINARY_BYTES: u64 = 32 * 1024 * 1024;

/// The error a read gives for a file that is not there; the webview shows it as missing.
pub const MISSING: &str = "missing:";

/// The header the webview names the new file in, percent-encoded, since a
/// header carries only ASCII. `adapters/tauri/vault-files.ts` sends it.
const PATH_HEADER: &str = "dfai-lite-path";

fn refuse_larger(size: u64, label: &str) -> Result<(), String> {
    if size > MAX_BINARY_BYTES {
        return Err(format!(
            "{label} is over {} MB, more than the app reads or writes",
            MAX_BINARY_BYTES / 1024 / 1024
        ));
    }
    Ok(())
}

/// The file's bytes, through one handle that never follows a link, so the
/// size checked is the size of the file read even if it is replaced meanwhile.
pub fn read_binary(target: &Path, label: &str) -> Result<Vec<u8>, String> {
    let handle = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(target)
        .map_err(|error| match error.kind() {
            ErrorKind::NotFound => format!("{MISSING} there is no file at {label}"),
            _ => format!("cannot read {label}: {error}"),
        })?;
    let meta = handle
        .metadata()
        .map_err(|error| format!("cannot read {label}: {error}"))?;
    if !meta.is_file() {
        return Err(format!("{label} is not a file"));
    }
    refuse_larger(meta.len(), label)?;
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    handle
        .take(MAX_BINARY_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("cannot read {label}: {error}"))?;
    refuse_larger(bytes.len() as u64, label)?;
    Ok(bytes)
}

/// Writes `bytes` as a new file, never over one already there (`exists:`).
pub fn create_binary(target: &Path, label: &str, bytes: &[u8]) -> Result<(), String> {
    refuse_larger(bytes.len() as u64, label)?;
    files::create_new(target, label, bytes)
}

/// A header's value, percent-decoded; why not when it is missing or not UTF-8.
fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    let value = request
        .headers()
        .get(name)
        .ok_or_else(|| format!("no {name} header was sent"))?
        .to_str()
        .map_err(|_| format!("the {name} header is not text"))?;
    percent_encoding::percent_decode_str(value)
        .decode_utf8()
        .map(|decoded| decoded.into_owned())
        .map_err(|_| format!("the {name} header is not UTF-8"))
}

/// A file's raw bytes, sent as a binary response rather than a JSON array.
#[tauri::command]
pub async fn read_binary_file(
    root: State<'_, VaultRoot>,
    path: String,
) -> Result<Response, String> {
    let target = inside(&root.get()?, &path)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || read_binary(&target, &path))
        .await
        .map_err(|error| format!("the read did not finish: {error}"))??;
    Ok(Response::new(bytes))
}

/// Writes the call's raw body as a new file at the path its header names.
#[tauri::command]
pub async fn write_binary_file(
    root: State<'_, VaultRoot>,
    request: Request<'_>,
) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("the file's bytes must be the body of the call".into());
    };
    let path = header(&request, PATH_HEADER)?;
    let target = inside(&root.get()?, &path)?;
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || create_binary(&target, &path, &bytes))
        .await
        .map_err(|error| format!("the write did not finish: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::EXISTS;
    use crate::test_support::temp_folder;
    use std::fs;
    use std::os::unix::fs::symlink;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0, 1, 2, 255];

    #[test]
    fn bytes_written_read_back_the_same_and_a_missing_file_says_so() {
        let root = temp_folder();
        let target = inside(&root, "attachments/a b.png").unwrap();
        create_binary(&target, "a b.png", PNG).unwrap();
        assert_eq!(read_binary(&target, "a b.png").unwrap(), PNG);
        let missing = read_binary(&root.join("none.png"), "none.png").unwrap_err();
        assert!(missing.starts_with(MISSING), "{missing}");
    }

    #[test]
    fn a_new_file_never_overwrites_one_already_there() {
        let root = temp_folder();
        let target = root.join("a.png");
        fs::write(&target, b"mine").unwrap();
        let error = create_binary(&target, "a.png", PNG).unwrap_err();
        assert!(error.starts_with(EXISTS), "{error}");
        assert_eq!(fs::read(&target).unwrap(), b"mine");
    }

    #[test]
    fn neither_reads_nor_writes_through_a_link() {
        let root = temp_folder();
        let outside = temp_folder();
        fs::write(outside.join("secret.png"), PNG).unwrap();
        symlink(outside.join("secret.png"), root.join("link.png")).unwrap();
        symlink(outside.join("new.png"), root.join("planted.png")).unwrap();
        assert!(inside(&root, "link.png").is_err());
        assert!(read_binary(&root.join("link.png"), "link.png").is_err());
        assert!(create_binary(&root.join("planted.png"), "planted.png", PNG).is_err());
        assert!(!outside.join("new.png").exists());
    }

    #[test]
    fn paths_out_of_the_vault_or_into_dot_folders_are_refused() {
        let root = temp_folder();
        for path in [
            "../x.png",
            "a/../../x.png",
            "/etc/x.png",
            ".git/x.png",
            "a/.hidden/x.png",
        ] {
            assert!(inside(&root, path).is_err(), "{path:?} was let through");
        }
    }

    #[test]
    fn a_file_over_the_ceiling_is_neither_written_nor_read() {
        let root = temp_folder();
        let big = vec![0u8; MAX_BINARY_BYTES as usize + 1];
        let error = create_binary(&root.join("big.png"), "big.png", &big).unwrap_err();
        assert!(error.contains("32 MB"), "{error}");
        assert!(!root.join("big.png").exists());
        fs::write(root.join("big.png"), &big).unwrap();
        assert!(read_binary(&root.join("big.png"), "big.png").is_err());
    }

    #[test]
    fn a_folder_is_not_read_as_a_file() {
        let root = temp_folder();
        fs::create_dir(root.join("pics.png")).unwrap();
        assert!(read_binary(&root.join("pics.png"), "pics.png").is_err());
    }
}

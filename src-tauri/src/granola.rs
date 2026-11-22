//! Granola's public API, reached with an API key the host keeps — lifted from
//! DFAI's `granola.rs` (its ADR-0034).
//!
//! The person pastes a key once; the host keeps it in the Keychain and adds
//! it to each request. The key is never handed to the web view: what comes
//! back is whether a key is kept, whether Granola last refused it, and an API
//! call's answer with the key struck from it. Nothing here is logged.
//!
//! What is decided in TypeScript, as every rule is: which calls to make, in
//! what order and how fast, what their answers mean, and what each failure
//! tells the person. What the host holds is where the key may go — Granola's
//! origin and the three calls an import makes — and GET.

use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use reqwest::Url;
use serde::Serialize;
use tauri::State;

use crate::secrets::{redact, vault_scope, SecretState, SecretStore};
use crate::vault::VaultRoot;
pub use failure::{FailureKind, GranolaFailure};

const ORIGIN: &str = "https://public-api.granola.ai";

/// What the key is called where it is struck from an answer.
const KEY_NAME: &str = "granola-api-key";

/// What the key is checked with when it is set: the smallest call there is.
const CHECK_PATH: &str = "/v1/notes";

/// The status by which Granola says it does not know the key.
const UNAUTHORIZED: u16 = 401;

/// Whether this vault has a key on this Mac, and 401 if the last answer
/// Granola gave was a 401. Never a key.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GranolaStatus {
    pub has_key: bool,
    pub last_refusal: Option<u16>,
}

/// What the API answered, with the key struck from the body. A 401 is an
/// answer like any other: what it means is TypeScript's to say.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct GranolaAnswer {
    pub status: u16,
    pub body: String,
}

/// The vaults whose last answer from Granola was a 401. A hint for the
/// person, not a guard; memory only.
#[derive(Default)]
pub struct GranolaState {
    refused: Mutex<HashSet<String>>,
}

impl GranolaState {
    fn last_refusal(&self, scope: &str) -> Option<u16> {
        crate::lock(&self.refused)
            .contains(scope)
            .then_some(UNAUTHORIZED)
    }

    /// Takes Granola's answer as the latest word on the key.
    fn heard(&self, scope: &str, status: u16) {
        if status == UNAUTHORIZED {
            crate::lock(&self.refused).insert(scope.to_string());
        } else {
            self.clear(scope);
        }
    }

    fn clear(&self, scope: &str) {
        crate::lock(&self.refused).remove(scope);
    }
}

/// Granola, for one vault's key.
pub struct Session<'a> {
    pub origin: &'a Url,
    pub store: &'a dyn SecretStore,
    pub scope: &'a str,
    pub state: &'a GranolaState,
    pub timeout: Duration,
}

fn no_key() -> GranolaFailure {
    GranolaFailure::new(
        FailureKind::NoKey,
        "no Granola API key is kept for this vault on this Mac",
    )
}

impl Session<'_> {
    /// A refusal is news about the key kept: with none kept, there is none.
    pub fn status(&self) -> Result<GranolaStatus, GranolaFailure> {
        let has_key = key::load(self.store, self.scope)?.is_some();
        Ok(GranolaStatus {
            has_key,
            last_refusal: has_key
                .then(|| self.state.last_refusal(self.scope))
                .flatten(),
        })
    }

    /// Keeps the key, then asks Granola once with it, so that a key Granola
    /// does not know is known at once rather than at the next import. When
    /// Granola cannot be reached the key is still kept, and no refusal is
    /// reported: nothing has been heard about it yet.
    pub async fn set_key(&self, key: &str) -> Result<GranolaStatus, GranolaFailure> {
        key::save(self.store, self.scope, key)?;
        self.state.clear(self.scope);
        if let Ok(status) = self.check(key).await {
            self.state.heard(self.scope, status);
        }
        Ok(GranolaStatus {
            has_key: true,
            last_refusal: self.state.last_refusal(self.scope),
        })
    }

    /// Granola's status for a first page of one note, asked with `key`. The
    /// body is not read for anything, and so is never handed on.
    async fn check(&self, key: &str) -> Result<u16, GranolaFailure> {
        let query = BTreeMap::from([("page_size".to_string(), "1".to_string())]);
        let url = api::call_url(self.origin, CHECK_PATH, &query)?;
        let (status, _) = api::get(&url, key, self.timeout).await?;
        Ok(status)
    }

    pub fn forget_key(&self) -> Result<GranolaStatus, GranolaFailure> {
        key::forget(self.store, self.scope)?;
        self.state.clear(self.scope);
        Ok(GranolaStatus {
            has_key: false,
            last_refusal: None,
        })
    }

    /// Sends one GET and hands back its answer. A call that is not one of the
    /// three is refused before the key is read, and so before anything is sent.
    pub async fn request(
        &self,
        path: &str,
        query: &BTreeMap<String, String>,
    ) -> Result<GranolaAnswer, GranolaFailure> {
        let url = api::call_url(self.origin, path, query)?;
        let key = key::load(self.store, self.scope)?.ok_or_else(no_key)?;
        let (status, body) = match api::get(&url, &key, self.timeout).await {
            Ok(answer) => answer,
            Err(failure) => return Err(failure.struck_of(KEY_NAME, &key)),
        };
        self.state.heard(self.scope, status);
        let text = String::from_utf8(body).map_err(|_| {
            GranolaFailure::new(FailureKind::Malformed, "Granola did not answer with text")
        })?;
        Ok(GranolaAnswer {
            status,
            body: redact(&text, &[(KEY_NAME, &key)]),
        })
    }
}

fn pinned_origin() -> Url {
    Url::parse(ORIGIN).expect("Granola's fixed origin parses")
}

/// The vault a command names, checked to be the open one, as its Keychain
/// scope: a call that lands after a switch is refused, never sent with the
/// other vault's key.
fn scope_of(root: &VaultRoot, vault: &str) -> Result<String, GranolaFailure> {
    let invalid = |message: &str| GranolaFailure::new(FailureKind::Invalid, message);
    let open = root.get().map_err(|message| invalid(&message))?;
    let named = Path::new(vault)
        .canonicalize()
        .map_err(|_| invalid("the vault named is not a folder on this Mac"))?;
    if named != open {
        return Err(invalid(
            "another vault was opened before this could be sent",
        ));
    }
    Ok(vault_scope(&open))
}

/// Runs `work` with the open vault's session against Granola's own origin.
fn with_session<T>(
    root: &VaultRoot,
    secrets: &SecretState,
    granola: &GranolaState,
    vault: &str,
    work: impl FnOnce(Session<'_>) -> T,
) -> Result<T, GranolaFailure> {
    let scope = scope_of(root, vault)?;
    let origin = pinned_origin();
    Ok(work(Session {
        origin: &origin,
        store: secrets.store(),
        scope: &scope,
        state: granola,
        timeout: api::REQUEST_TIMEOUT,
    }))
}

// The commands are async so that the Keychain, which can block on a prompt,
// is never asked from the main thread.
#[tauri::command]
pub async fn granola_status(
    root: State<'_, VaultRoot>,
    secrets: State<'_, SecretState>,
    granola: State<'_, GranolaState>,
    vault: String,
) -> Result<GranolaStatus, GranolaFailure> {
    with_session(&root, &secrets, &granola, &vault, |session| {
        session.status()
    })?
}

/// Keeps the key the person pasted, replacing any kept before, and answers
/// whether Granola refused it when asked once with it.
#[tauri::command]
pub async fn granola_set_key(
    root: State<'_, VaultRoot>,
    secrets: State<'_, SecretState>,
    granola: State<'_, GranolaState>,
    vault: String,
    key: String,
) -> Result<GranolaStatus, GranolaFailure> {
    let scope = scope_of(&root, &vault)?;
    let origin = pinned_origin();
    Session {
        origin: &origin,
        store: secrets.store(),
        scope: &scope,
        state: &granola,
        timeout: api::REQUEST_TIMEOUT,
    }
    .set_key(&key)
    .await
}

#[tauri::command]
pub async fn granola_forget_key(
    root: State<'_, VaultRoot>,
    secrets: State<'_, SecretState>,
    granola: State<'_, GranolaState>,
    vault: String,
) -> Result<GranolaStatus, GranolaFailure> {
    with_session(&root, &secrets, &granola, &vault, |session| {
        session.forget_key()
    })?
}

/// One GET, as TypeScript builds it: one of the three calls and its query,
/// each value a string. The host adds the key.
#[tauri::command]
pub async fn granola_request(
    root: State<'_, VaultRoot>,
    secrets: State<'_, SecretState>,
    granola: State<'_, GranolaState>,
    vault: String,
    path: String,
    query: BTreeMap<String, String>,
) -> Result<GranolaAnswer, GranolaFailure> {
    let scope = scope_of(&root, &vault)?;
    let origin = pinned_origin();
    Session {
        origin: &origin,
        store: secrets.store(),
        scope: &scope,
        state: &granola,
        timeout: api::REQUEST_TIMEOUT,
    }
    .request(&path, &query)
    .await
}

mod api;
mod failure;
#[cfg(test)]
mod fake_granola;
mod key;
#[cfg(test)]
mod tests;

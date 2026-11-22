//! Where the host keeps a credential: the login Keychain, as DFAI keeps them.
//!
//! One store behind a trait, so tests run against memory and never the
//! Keychain of the Mac running them. Today it holds one thing, the Granola API
//! key (`granola::key`). A value goes in through a command and comes out only
//! inside this process; no command hands one back.

use std::path::Path;
use std::sync::Arc;

use sha2::{Digest, Sha256};

pub use keychain::KeychainStore;
pub use redact::redact;

/// The Keychain service every DFAI Lite credential is filed under: the bundle
/// identifier, apart from DFAI's own.
pub const SERVICE: &str = "com.dailyflowai.dfai-lite";

/// Where values live.
pub trait SecretStore: Send + Sync {
    fn set(&self, account: &str, value: &str) -> Result<(), String>;
    /// None when nothing is stored under the account.
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    /// Removing what is not there is not an error.
    fn delete(&self, account: &str) -> Result<(), String>;
}

pub struct SecretState(Arc<dyn SecretStore>);

impl SecretState {
    pub fn store(&self) -> &dyn SecretStore {
        self.0.as_ref()
    }
}

impl Default for SecretState {
    fn default() -> Self {
        Self(Arc::new(KeychainStore::for_service(SERVICE)))
    }
}

/// A stable short name for a vault: the first 16 hex digits of the SHA-256 of
/// its canonical path, as DFAI names one. Moving the vault gives it a new
/// name, and its key has to be pasted again — the price of never sharing a
/// key between two vaults.
pub fn vault_scope(root: &Path) -> String {
    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let digest = Sha256::digest(canonical.to_string_lossy().as_bytes());
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Where the host keeps an API key its own module for a provider sends:
/// `<vault>:apikey/<provider>`, DFAI's account name.
pub fn apikey_account(scope: &str, provider: &str) -> String {
    format!("{scope}:apikey/{provider}")
}

/// A store in memory, for tests. Never used by the app.
#[cfg(test)]
#[derive(Default)]
pub struct MemoryStore(std::sync::Mutex<std::collections::BTreeMap<String, String>>);

#[cfg(test)]
impl MemoryStore {
    pub fn accounts(&self) -> Vec<String> {
        crate::lock(&self.0).keys().cloned().collect()
    }
}

#[cfg(test)]
impl SecretStore for MemoryStore {
    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        crate::lock(&self.0).insert(account.to_string(), value.to_string());
        Ok(())
    }

    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(crate::lock(&self.0).get(account).cloned())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        crate::lock(&self.0).remove(account);
        Ok(())
    }
}

mod keychain;
mod redact;

#[cfg(test)]
mod tests {
    use super::{apikey_account, vault_scope};
    use crate::test_support::temp_folder;

    #[test]
    fn a_vault_scope_is_sixteen_hex_digits_and_differs_by_folder() {
        let one = temp_folder();
        let two = temp_folder();
        let scope = vault_scope(&one);
        assert_eq!(scope.len(), 16);
        assert!(scope.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_eq!(scope, vault_scope(&one));
        assert_ne!(scope, vault_scope(&two));
    }

    #[test]
    fn an_api_key_is_filed_under_the_vaults_apikey_account() {
        assert_eq!(apikey_account("abc", "granola"), "abc:apikey/granola");
    }
}

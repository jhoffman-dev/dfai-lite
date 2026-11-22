//! The real store: generic passwords in the login Keychain, lifted from DFAI.
//!
//! `keyring-core` with its Apple store. A keyring error is never formatted as
//! it stands: one of its variants carries the bytes it could not decode,
//! which would be the secret itself, so only the kind of failure is put into
//! words.

use super::SecretStore;

pub struct KeychainStore {
    // Off the Mac there is no Keychain: the stub answers without the service
    // name, and only the Linux check ever builds that.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    service: &'static str,
}

impl KeychainStore {
    pub fn for_service(service: &'static str) -> Self {
        Self { service }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use apple_native_keyring_store::keychain::Store;
    use keyring_core::api::CredentialStoreApi;
    use keyring_core::{Entry, Error};

    pub fn entry(service: &str, account: &str) -> Result<Entry, String> {
        Store::new()
            .map_err(|error| describe(&error))?
            .build(service, account, None)
            .map_err(|error| describe(&error))
    }

    /// What went wrong, in words that cannot carry a value.
    pub fn describe(error: &Error) -> String {
        match error {
            Error::NoStorageAccess(_) => "the keychain refused access".into(),
            Error::NoEntry => "no such secret".into(),
            Error::BadEncoding(_) | Error::BadDataFormat(..) => {
                "the keychain holds something that is not text under this name".into()
            }
            Error::TooLong(attribute, limit) => format!("{attribute} is longer than {limit}"),
            Error::Invalid(parameter, _) => format!("the keychain refused the {parameter}"),
            _ => "the keychain could not be used".into(),
        }
    }

    pub use keyring_core::Error as KeyringError;
}

#[cfg(target_os = "macos")]
impl SecretStore for KeychainStore {
    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        platform::entry(self.service, account)?
            .set_password(value)
            .map_err(|error| platform::describe(&error))
    }

    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match platform::entry(self.service, account)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(platform::KeyringError::NoEntry) => Ok(None),
            Err(error) => Err(platform::describe(&error)),
        }
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        match platform::entry(self.service, account)?.delete_credential() {
            Ok(()) | Err(platform::KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(platform::describe(&error)),
        }
    }
}

/// The app runs on macOS only; elsewhere (CI's Linux) there is no Keychain,
/// and a key is refused rather than kept somewhere weaker.
#[cfg(not(target_os = "macos"))]
impl SecretStore for KeychainStore {
    fn set(&self, _: &str, _: &str) -> Result<(), String> {
        Err(UNAVAILABLE.into())
    }

    fn get(&self, _: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    fn delete(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
const UNAVAILABLE: &str = "keys need the macOS Keychain";

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::KeychainStore;
    use crate::secrets::SecretStore;

    /// Touches the real login Keychain, so it is run by hand, never by the gate:
    /// `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored keychain`.
    #[test]
    #[ignore = "writes to the login Keychain of whoever runs it"]
    fn keychain_round_trip() {
        let store = KeychainStore::for_service(crate::secrets::SERVICE);
        let account = "dfai-lite-test/round-trip";
        store.set(account, "first").unwrap();
        store.set(account, "second").unwrap();
        assert_eq!(store.get(account).unwrap().as_deref(), Some("second"));
        store.delete(account).unwrap();
        assert_eq!(store.get(account).unwrap(), None);
        store.delete(account).unwrap();
    }
}

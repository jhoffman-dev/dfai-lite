//! The host's Granola commands against a fake Granola on 127.0.0.1, with the
//! key in a store in memory. Nothing here reaches Granola or the Keychain.

use std::collections::BTreeMap;
use std::time::Duration;

use tauri::async_runtime::block_on;

use super::fake_granola::{FakeGranola, Reply};
use super::{FailureKind, GranolaFailure, GranolaState, Session};
use crate::secrets::{MemoryStore, SecretStore};

const KEY: &str = "grn_Fict10nalKeyForTests";

struct Harness {
    fake: FakeGranola,
    store: MemoryStore,
    state: GranolaState,
    timeout: Duration,
}

impl Harness {
    fn new() -> Self {
        Self {
            fake: FakeGranola::start(KEY),
            store: MemoryStore::default(),
            state: GranolaState::default(),
            timeout: Duration::from_secs(10),
        }
    }

    fn keyed() -> Self {
        let harness = Self::new();
        harness.store.set("v1:apikey/granola", KEY).unwrap();
        harness
    }

    fn session(&self) -> Session<'_> {
        self.session_for("v1")
    }

    fn session_for<'a>(&'a self, scope: &'a str) -> Session<'a> {
        Session {
            origin: &self.fake.origin,
            store: &self.store,
            scope,
            state: &self.state,
            timeout: self.timeout,
        }
    }

    fn list(&self) -> Result<super::GranolaAnswer, GranolaFailure> {
        let query = BTreeMap::from([("page_size".to_string(), "30".to_string())]);
        block_on(self.session().request("/v1/notes", &query))
    }
}

#[test]
fn a_get_carries_the_bearer_key_to_the_call_and_hands_back_what_granola_said() {
    let harness = Harness::keyed();
    let body = r#"{"notes":[{"id":"not_A1","title":"Larkspur Payroll sync","updated_at":"2026-11-20T18:00:00Z"}],"hasMore":false,"cursor":null}"#;
    harness
        .fake
        .set(|granola| granola.reply = Reply::Body(200, body.into()));
    let answer = harness.list().unwrap();
    assert_eq!(answer.status, 200);
    assert_eq!(answer.body, body);
    let heard = harness.fake.heard();
    assert_eq!(heard.len(), 1);
    assert_eq!(heard[0].method, "GET");
    assert_eq!(heard[0].target, "/v1/notes?page_size=30");
    assert_eq!(heard[0].authorization, format!("Bearer {KEY}"));
}

#[test]
fn a_call_that_is_not_one_of_the_three_is_refused_before_anything_is_sent() {
    let harness = Harness::keyed();
    for path in ["/v1/workspaces", "/v1/notes/../admin", "/v2/notes"] {
        let failure = block_on(harness.session().request(path, &BTreeMap::new())).unwrap_err();
        assert_eq!(failure.kind, FailureKind::Invalid, "{path}");
    }
    assert!(harness.fake.heard().is_empty());
}

#[test]
fn without_a_key_nothing_is_sent() {
    let harness = Harness::new();
    let failure = harness.list().unwrap_err();
    assert_eq!(failure.kind, FailureKind::NoKey);
    assert!(harness.fake.heard().is_empty());
}

#[test]
fn one_vaults_key_is_never_sent_for_another() {
    let harness = Harness::keyed();
    let failure = block_on(
        harness
            .session_for("v2")
            .request("/v1/notes", &BTreeMap::new()),
    )
    .unwrap_err();
    assert_eq!(failure.kind, FailureKind::NoKey);
    assert!(harness.fake.heard().is_empty());
}

#[test]
fn a_401_is_handed_back_with_the_key_struck_and_marks_the_key_as_needing_a_reconnect() {
    let harness = Harness::new();
    harness
        .store
        .set("v1:apikey/granola", "grn_NotKnown")
        .unwrap();
    harness.fake.set(|granola| granola.echoes = true);
    let answer = harness.list().unwrap();
    assert_eq!(answer.status, 401);
    assert!(!answer.body.contains("grn_NotKnown"), "{}", answer.body);
    let status = harness.session().status().unwrap();
    assert!(status.has_key);
    assert_eq!(status.last_refusal, Some(401));
}

#[test]
fn any_other_answer_clears_a_refusal() {
    let harness = Harness::keyed();
    harness.state.heard("v1", 401);
    harness
        .fake
        .set(|granola| granola.reply = Reply::Body(403, "{}".into()));
    assert_eq!(harness.list().unwrap().status, 403);
    assert_eq!(harness.session().status().unwrap().last_refusal, None);
}

#[test]
fn setting_a_key_checks_it_once_and_reports_a_refusal() {
    let harness = Harness::new();
    let status = block_on(harness.session().set_key("grn_WrongOne")).unwrap();
    assert!(status.has_key);
    assert_eq!(status.last_refusal, Some(401));
    let status = block_on(harness.session().set_key(KEY)).unwrap();
    assert_eq!(status.last_refusal, None);
    let heard = harness.fake.heard();
    assert_eq!(heard.len(), 2);
    assert_eq!(heard[1].target, "/v1/notes?page_size=1");
}

#[test]
fn a_key_is_kept_even_when_granola_cannot_be_reached_to_check_it() {
    let mut harness = Harness::new();
    harness.timeout = Duration::from_millis(300);
    harness.fake.set(|granola| granola.reply = Reply::Silent);
    let status = block_on(harness.session().set_key(KEY)).unwrap();
    assert!(status.has_key);
    assert_eq!(status.last_refusal, None);
}

#[test]
fn forgetting_the_key_removes_it_and_clears_a_refusal() {
    let harness = Harness::keyed();
    harness.state.heard("v1", 401);
    let status = harness.session().forget_key().unwrap();
    assert!(!status.has_key);
    assert!(harness.store.accounts().is_empty());
    assert_eq!(harness.list().unwrap_err().kind, FailureKind::NoKey);
}

#[test]
fn a_redirect_is_handed_back_not_followed() {
    let harness = Harness::keyed();
    let elsewhere = format!("{}v1/notes/not_B2", harness.fake.origin);
    harness
        .fake
        .set(|granola| granola.reply = Reply::Redirect(elsewhere));
    assert_eq!(harness.list().unwrap().status, 302);
    assert_eq!(harness.fake.heard().len(), 1);
}

#[test]
fn an_answer_larger_than_the_cap_is_refused() {
    let harness = Harness::keyed();
    harness.fake.set(|granola| granola.reply = Reply::Oversized);
    assert_eq!(harness.list().unwrap_err().kind, FailureKind::TooLarge);
}

#[test]
fn an_answer_that_is_not_text_is_malformed() {
    let harness = Harness::keyed();
    harness.fake.set(|granola| granola.reply = Reply::NotText);
    assert_eq!(harness.list().unwrap_err().kind, FailureKind::Malformed);
}

#[test]
fn a_granola_that_never_answers_times_out() {
    let mut harness = Harness::keyed();
    harness.timeout = Duration::from_millis(300);
    harness.fake.set(|granola| granola.reply = Reply::Silent);
    let failure = harness.list().unwrap_err();
    assert_eq!(failure.kind, FailureKind::Timeout);
    assert!(!failure.message.contains(KEY));
}

#[test]
fn a_granola_that_cannot_be_reached_is_unreachable_and_the_failure_has_no_key_or_url() {
    let harness = Harness::keyed();
    let closed = reqwest::Url::parse("http://127.0.0.1:9").unwrap();
    let session = Session {
        origin: &closed,
        ..harness.session()
    };
    let failure = block_on(session.request("/v1/notes", &BTreeMap::new())).unwrap_err();
    assert_eq!(failure.kind, FailureKind::Unreachable);
    assert!(!failure.message.contains(KEY));
    assert!(
        !failure.message.contains("127.0.0.1"),
        "{}",
        failure.message
    );
}

/// Every answer and failure, as the web view would receive it, for a fake
/// that echoes the Authorization header into every body.
#[test]
fn no_answer_or_failure_handed_to_the_web_view_carries_the_key() {
    let harness = Harness::keyed();
    harness.fake.set(|granola| granola.echoes = true);
    let mut handed = Vec::new();
    for reply in [
        Reply::Body(200, "{}".into()),
        Reply::Body(404, "{}".into()),
        Reply::Body(429, "{}".into()),
        Reply::Body(500, "{}".into()),
    ] {
        harness.fake.set(|granola| granola.reply = reply);
        handed.push(serde_json::to_string(&harness.list().unwrap()).unwrap());
    }
    handed.push(serde_json::to_string(&harness.session().status().unwrap()).unwrap());
    for json in handed {
        assert!(!json.contains(KEY), "{json}");
        assert!(json.contains("[granola-api-key removed]") || json.contains("hasKey"));
    }
}

#[test]
fn a_command_for_a_vault_that_is_not_the_open_one_is_refused() {
    let open = crate::test_support::temp_folder();
    let other = crate::test_support::temp_folder();
    let root = crate::vault::VaultRoot::open_at(open.clone());
    let scope = super::scope_of(&root, open.to_str().unwrap()).unwrap();
    assert_eq!(scope, crate::secrets::vault_scope(&open));
    for named in [other.to_str().unwrap(), "/no/such/vault", ""] {
        let failure = super::scope_of(&root, named).unwrap_err();
        assert_eq!(failure.kind, FailureKind::Invalid, "{named}");
    }
    let closed = crate::vault::VaultRoot::default();
    let failure = super::scope_of(&closed, open.to_str().unwrap()).unwrap_err();
    assert_eq!(failure.kind, FailureKind::Invalid);
}

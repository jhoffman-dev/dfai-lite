//! One GET to Granola's public API, carrying the key, lifted from DFAI.
//!
//! The web view says which call — one of three fixed shapes, and its query —
//! and the host adds the key and sends it to the one origin it may go to.
//! Which calls to make and what their answers mean are TypeScript's; where
//! the key may go is the host's. The API is read-only, so GET is the only
//! method there is.

use std::collections::BTreeMap;
use std::time::Duration;

use reqwest::header::{ACCEPT, AUTHORIZATION};
use reqwest::{redirect, Client, Response, Url};

use super::failure::{FailureKind, GranolaFailure};

/// A Mac that sleeps mid-import, or a Granola that never answers, ends the
/// request rather than holding it open; the import tries again next time.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// A note with a long transcript is large, but not this large.
pub const MAX_ANSWER_BYTES: usize = 16 * 1024 * 1024;

const USER_AGENT: &str = concat!("DFAI-Lite/", env!("CARGO_PKG_VERSION"));

fn invalid(message: String) -> GranolaFailure {
    GranolaFailure::new(FailureKind::Invalid, message)
}

/// A path segment as Granola spells a note id (`not_1d3tmYTlCICgjy`):
/// nothing a URL parser reads as a dot segment, a separator, an escape, a
/// query or a fragment.
fn plain_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment.len() <= 128
        && segment
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

/// The three calls an import makes: the list of notes, one note, and a page
/// of its transcript. Tighter than DFAI, which allowed any plain `/v1/` path.
fn known_call(path: &str) -> bool {
    let Some(rest) = path.strip_prefix("/v1/notes") else {
        return false;
    };
    let parts: Vec<&str> = rest.split('/').skip(1).collect();
    match parts.as_slice() {
        [] => rest.is_empty(),
        [id] => plain_segment(id),
        [id, "transcript"] => plain_segment(id),
        _ => false,
    }
}

/// The call's URL, if it is one of the known calls at `origin`. The URL is
/// checked again once parsed, so that it is the parser's reading, not this
/// one's, that is held to it.
pub fn call_url(
    origin: &Url,
    path: &str,
    query: &BTreeMap<String, String>,
) -> Result<Url, GranolaFailure> {
    let refused = || invalid(format!("{path:?} is not a Granola API call"));
    if !known_call(path) {
        return Err(refused());
    }
    let mut url = origin.join(path).map_err(|_| refused())?;
    if url.origin() != origin.origin() || url.path() != path {
        return Err(refused());
    }
    if !query.is_empty() {
        let mut pairs = url.query_pairs_mut();
        for (name, value) in query {
            pairs.append_pair(name, value);
        }
    }
    Ok(url)
}

fn client(timeout: Duration) -> Result<Client, GranolaFailure> {
    // No redirect is followed: an API that moves has nothing to say to a
    // request carrying a key, and following it could carry the key elsewhere.
    Client::builder()
        .timeout(timeout)
        .user_agent(USER_AGENT)
        .redirect(redirect::Policy::none())
        .build()
        .map_err(|error| {
            GranolaFailure::new(
                FailureKind::Unreachable,
                format!("cannot prepare the request: {}", error.without_url()),
            )
        })
}

/// Without the URL, as everywhere a request may go wrong.
fn failed(error: reqwest::Error) -> GranolaFailure {
    let kind = if error.is_timeout() {
        FailureKind::Timeout
    } else {
        FailureKind::Unreachable
    };
    GranolaFailure::new(
        kind,
        format!("cannot reach Granola: {}", error.without_url()),
    )
}

fn too_large() -> GranolaFailure {
    GranolaFailure::new(
        FailureKind::TooLarge,
        "Granola's answer is larger than DFAI Lite will read",
    )
}

/// The body, refused once it passes `cap`, without holding more than that.
async fn read_capped(mut response: Response, cap: usize) -> Result<Vec<u8>, GranolaFailure> {
    if response
        .content_length()
        .is_some_and(|length| length > cap as u64)
    {
        return Err(too_large());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(failed)? {
        if body.len() + chunk.len() > cap {
            return Err(too_large());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Sends the GET with `key`. The answer's body is raw; the caller strikes the
/// key from it.
pub async fn get(
    url: &Url,
    key: &str,
    timeout: Duration,
) -> Result<(u16, Vec<u8>), GranolaFailure> {
    let response = client(timeout)?
        .get(url.clone())
        .header(AUTHORIZATION, format!("Bearer {key}"))
        .header(ACCEPT, "application/json")
        .send()
        .await
        .map_err(failed)?;
    let status = response.status().as_u16();
    Ok((status, read_capped(response, MAX_ANSWER_BYTES).await?))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use reqwest::Url;

    use super::call_url;
    use crate::granola::failure::FailureKind;

    fn origin() -> Url {
        Url::parse("https://public-api.granola.ai").unwrap()
    }

    fn no_query() -> BTreeMap<String, String> {
        BTreeMap::new()
    }

    #[test]
    fn the_three_calls_are_sent_to_the_pinned_origin() {
        for (path, expected) in [
            ("/v1/notes", "https://public-api.granola.ai/v1/notes"),
            (
                "/v1/notes/not_1d3tmYTlCICgjy",
                "https://public-api.granola.ai/v1/notes/not_1d3tmYTlCICgjy",
            ),
            (
                "/v1/notes/not_1d3tmYTlCICgjy/transcript",
                "https://public-api.granola.ai/v1/notes/not_1d3tmYTlCICgjy/transcript",
            ),
        ] {
            assert_eq!(
                call_url(&origin(), path, &no_query()).unwrap().as_str(),
                expected
            );
        }
    }

    #[test]
    fn the_query_is_encoded_so_a_value_cannot_add_a_parameter() {
        let query = BTreeMap::from([
            (
                "updated_after".to_string(),
                "2026-10-01T00:00:00Z".to_string(),
            ),
            ("cursor".to_string(), "abc&page_size=999#x".to_string()),
        ]);
        let url = call_url(&origin(), "/v1/notes", &query).unwrap();
        let pairs: Vec<(String, String)> = url.query_pairs().into_owned().collect();
        assert_eq!(
            pairs,
            vec![
                ("cursor".to_string(), "abc&page_size=999#x".to_string()),
                (
                    "updated_after".to_string(),
                    "2026-10-01T00:00:00Z".to_string()
                ),
            ]
        );
        assert_eq!(url.fragment(), None);
    }

    #[test]
    fn any_other_path_is_refused() {
        for path in [
            "/v1/../v2/notes",
            "/v1/notes/../../admin",
            "/v1/%2e%2e/%2e%2e/admin",
            "/v1/notes/%2E%2E",
            "/v1/notes/.",
            "//evil.example/v1/notes",
            "https://evil.example/v1/notes",
            "https://public-api.granola.ai/v1/notes",
            "/v1/notes%2f..%2fadmin",
            "/v1/notes\\..\\admin",
            "/v1/notes?page_size=30",
            "/v1/notes#top",
            "/v1/notes/",
            "/v1/notesx",
            "/v1/notes/a/b",
            "/v1/notes/a/transcript/x",
            "/v1/workspaces",
            "/v1/",
            "/v1",
            "v1/notes",
            "/v2/notes",
            "/v1/notes/not a note",
            "",
        ] {
            let failure = call_url(&origin(), path, &no_query()).unwrap_err();
            assert_eq!(failure.kind, FailureKind::Invalid, "{path}");
        }
    }
}

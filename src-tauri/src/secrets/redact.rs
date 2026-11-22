//! Striking a credential from text the host hands on: Granola's answers and
//! every failure's words. DFAI strikes a secret in the forms a server echoes
//! it in; this keeps the forms a JSON API's echo of a header takes — as sent,
//! percent-encoded (either case of hex), JSON-escaped (`\/`, and every
//! character as `\uXXXX` in either case) — and leaves out DFAI's base64 and
//! mixed-escape matching, which a Granola key (`grn_` and ASCII) is not
//! echoed in by any answer Granola documents.

/// What a struck credential reads as.
fn marker(name: &str) -> String {
    format!("[{name} removed]")
}

fn percent_encoded(value: &str, upper: bool) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
                (byte as char).to_string()
            } else if upper {
                format!("%{byte:02X}")
            } else {
                format!("%{byte:02x}")
            }
        })
        .collect()
}

fn fully_percent_encoded(value: &str, upper: bool) -> String {
    value
        .bytes()
        .map(|byte| {
            if upper {
                format!("%{byte:02X}")
            } else {
                format!("%{byte:02x}")
            }
        })
        .collect()
}

fn json_unicode_escaped(value: &str, upper: bool) -> String {
    value
        .encode_utf16()
        .map(|unit| {
            if upper {
                format!("\\u{unit:04X}")
            } else {
                format!("\\u{unit:04x}")
            }
        })
        .collect()
}

/// The spellings of `value` an echo may carry, longest first so a longer
/// form is struck whole before a shorter one inside it could be.
fn forms(value: &str) -> Vec<String> {
    let mut found = vec![
        value.to_string(),
        value.replace('/', "\\/"),
        value.replace('\\', "\\\\").replace('"', "\\\""),
        percent_encoded(value, true),
        percent_encoded(value, false),
        fully_percent_encoded(value, true),
        fully_percent_encoded(value, false),
        json_unicode_escaped(value, true),
        json_unicode_escaped(value, false),
    ];
    found.sort_by_key(|form| std::cmp::Reverse(form.len()));
    found.dedup();
    found
}

/// `text` with every form of each `(name, value)` struck. An empty value is
/// never matched: it would strike between every character.
pub fn redact(text: &str, used: &[(&str, &str)]) -> String {
    let mut struck = text.to_string();
    for (name, value) in used {
        if value.is_empty() {
            continue;
        }
        for form in forms(value) {
            struck = struck.replace(&form, &marker(name));
        }
    }
    struck
}

#[cfg(test)]
mod tests {
    use super::{fully_percent_encoded, json_unicode_escaped, percent_encoded, redact};

    const KEY: &str = "grn_Fict10nal/Key+x";

    fn struck(text: &str) -> String {
        redact(text, &[("granola-api-key", KEY)])
    }

    #[test]
    fn the_key_as_sent_is_struck_and_the_rest_kept() {
        let text = format!(r#"{{"echo":"Bearer {KEY}","ok":true}}"#);
        assert_eq!(
            struck(&text),
            r#"{"echo":"Bearer [granola-api-key removed]","ok":true}"#
        );
    }

    #[test]
    fn every_escaped_form_is_struck() {
        for form in [
            KEY.replace('/', "\\/"),
            percent_encoded(KEY, true),
            percent_encoded(KEY, false),
            fully_percent_encoded(KEY, true),
            fully_percent_encoded(KEY, false),
            json_unicode_escaped(KEY, true),
            json_unicode_escaped(KEY, false),
        ] {
            let out = struck(&format!("before {form} after"));
            assert_eq!(out, "before [granola-api-key removed] after", "{form}");
        }
    }

    #[test]
    fn an_empty_value_strikes_nothing() {
        assert_eq!(redact("abc", &[("k", "")]), "abc");
    }
}

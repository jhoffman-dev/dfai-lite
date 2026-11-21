//! macOS's automatic text substitutions, off in this app's web view. A note
//! is markdown: a smart quote, an em dash for `--` or a text replacement
//! changes the file, not just how it looks.
//!
//! WebKit reads these keys from the app's defaults and, when a key is unset,
//! follows the system's settings (smart quotes and dashes are on by default).
//! Registered defaults sit under anything set in the app's own domain, so a
//! choice made in Edit ▸ Substitutions still wins, and nothing is written to
//! disk.

#[cfg(target_os = "macos")]
pub fn turn_off_substitutions() {
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSDictionary, NSNumber, NSString, NSUserDefaults};

    const KEYS: [&str; 4] = [
        "WebAutomaticQuoteSubstitutionEnabled",
        "WebAutomaticDashSubstitutionEnabled",
        "WebAutomaticTextReplacementEnabled",
        "WebAutomaticSpellingCorrectionEnabled",
    ];
    let keys: Vec<_> = KEYS.iter().map(|key| NSString::from_str(key)).collect();
    let off = NSNumber::new_bool(false);
    let key_refs: Vec<&NSString> = keys.iter().map(|key| &**key).collect();
    let values: Vec<&AnyObject> = keys.iter().map(|_| -> &AnyObject { &off }).collect();
    let registration = NSDictionary::from_slices(&key_refs, &values);
    // SAFETY: every key is an NSString and every value an NSNumber, the
    // property-list types `registerDefaults:` takes.
    unsafe { NSUserDefaults::standardUserDefaults().registerDefaults(&registration) };
}

#[cfg(not(target_os = "macos"))]
pub fn turn_off_substitutions() {}

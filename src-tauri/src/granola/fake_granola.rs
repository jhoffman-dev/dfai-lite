//! A local stand-in for Granola's public API, for the tests. It runs over real
//! TCP on 127.0.0.1, so the host's requests are the ones the app sends, and it
//! records every one it hears. No test reaches Granola.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use reqwest::Url;

use super::api::MAX_ANSWER_BYTES;

/// How the fake answers a request carrying the key it honours.
#[derive(Clone, PartialEq, Eq)]
pub enum Reply {
    /// This status, with this body.
    Body(u16, String),
    /// A redirect to this location.
    Redirect(String),
    /// Bytes that are not text.
    NotText,
    /// One byte more than the host will read.
    Oversized,
    /// Accepts the request and never answers it.
    Silent,
}

/// One request as the fake heard it.
#[derive(Debug, Clone)]
pub struct Heard {
    pub method: String,
    /// With its query, as it arrived.
    pub target: String,
    pub authorization: String,
}

pub struct Granola {
    /// The key it honours; any other is answered 401.
    pub key: String,
    pub reply: Reply,
    /// Every answer carries the request's Authorization header in its body,
    /// as plenty of servers echo what they were sent.
    pub echoes: bool,
    pub heard: Vec<Heard>,
}

/// A running fake, and where it listens.
pub struct FakeGranola {
    pub origin: Url,
    pub granola: Arc<Mutex<Granola>>,
}

impl FakeGranola {
    pub fn start(key: &str) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
        let granola = Arc::new(Mutex::new(Granola {
            key: key.to_string(),
            reply: Reply::Body(200, r#"{"notes":[],"hasMore":false,"cursor":null}"#.into()),
            echoes: false,
            heard: Vec::new(),
        }));
        let shared = Arc::clone(&granola);
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let granola = Arc::clone(&shared);
                thread::spawn(move || answer(stream, &granola));
            }
        });
        Self { origin, granola }
    }

    pub fn set(&self, change: impl FnOnce(&mut Granola)) {
        change(&mut crate::lock(&self.granola));
    }

    pub fn heard(&self) -> Vec<Heard> {
        crate::lock(&self.granola).heard.clone()
    }
}

fn read_request(stream: &TcpStream) -> Option<Heard> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();
    let mut authorization = String::new();
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).ok()? == 0 || header.trim().is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            if name.eq_ignore_ascii_case("authorization") {
                authorization = value.trim().to_string();
            }
        }
    }
    Some(Heard {
        method,
        target,
        authorization,
    })
}

fn respond(mut stream: TcpStream, status: u16, extra: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status} X\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n",
        body.len()
    );
    // A test that has stopped listening is not a failure of the fake.
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
}

fn answer(stream: TcpStream, granola: &Mutex<Granola>) {
    let Some(heard) = read_request(&stream) else {
        return;
    };
    let (key, reply, echoes) = {
        let mut held = crate::lock(granola);
        held.heard.push(heard.clone());
        (held.key.clone(), held.reply.clone(), held.echoes)
    };
    let echo = |body: String| {
        if echoes {
            format!("{body} echo: {}", heard.authorization)
        } else {
            body
        }
    };
    if heard.authorization != format!("Bearer {key}") {
        let body = echo(r#"{"message":"Unauthorized"}"#.to_string());
        return respond(stream, 401, "", body.as_bytes());
    }
    match reply {
        Reply::Body(status, body) => respond(stream, status, "", echo(body).as_bytes()),
        Reply::Redirect(to) => respond(stream, 302, &format!("Location: {to}\r\n"), b""),
        Reply::NotText => respond(stream, 200, "", &[0xff, 0xfe, 0x00]),
        Reply::Oversized => respond(stream, 200, "", &vec![b'a'; MAX_ANSWER_BYTES + 1]),
        Reply::Silent => thread::sleep(Duration::from_secs(5)),
    }
}

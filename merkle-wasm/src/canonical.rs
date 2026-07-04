//! Ernest's canonical JSON, in Rust. Must produce byte-identical output to the
//! NestJS backend (json-canonicalize, RFC 8785 + excluded keys), the Go
//! event-writer and the Go CLI. The contract is pinned by
//! ../testdata/hash-golden-vectors.json (see tests in lib.rs): this
//! implementation exists so a browser can verify evidence receipts fully
//! offline via WASM, and it is only safe to have a fourth implementation
//! BECAUSE the golden vectors hold all of them to the same bytes in CI.

use serde_json::Value;
use sha2::{Digest, Sha256};

const EXCLUDED_KEYS: [&str; 5] = ["__v", "_id", "createdAt", "updatedAt", "hash"];

/// Canonical JSON string of a parsed value, with Ernest's excluded keys dropped
/// at every depth.
pub fn canonical_json(value: &Value) -> Result<String, String> {
    let mut out = String::new();
    write_canonical(&mut out, value)?;
    Ok(out)
}

/// sha256 hex of "index|timestamp|canonicalData|previousHash" — the block hash
/// law shared by every Ernest implementation.
pub fn block_hash(index: i64, timestamp: i64, data: &Value, previous_hash: &str) -> Result<String, String> {
    let canonical = canonical_json(data)?;
    let block_string = format!("{}|{}|{}|{}", index, timestamp, canonical, previous_hash);
    let mut hasher = Sha256::new();
    hasher.update(block_string.as_bytes());
    Ok(hex::encode(hasher.finalize()))
}

fn write_canonical(out: &mut String, value: &Value) -> Result<(), String> {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map
                .keys()
                .filter(|k| !EXCLUDED_KEYS.contains(&k.as_str()))
                .collect();
            // RFC 8785 sorts keys by UTF-16 code units, which differs from Rust's
            // native char/byte order for supplementary-plane characters.
            keys.sort_by(|a, b| utf16_units(a).cmp(&utf16_units(b)));

            out.push('{');
            for (i, key) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_json_string(out, key);
                out.push(':');
                write_canonical(out, &map[key.as_str()])?;
            }
            out.push('}');
            Ok(())
        }
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(out, item)?;
            }
            out.push(']');
            Ok(())
        }
        Value::String(s) => {
            write_json_string(out, s);
            Ok(())
        }
        Value::Bool(b) => {
            out.push_str(if *b { "true" } else { "false" });
            Ok(())
        }
        Value::Null => {
            out.push_str("null");
            Ok(())
        }
        Value::Number(n) => {
            // All numbers go through f64, matching every other verifier: JSON
            // numbers are doubles end to end in Ernest (the event-writer rejects
            // integers beyond 2^53 at ingest).
            let f = n
                .as_f64()
                .ok_or_else(|| format!("non-finite or unrepresentable number: {}", n))?;
            write_es_number(out, f)
        }
    }
}

fn utf16_units(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

/// Mirrors ECMAScript JSON.stringify: short escapes for common control chars,
/// \u00XX for the rest below U+0020, everything else literal (no HTML escaping,
/// U+2028/U+2029 literal).
fn write_json_string(out: &mut String, value: &str) {
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000C}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// ECMAScript Number::toString(10): shortest round-trip digits, plain decimal
/// for magnitudes in [1e-6, 1e21), exponent notation outside, -0 collapsed to 0.
fn write_es_number(out: &mut String, f: f64) -> Result<(), String> {
    if f.is_nan() || f.is_infinite() {
        return Err("non-finite number".to_string());
    }
    if f == 0.0 {
        out.push('0');
        return Ok(());
    }
    if f < 0.0 {
        out.push('-');
        return write_es_number(out, -f);
    }

    // Rust's LowerExp gives the shortest round-trip mantissa: "d[.ddd]e±X".
    let formatted = format!("{:e}", f);
    let e_pos = formatted
        .find('e')
        .ok_or_else(|| format!("unexpected float format: {}", formatted))?;
    let exp: i64 = formatted[e_pos + 1..]
        .parse()
        .map_err(|_| format!("unexpected exponent in: {}", formatted))?;
    let digits: String = formatted[..e_pos].replace('.', "");
    let n = exp + 1; // decimal point position relative to the digits
    let k = digits.len() as i64;

    if k <= n && n <= 21 {
        out.push_str(&digits);
        out.push_str(&"0".repeat((n - k) as usize));
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        out.push_str(&"0".repeat((-n) as usize));
        out.push_str(&digits);
    } else {
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        if exp >= 0 {
            out.push('+');
        }
        out.push_str(&exp.to_string());
    }
    Ok(())
}

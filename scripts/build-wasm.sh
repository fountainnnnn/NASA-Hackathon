#!/usr/bin/env bash
# Builds crates/scenario to WebAssembly and commits-ready outputs:
#   public/wasm/scenario_bg.wasm
#   src/lib/scenario/wasm/scenario.js (+ scenario.d.ts)
# The outputs are committed so the Railway build does not need Rust.
set -euo pipefail
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRATE="$ROOT/crates/scenario"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cd "$CRATE"
cargo build --release --target wasm32-unknown-unknown

# wasm-bindgen CLI must match the crate's wasm-bindgen version exactly.
WANT="$(awk '/name = "wasm-bindgen"$/{getline; gsub(/[version = "]/,""); print; exit}' Cargo.lock)"
HAVE="$(wasm-bindgen --version 2>/dev/null | awk '{print $2}' || true)"
if [ "$WANT" != "$HAVE" ]; then
  echo "wasm-bindgen CLI is '$HAVE', crate needs '$WANT'. Run: cargo install wasm-bindgen-cli --version $WANT --locked" >&2
  exit 1
fi
wasm-bindgen target/wasm32-unknown-unknown/release/scenario.wasm --target web --out-dir "$TMP" --out-name scenario

if command -v wasm-opt >/dev/null 2>&1; then
  wasm-opt -O3 "$TMP/scenario_bg.wasm" -o "$TMP/scenario_bg.opt.wasm" && mv "$TMP/scenario_bg.opt.wasm" "$TMP/scenario_bg.wasm"
else
  echo "wasm-opt not found; skipping (output is still release/LTO optimised)"
fi

# Stop bundlers from emitting a duplicate asset for the default `new URL('scenario_bg.wasm', import.meta.url)`;
# the loader always passes the wasm explicitly.
node -e '
const fs=require("fs");const p=process.argv[1];let s=fs.readFileSync(p,"utf8");
s=s.replace(/module_or_path = new URL\(.scenario_bg\.wasm., import\.meta\.url\);/, "throw new Error(\"scenario wasm: pass module_or_path explicitly\");");
fs.writeFileSync(p,s);' "$TMP/scenario.js"

mkdir -p "$ROOT/public/wasm" "$ROOT/src/lib/scenario/wasm"
cp "$TMP/scenario_bg.wasm" "$ROOT/public/wasm/scenario_bg.wasm"
cp "$TMP/scenario.js" "$TMP/scenario.d.ts" "$ROOT/src/lib/scenario/wasm/"
ls -l "$ROOT/public/wasm/scenario_bg.wasm"

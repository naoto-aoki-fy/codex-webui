# Codex 0.168.0 Responses compatibility projection

Request-only Rust normalizer, matching upstream patch, and explicit verification
adapter. Codexapp does not start the adapter or change provider configuration.

Build and test (Rust 1.95+):

```sh
cargo test --locked --manifest-path adapters/codex-0.168.0/Cargo.toml
cargo build --release --locked --manifest-path adapters/codex-0.168.0/Cargo.toml
node adapters/codex-0.168.0/forwarder.cjs --help
```

[Policy, deployment, real-provider evidence and limitations](../../docs/native-provider-compatibility.md)

# Thread history ownership

The unused session enrichment facade and local session metadata parsers are removed.
History comes from native thread/read; inline media sanitization and sparse
attachment-only recovery remain. See [capability consolidation](refactoring/native-capability-consolidation.md)
for verified callers, metadata limitations and performance analysis.

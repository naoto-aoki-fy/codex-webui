#!/usr/bin/env python3
"""Generate the integration patch against exported rust-v0.168.0 source."""
import difflib
import hashlib
import json
import pathlib
import sys
root = pathlib.Path(sys.argv[1])
repo = pathlib.Path(__file__).resolve().parents[2]
manifest = json.loads((pathlib.Path(__file__).parent / 'upstream.json').read_text())
for path, expected in manifest['sourceFiles'].items():
    assert hashlib.sha256((root / path).read_bytes()).hexdigest() == expected, f'Not matching {manifest["tag"]}: {path}'
files = {}
client = 'codex-rs/core/src/client.rs'
original = (root / client).read_text()
needle = '        input.splice(0..0, prefix);\n'
assert original.count(needle) == 1
# Run on the complete request copy after history and Lite prefix construction.
integration = '''        // A fork may replay a different Responses dialect. Compatible requests
        // skip JSON projection entirely; persisted history is never changed.
        let needs_history_projection = input.iter().any(|item| match item {
            ResponseItem::AdditionalTools { .. } => !model_info.use_responses_lite,
            ResponseItem::Reasoning {
                content: Some(content),
                ..
            } => is_openai && !content.is_empty(),
            _ => false,
        });
        if needs_history_projection {
            let input_json = serde_json::to_value(&input)?;
            let tools_json = serde_json::to_value(&tools)?;
            let current_tools = tools_json.as_array().map(Vec::as_slice).unwrap_or(&[]);
            let projection = crate::responses_compat::project(
                input_json.as_array().expect("serialized response input is an array"),
                current_tools,
                crate::responses_compat::Destination {
                    additional_tools: model_info.use_responses_lite,
                    reasoning_content: !is_openai,
                    namespaces: model_info.use_responses_lite
                        || current_tools.iter().any(|tool| tool["type"] == "namespace"),
                },
            ).map_err(|detail| CodexErr::Fatal(format!(
                "Unsupported cross-provider history: {detail}. Choose a compatible destination; no history was modified."
            )))?;
            tracing::debug!(
                reasoning_items = projection.reasoning_items,
                obsolete_declarations = projection.obsolete_declarations,
                retained_declarations = projection.retained_declarations,
                "Projected cross-dialect request history"
            );
            input = serde_json::from_value(serde_json::Value::Array(projection.input))?;
        }
'''
files[client] = (original, original.replace(needle, needle + integration))
lib = 'codex-rs/core/src/lib.rs'
original = (root / lib).read_text()
assert 'mod responses_headers;\n' in original
files[lib] = (original, original.replace('mod responses_headers;\n', 'mod responses_compat;\nmod responses_headers;\n'))
helper = 'codex-rs/core/src/responses_compat.rs'
files[helper] = ('', (pathlib.Path(__file__).parent / 'responses_compat.rs').read_text())
patch = ''
for path, (before, after) in files.items():
    patch += ''.join(difflib.unified_diff(before.splitlines(True), after.splitlines(True),
        fromfile='a/'+path if before else '/dev/null', tofile='b/'+path))
(repo / 'patches/codex-0.168.0-request-projection.patch').write_text(patch)

use codex_responses_compat_probe::{Destination, project};
use serde_json::{Value, json};
use std::io::{self, BufRead, Write};
fn main() {
    for line in io::stdin().lock().lines() {
        let result = (|| -> Result<Value, String> {
            let envelope: Value = serde_json::from_str(&line.map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            let request = &envelope["request"];
            let policy = &envelope["destination"];
            let input = request["input"]
                .as_array()
                .ok_or("Request input must be an array")?;
            let tools = request
                .get("tools")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let projection = project(
                input,
                &tools,
                Destination {
                    additional_tools: policy["additional_tools"]
                        .as_bool()
                        .ok_or("Missing destination additional_tools capability")?,
                    reasoning_content: policy["reasoning_content"]
                        .as_bool()
                        .ok_or("Missing destination reasoning_content capability")?,
                    namespaces: policy["namespaces"]
                        .as_bool()
                        .ok_or("Missing destination namespaces capability")?,
                },
            )?;
            let mut projected = request.clone();
            projected["input"] = Value::Array(projection.input);
            Ok(
                json!({"request":projected,"stats":{"reasoning_items":projection.reasoning_items,"obsolete_declarations":projection.obsolete_declarations,"retained_declarations":projection.retained_declarations}}),
            )
        })();
        let output = match result {
            Ok(value) => value,
            Err(error) => json!({"error":error}),
        };
        println!("{output}");
        io::stdout().flush().expect("flush projection output");
    }
}

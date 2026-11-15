# Read-only warnings and diagnostics (32)

Setup: isolated fixture delivering `warning` notifications and observed capability
evidence. Include credential-like text and URLs in warnings/error details.

1. Open Settings → Account. **Read diagnostics** performs one local read; no probe,
   upload, feedback, account mutation or new event subscription occurs.
2. Inspect initialized/unknown connection state, platform, unknown runtime version,
   and observed capability support. No bundled catalog is treated as evidence.
3. Deliver 25 warnings on the existing event stream: only the latest 20 remain;
   text is bounded to 600 characters. Reopen settings: no duplicate listeners.
4. Inspect/copy the report. It contains only fixed schema fields, capability enum
   evidence, platform enum and warning timestamps/count. Free-form messages/error
   details, profile names, credentials, endpoints, paths, configuration, environment,
   logs and conversation contents are excluded, including credentials in URLs.
5. Rejected/unsupported diagnostics: error, no successful read/copy indicator.
   Disconnect during read: no stale result; reconnect clears browser warning buffer.
6. Existing **Check remote compatibility** remains explicitly user-triggered and
   performs its documented safe probes and upload inventory inspection.
7. Check the actual diagnostics/report in both themes at desktop, 375×812, 768×1024.

Cleanup: reset fixture. Copying only writes the clipboard; no external transmission.
Performance: buffer ≤20×600 characters; no added listener, timer or polling loop.
One local endpoint read per request. Explicit compatibility checks retain existing
coalescing. No live runtime diagnostic capability or latency has been measured.

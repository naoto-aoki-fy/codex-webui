# API wrapper cleanup

The application loads thread lists through `getThreadGroupsPage` and conversation history through `getThreadDetail` and its windowed history helpers. The unused `getThreadGroups` and `getThreadMessages` frontend wrappers and their exclusive helpers have been removed.

The unused `getThreadReviewResult` and `startThreadReview` wrappers, private review text parsers, and UI review result types have been removed. Generic RPC transport remains available for `review/start`; upstream protocol schemas and documentation remain unchanged.

The unused `getNotificationCatalog` and `fetchRpcNotificationCatalog` frontend wrappers have been removed. `getMethodCatalog` remains available using bundled advisory metadata; it is not live capability negotiation. Notification subscriptions and handling are unchanged.

The `/codex-api/meta/notifications` HTTP API is retained, using the bundled method catalog.

The unused `/codex-local-file` endpoint has been retired from production and development, along with its service-worker bypass. Repository-wide searches found no callers or supported external API contract; the prior cleanup note deferred removal solely because external use was unknown. Local images use `/codex-local-image`, conversation file links use `/codex-local-browse`, and folder selection uses `/codex-local-directories`. Attachments retain their existing upload and image paths.

The active `/codex-local-browse` route retains read-only browsing. Browser editing and `/codex-local-edit` have been removed. No persisted preference data is deleted.

The obsolete GET/PUT `/codex-api/preferences/first-launch-plugins-card` handlers, dismissal key constant, and exclusive read/write helpers have been removed. Repository-wide caller searches found only these handlers and historical feature documentation; the announcement UI and its callers were already removed. Historical wiki sources describe the former implementation, not a supported preference API. External clients using this obsolete route must stop calling it. No persisted keys or files are migrated or deleted; shared global-state persistence remains for titles, pins, and workspace roots.

Compatibility boundary: `PROJECT_SPEC.md` explicitly lists GET `/codex-api/meta/notifications` as a discovery API. Despite having no remaining internal callers, it is retained using the bundled notification method catalog to avoid breaking that documented contract. Removing it requires an explicit API retirement decision. The active RPC method catalog, WebSocket/SSE transport, and notification types used by subscribers remain intact.

Focused performance assessment (code-path analysis): removing the preference handlers removes their global-state reads and locked writes when called, and two route comparisons from subsequent requests. The current UI already sends zero preference requests, so no UI request-count improvement is expected. No new blocking work, payloads, fanout, or caches are introduced; active catalog caching and invalidation behavior are unchanged. Live browser latency was not measured for this server-only deletion.

Endpoint retirement performance assessment (code-path analysis): removes one Express route and one Vite middleware, including their exclusive file-streaming work. Active callers already make zero requests to the retired endpoint. No additional requests, blocking work, fanout, payloads, or caches are introduced; active endpoint caching and invalidation are unchanged. Live browser latency was not measured.

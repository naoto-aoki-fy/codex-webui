# Native Apps / Connectors references (18)

Current access and layout/state checks: [management dialogs and send modes](../chat-composer-rendering/management-dialogs-send-modes.md). Detailed tools use the conversation header menu; composer selection uses +; account and connection management use Settings.


Setup: supported loaded thread, or `node scripts/test-approved-apps.cjs` fixtures.
Expand Apps / Connectors, refresh, select an accessible enabled App. Expect the
exact native ID, a removable selected reference, and no install/auth/send operation.
Write a prompt, reload: reference and draft persist in the same profile. Submit:
turn/start input includes type mention, name, and exact app://<id> path, separately
from text/skills/files. Refresh after App removal/disable: selection is marked
unavailable and submission blocked until removal or an available-state refresh.
Connection replacement clears selected remote references and pending list results.
Unknown availability stays unknown until refresh; native submission still decides
whether a saved reference is usable. New-thread Apps selection is not offered.
Check empty/errors/pagination, both themes/all sizes. Cleanup: close fixture or
remove selected references; no integration/account resources are mutated.

Performance: zero startup calls/subscriptions. One 50-App page on click, maximum
200 displayed rows/20 selected references. No pre-send network probe or global
config writes; existing immediate steering call remains single-shot. Draft adds
only native IDs/names (no credentials/results/attachment bytes). Live NOT RUN.

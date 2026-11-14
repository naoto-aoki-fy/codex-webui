# Native Fast capability selection

Setup: disposable server fixture/catalog with the same model ID under two
providers, one advertising `serviceTiers: [{ id: 'fast' }]`, one an empty array,
and a third model omitting metadata. Use a disposable conversation.

1. Select the supported provider/model. Open composer settings and enable Fast.
   Expect no fixed speed/credit promises. Submit; inspect one `turn/start` request
   with `serviceTierForTurn: fast`.
2. Switch to the other provider/model. Expect unavailable status; the selected
   mode must not silently change. Submission in Fast must fail before `turn/start`.
3. Select the model with missing metadata. Expect unknown availability, not a
   model-name guess. Choose Standard and submit; expect `serviceTierForTurn: default`.
4. Repeat supported/unsupported/unknown switching in light and dark themes. The
   settings surface and disabled state must remain readable. Disconnect/reconnect;
   expect ordinary external connection/authentication guidance, no local CLI banner.

Cleanup: restore test catalog/network and remove only disposable conversations.

Acceptance regression evidence: `codexGateway.test.ts` asserts exact serialized
Fast-enable/config, Fast turn, disable/config and Standard turn bodies. The
messages suite restores an existing Fast-tier thread with configured Fast and
configured Standard and calls the real serializer. See the
[acceptance report](../../docs/native-maintenance-acceptance.md#2-fast-request-semantics)
for omitted/null/default semantics and the intentional config-write boundary.

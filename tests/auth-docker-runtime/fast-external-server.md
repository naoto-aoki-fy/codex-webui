# Fast container with an external App Server

Prerequisites: Docker daemon, current dependencies, free loopback port 4191,
and an independently managed compatible test App Server reachable from the
container. Use disposable test state. Follow [setup](../../docs/development.md#optional-docker-feature-checks).

1. Rebuild the base image, then run the documented runner with the test endpoint.
2. Confirm page and RPC readiness succeed. Inspect native Projects and history
   only if the supplied server has the required capabilities and test data.
3. With the container still present, rerun using the same name. Expect refusal;
   the original container must remain running.
4. Remove only the test container. Retry with a refused endpoint and a distinct
   container name; expect a readiness failure, logs, and automatic removal.
5. Restart using the valid endpoint and the same test volume. Verify test state
   persists. Do not use production data to perform this check.

Expected: the WebUI never launches Codex; RPC goes to the configured server.
Host publication is loopback-only. A home-page 200 alone cannot satisfy readiness.
No credential or server-home copying occurs.

Cleanup: remove the printed test container. Preserve the named volume unless
deliberately discarding test state. Stop only a server/tunnel created for this test.
This checklist is not evidence that a container run was performed.

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${CODEXAPP_DOCKER_FAST_IMAGE:-codexapp-fast-test-base:latest}"
CONTAINER_NAME="${CODEXAPP_DOCKER_FAST_CONTAINER:-codexapp-fast-test}"
PORT="${PORT:-4191}"
WEBUI_STORAGE_VOLUME="${CODEXAPP_DOCKER_FAST_HOME:-codex-webui-fast-test-storage}"

# This optional container workflow uses an independently managed App Server.
# The URL must be reachable from inside the container, not just from the host.
: "${CODEXUI_APP_SERVER_URL:?Set CODEXUI_APP_SERVER_URL to the externally managed test server; see docs/development.md}"
: "${CODEXUI_CONNECTION_PROFILE:?Set CODEXUI_CONNECTION_PROFILE to the App Server ID}"
docker info >/dev/null
if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  echo "Container already exists: $CONTAINER_NAME. Choose another name or remove it explicitly." >&2
  exit 1
fi
if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  docker build -t "$IMAGE_NAME" -f "$ROOT_DIR/scripts/docker-fast-test-base.Dockerfile" "$ROOT_DIR"
fi

pnpm --dir "$ROOT_DIR" run build
docker volume create "$WEBUI_STORAGE_VOLUME" >/dev/null

created=0
ready=0
cleanup() {
  if [[ "$created" == 1 && "$ready" == 0 ]]; then
    docker logs --tail 120 "$CONTAINER_NAME" >&2 || true
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker create \
  --name "$CONTAINER_NAME" \
  --add-host host.docker.internal:host-gateway \
  -p "127.0.0.1:${PORT}:4191" \
  -e XDG_CONFIG_HOME=/webui-storage/config \
  -e XDG_DATA_HOME=/webui-storage/data \
  -e XDG_CACHE_HOME=/webui-storage/cache \
  -e XDG_STATE_HOME=/webui-storage/state \
  -e CODEXUI_CONNECTION_PROFILE \
  -e CODEXUI_REMOTE_UPLOAD_DIR \
  -e CODEXUI_APP_SERVER_URL \
  -v "$ROOT_DIR:/repo:ro" \
  -v "$WEBUI_STORAGE_VOLUME:/webui-storage" \
  "$IMAGE_NAME" >/dev/null
created=1
docker start "$CONTAINER_NAME" >/dev/null

for _ in $(seq 1 60); do
  if [[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER_NAME")" != true ]]; then
    echo "WebUI container exited before readiness." >&2
    exit 1
  fi
  # A home-page 200 alone cannot establish App Server connectivity.
  if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/" >/dev/null 2>&1 \
    && curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/codex-api/rpc" \
      -H 'Content-Type: application/json' \
      -d '{"method":"account/read","params":{}}' >/dev/null 2>&1; then
    ready=1
    echo "Docker fast test server: http://127.0.0.1:${PORT}/"
    echo "Container: $CONTAINER_NAME"
    echo "WebUI storage volume: $WEBUI_STORAGE_VOLUME"
    echo "Stop after testing: docker rm -f $CONTAINER_NAME"
    exit 0
  fi
  sleep 1
done

echo "Timed out waiting for WebUI and external App Server readiness." >&2
exit 1

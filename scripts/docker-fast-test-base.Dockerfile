FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    sqlite3 \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /webui-storage

WORKDIR /repo
EXPOSE 4191

CMD ["node", "/repo/dist-cli/index.js", "--port", "4191", "--no-password", "--no-open"]

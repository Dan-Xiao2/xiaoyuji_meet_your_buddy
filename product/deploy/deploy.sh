#!/usr/bin/env bash
# Copies the app to the server and restarts it. Run on this computer, from product/:
#   XIAOYUJI_SERVER=root@服务器IP bash deploy/deploy.sh
# Sends only what the server runs (page, server, src, the assets it loads, the knowledge cards, the
# deploy folder); never .env, .certs, tests, docs, design drafts or benchmarks. The server's own
# .env and node_modules are kept. Packages are installed without running their install scripts.
set -euo pipefail

SERVER="${XIAOYUJI_SERVER:?请先设置 XIAOYUJI_SERVER，例如 root@服务器IP}"
APP_DIR=/opt/xiaoyuji/product
cd "$(dirname "$0")/.."

rsync -az --delete \
  --filter='P /.env' --filter='P /node_modules/' \
  --include='/index.html' --include='/package.json' --include='/package-lock.json' \
  --include='/server/***' --include='/src/***' --include='/deploy/***' \
  --include='/assets/' --include='/assets/xiaoyu-planet.png' --include='/assets/whiteboard/***' \
  --include='/skills/' --include='/skills/xiaoyu-growth-companion/' --include='/skills/xiaoyu-growth-companion/references/' \
  --include='/skills/xiaoyu-growth-companion/references/knowledge-cards.json' \
  --exclude='*' \
  ./ "${SERVER}:${APP_DIR}/"

ssh "$SERVER" "set -e
  cd ${APP_DIR}
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  chown -R root:xiaoyuji . && chmod -R o-rwx .
  if [ ! -f .env ]; then echo '服务器上还没有 .env：按 deploy/README.md 第 4 步填写后再启动。'; exit 0; fi
  chmod 640 .env
  systemctl restart xiaoyuji
  for i in 1 2 3 4 5; do sleep 1; curl -fsS http://127.0.0.1:4173/healthz && echo ' 已启动' && exit 0; done
  echo '没有启动成功：journalctl -u xiaoyuji -n 30'; exit 1"

#!/usr/bin/env bash
# One-time setup of a new server (Ubuntu 24.04, Alibaba Cloud China mainland), run as root on the
# server. Installs Node.js and Caddy, creates the service user and folders, turns on the firewall
# (SSH, 80, 443 only) and installs the systemd service. Safe to run again.
#   scp deploy/setup-server.sh deploy/xiaoyuji.service root@服务器IP:/root/
#   ssh root@服务器IP 'bash /root/setup-server.sh'
# Downloads come from the Ubuntu mirror and npmmirror.com (reachable from mainland servers).
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-22.22.3}"
APP_DIR=/opt/xiaoyuji/product
HERE="$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "请用 root 运行。"; exit 1; }

apt-get update
apt-get install -y ca-certificates curl xz-utils rsync ufw caddy

# Node.js from the npmmirror copy of nodejs.org, checked against its published checksum.
if [ "$(/usr/local/bin/node --version 2>/dev/null || true)" != "v${NODE_VERSION}" ]; then
  case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) echo "不支持的处理器：$(uname -m)"; exit 1 ;; esac
  name="node-v${NODE_VERSION}-linux-${arch}"
  base="https://npmmirror.com/mirrors/node/v${NODE_VERSION}"
  tmp="$(mktemp -d)"
  curl -fsSL "${base}/${name}.tar.xz" -o "${tmp}/${name}.tar.xz"
  curl -fsSL "${base}/SHASUMS256.txt" -o "${tmp}/SHASUMS256.txt"
  (cd "$tmp" && grep " ${name}.tar.xz\$" SHASUMS256.txt | sha256sum -c -)
  tar -xJf "${tmp}/${name}.tar.xz" -C /usr/local --strip-components=1 --exclude CHANGELOG.md --exclude LICENSE --exclude README.md
  rm -rf "$tmp"
fi
npm config set registry https://registry.npmmirror.com --location=global

id xiaoyuji >/dev/null 2>&1 || useradd --system --home-dir /opt/xiaoyuji --shell /usr/sbin/nologin xiaoyuji
install -d -o root -g xiaoyuji -m 750 /opt/xiaoyuji "$APP_DIR"

install -m 644 "$HERE/xiaoyuji.service" /etc/systemd/system/xiaoyuji.service
systemctl daemon-reload
systemctl enable xiaoyuji

# Caddy starts with its default page; deploy/enable-https.sh gives it the domain after the ICP filing.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "完成。Node $(/usr/local/bin/node --version)。下一步：在这台电脑上运行 deploy/deploy.sh，再在服务器上填写 ${APP_DIR}/.env。"

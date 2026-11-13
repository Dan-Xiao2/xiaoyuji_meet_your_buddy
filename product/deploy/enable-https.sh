#!/usr/bin/env bash
# After the ICP filing is approved and the domain points at this server: give Caddy the domain, so it
# gets the HTTPS certificate and forwards to the app. Run as root on the server:
#   ssh root@服务器IP 'bash /opt/xiaoyuji/product/deploy/enable-https.sh 你的域名'
set -euo pipefail

DOMAIN="${1:?用法：bash enable-https.sh 你的域名}"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { echo "域名格式不对：$DOMAIN"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"

sed "s/^DOMAIN {/${DOMAIN} {/" "$HERE/Caddyfile.example" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy || systemctl restart caddy
echo "已配置 https://${DOMAIN}/ 。证书一般在一分钟内申请好；查看：journalctl -u caddy -n 50"

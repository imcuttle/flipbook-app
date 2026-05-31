#!/usr/bin/env bash
#
# lan-domain-teardown.sh — 撤销 lan-domain-setup.sh 做的局域网域名映射
#
# 删除 dnsmasq 的解析 drop-in、停掉 Caddy 反代。dnsmasq 服务本身
# 默认保留（你机器上可能还有别的用途）；加 --stop-dnsmasq 可一并停掉。
#
# 用法:
#   scripts/lan-domain-teardown.sh [域名] [--stop-dnsmasq]
#   默认域名: flipbook.lan
#
set -euo pipefail

DOMAIN="flipbook.lan"
STOP_DNSMASQ=0
for arg in "$@"; do
  case "$arg" in
    --stop-dnsmasq) STOP_DNSMASQ=1 ;;
    *) DOMAIN="$arg" ;;
  esac
done

GRN=$'\033[32m'; YEL=$'\033[33m'; RST=$'\033[0m'
info() { printf '%s\n' "${GRN}▶${RST} $*"; }
warn() { printf '%s\n' "${YEL}⚠${RST} $*"; }

if [[ "$(uname -s)" != "Darwin" ]] || ! command -v brew >/dev/null 2>&1; then
  warn "非 macOS 或未装 Homebrew，无需撤销。"; exit 0
fi

PREFIX="$(brew --prefix)"
DROPIN="${PREFIX}/etc/dnsmasq.d/flipbook-lan.conf"
CADDY_DIR="${PREFIX}/etc/flipbook-lan"

# --- stop Caddy --------------------------------------------------------------
if command -v caddy >/dev/null 2>&1; then
  info "停止 Caddy 反代"
  sudo caddy stop >/dev/null 2>&1 || true
fi
[[ -d "${CADDY_DIR}" ]] && rm -rf "${CADDY_DIR}" && info "已删除 ${CADDY_DIR}"

# --- remove dnsmasq drop-in --------------------------------------------------
if [[ -f "${DROPIN}" ]]; then
  rm -f "${DROPIN}"
  info "已删除 dnsmasq 解析: ${DROPIN}"
  if [[ "${STOP_DNSMASQ}" == "1" ]]; then
    info "停止 dnsmasq 服务"
    sudo brew services stop dnsmasq || true
  else
    info "重启 dnsmasq 使解析失效（dnsmasq 服务保留）"
    sudo brew services restart dnsmasq || true
  fi
else
  warn "未找到 ${DROPIN}，可能已撤销或域名不同。"
fi

cat <<EOF

${GRN}已撤销 ${DOMAIN} 的本机映射。${RST}
若之前改过路由器/设备 DNS 或 hosts 指向本机,请按需自行还原。
EOF

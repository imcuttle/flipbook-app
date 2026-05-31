#!/usr/bin/env bash
#
# lan-domain-setup.sh — 把一个固定局域网域名指向本机服务（方案 B：dnsmasq + Caddy）
#
#   局域网里的设备访问  http://<域名>      （无需端口）
#   → dnsmasq 把 <域名> 解析到本机局域网 IP
#   → Caddy 监听 :80，把该域名反向代理到本地服务：
#       优先打 dev 端口(5173)，dev 不通时自动回退到 prod 端口(8787)
#
# 用法:
#   scripts/lan-domain-setup.sh [域名] [dev端口] [prod端口]
#   默认: flipbook.lan  5173  8787
#
# 依赖: macOS + Homebrew。脚本会自动安装 dnsmasq / caddy（若缺）。
# 需要 sudo（dnsmasq 监听 53、Caddy 监听 80）。
#
set -euo pipefail

DOMAIN="${1:-flipbook.lan}"
DEV_PORT="${2:-5173}"
PROD_PORT="${3:-8787}"

BOLD=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; YEL=$'\033[33m'; RED=$'\033[31m'; RST=$'\033[0m'
info() { printf '%s\n' "${GRN}▶${RST} $*"; }
warn() { printf '%s\n' "${YEL}⚠${RST} $*"; }
err()  { printf '%s\n' "${RED}✖${RST} $*" >&2; }

# --- preflight ---------------------------------------------------------------
if [[ "$(uname -s)" != "Darwin" ]]; then
  err "本脚本仅支持 macOS。"; exit 1
fi
if ! command -v brew >/dev/null 2>&1; then
  err "未找到 Homebrew。请先安装: https://brew.sh"; exit 1
fi

PREFIX="$(brew --prefix)"
DNSMASQ_CONF="${PREFIX}/etc/dnsmasq.conf"
DNSMASQ_D="${PREFIX}/etc/dnsmasq.d"
DROPIN="${DNSMASQ_D}/flipbook-lan.conf"
CADDY_DIR="${PREFIX}/etc/flipbook-lan"
CADDYFILE="${CADDY_DIR}/Caddyfile"

# --- detect LAN IP -----------------------------------------------------------
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [[ -z "${LAN_IP}" ]]; then
  err "无法探测局域网 IP（en0/en1 都没拿到）。请确认已连接 Wi-Fi/有线网络。"; exit 1
fi
info "局域网 IP: ${BOLD}${LAN_IP}${RST}"
info "域名 → 服务: ${BOLD}${DOMAIN}${RST} → dev:${BOLD}${DEV_PORT}${RST}（优先）→ prod:${BOLD}${PROD_PORT}${RST}（回退）"

# --- install deps ------------------------------------------------------------
for pkg in dnsmasq caddy; do
  if ! brew list --formula "${pkg}" >/dev/null 2>&1; then
    info "安装 ${pkg} …"
    brew install "${pkg}"
  fi
done

# --- dnsmasq: 解析 域名 → 本机 LAN IP ----------------------------------------
mkdir -p "${DNSMASQ_D}"
# 确保主配置启用 conf-dir（幂等）。注意：必须匹配「未注释」的 conf-dir 行
# —— Homebrew 的默认 dnsmasq.conf 里带有注释掉的 `#conf-dir=...`,若用不带
# 锚点的 grep 会误判为已启用,导致 drop-in 永不加载、解析不生效。
if [[ ! -f "${DNSMASQ_CONF}" ]] || ! grep -Eq "^[[:space:]]*conf-dir=${DNSMASQ_D}" "${DNSMASQ_CONF}" 2>/dev/null; then
  info "启用 dnsmasq conf-dir"
  printf '\n# added by flipbook lan-domain-setup\nconf-dir=%s/,*.conf\n' "${DNSMASQ_D}" >> "${DNSMASQ_CONF}"
fi
info "写入 dnsmasq 解析: ${DROPIN}"
cat > "${DROPIN}" <<EOF
# managed by flipbook lan-domain-setup.sh — do not edit by hand
address=/${DOMAIN}/${LAN_IP}
EOF

info "重启 dnsmasq（需要 sudo，监听 53 端口）"
sudo brew services restart dnsmasq

# --- Caddy: 反向代理 域名:80 → dev(优先) / prod(回退) -------------------------
mkdir -p "${CADDY_DIR}"
info "写入 Caddyfile: ${CADDYFILE}"
cat > "${CADDYFILE}" <<EOF
# managed by flipbook lan-domain-setup.sh — do not edit by hand
# HTTP only (.lan 无法签发受信任的公网证书，避免浏览器证书告警)
http://${DOMAIN} {
	# 两个上游：dev 在前、prod 在后。
	# lb_policy first = 永远先试第一个(dev)，仅当它被标记为不健康时才用下一个。
	# 被动健康检查：连不上/5xx 时把 dev 拉黑 3s，期间流量走 prod；
	# 之后再自动试探 dev，dev 起来了就切回去。
	reverse_proxy localhost:${DEV_PORT} localhost:${PROD_PORT} {
		lb_policy first
		fail_duration 3s
		max_fails 1
	}
}
EOF

# caddy start 是幂等的单实例 daemon；先停掉旧实例再起，避免端口占用
info "启动 Caddy（需要 sudo，监听 80 端口）"
sudo caddy stop >/dev/null 2>&1 || true
sudo caddy start --config "${CADDYFILE}" --adapter caddyfile

# --- verify ------------------------------------------------------------------
echo
info "本机自检解析:"
if dig +short "@127.0.0.1" "${DOMAIN}" | grep -q "${LAN_IP}"; then
  printf '   %s\n' "${GRN}${DOMAIN} → ${LAN_IP} ✓${RST}"
else
  warn "dnsmasq 解析自检未通过（可能 dnsmasq 尚未就绪，可稍后重试 dig @127.0.0.1 ${DOMAIN}）"
fi

cat <<EOF

${BOLD}本机已就绪。${RST}访问 http://${DOMAIN} 会优先打到 dev(${DEV_PORT})，
dev 没起时自动回退到 prod(${PROD_PORT})。

要让局域网里 ${BOLD}其它设备${RST} 也能用 http://${DOMAIN} 访问，
还需让它们的 DNS 指向本机（${LAN_IP}），三选一：

  ${BOLD}1) 路由器（推荐，全网生效）${RST}
     在路由器 DHCP 设置里，把「主 DNS」改为 ${LAN_IP}。

  ${BOLD}2) 每台设备手动设 DNS${RST}
     系统网络设置里把 DNS 服务器设为 ${LAN_IP}。

  ${BOLD}3) 每台设备改 hosts（最快，设备少时）${RST}
     在该设备的 hosts 文件加一行：
       ${LAN_IP}  ${DOMAIN}

${DIM}本机自己访问 http://${DOMAIN} 通常已可用（dnsmasq 在本机 53）。
若不通，把本机「Wi-Fi → DNS」也加上 ${LAN_IP}。${RST}

撤销: ${BOLD}npm run lan:down${RST}（或 scripts/lan-domain-teardown.sh ${DOMAIN}）
EOF


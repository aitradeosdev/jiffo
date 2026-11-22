#!/usr/bin/env bash
# Sets up, or updates the settings of, Jiffo's test server on an Ubuntu or Debian VPS (docs/deploy.md).
#
#   sudo deploy/setup.sh --email you@example.com [--domain example.com] [--ip 203.0.113.5]
#
# Without --domain, the server is reached at names made from its own IP address (api.203-0-113-5.sslip.io), so
# nothing has to be bought. Running it again keeps the secrets it made the first time: new ones would make the
# stored data unreadable.
set -euo pipefail
cd "$(dirname "$0")/.."

usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; }

EMAIL=""
DOMAIN=""
IP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --email) EMAIL="${2:-}"; shift 2 ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --ip) IP="${2:-}"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

[ "$(id -u)" = 0 ] || { echo "Run it as root: sudo deploy/setup.sh --email you@example.com" >&2; exit 1; }
[[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || {
  echo "Give an email with --email: it receives security reports and notices about the HTTPS certificates." >&2
  exit 1
}
if [ -n "$DOMAIN" ] && ! [[ "$DOMAIN" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]]; then
  echo "That doesn't look like a domain: $DOMAIN" >&2
  exit 1
fi

step() { printf '\n== %s\n' "$1"; }

step "Tools"
# A minimal image can lack these: curl for Docker and the IP address, openssl for the secrets.
if ! command -v curl >/dev/null 2>&1 || ! command -v openssl >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq curl openssl ca-certificates >/dev/null
fi
echo "curl and openssl are here."

step "Docker"
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Installing Docker from docker.com…"
  curl -fsSL https://get.docker.com | sh
else
  docker --version
fi

step "Swap"
# Building the admin panel needs more memory than a small server has: 2 GB of swap covers it.
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if [ "$mem_kb" -lt 3500000 ] && [ -z "$(swapon --show --noheadings)" ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  echo "Added 2 GB of swap."
else
  echo "Enough memory, or swap already on."
fi

step "Firewall"
# Only SSH, and HTTP and HTTPS for Caddy. The database, Redis and the API aren't published at all.
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null
  # SSH on another port too, wherever it listens, so this never locks you out.
  for port in $(ss -Htlnp 2>/dev/null | awk '/sshd/ {n = split($4, a, ":"); print a[n]}' | sort -u); do
    ufw allow "$port/tcp" >/dev/null
  done
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
  ufw --force enable >/dev/null
  ufw status | sed -n '1,12p'
else
  echo "No ufw here: allow only SSH, 80 and 443 in your VPS provider's firewall."
fi

step "Addresses"
if [ -n "$DOMAIN" ]; then
  API_HOST="api.$DOMAIN"
  ADMIN_HOST="admin.$DOMAIN"
  echo "Point both at this server with DNS A records: $API_HOST and $ADMIN_HOST."
else
  # The address the internet reaches this server at. Where it differs from the one the server sends from (a
  # floating IP, say), give it with --ip.
  if [ -z "$IP" ]; then
    IP=$(curl -4 -fsS https://api.ipify.org)
    echo "This server's public IP address looks like $IP. If phones reach it at another, run again with --ip."
  fi
  [[ "$IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo "Not an IP address: $IP" >&2; exit 1; }
  API_HOST="api.${IP//./-}.sslip.io"
  ADMIN_HOST="admin.${IP//./-}.sslip.io"
fi
echo "API:         https://$API_HOST"
echo "Admin panel: https://$ADMIN_HOST"

step "Secrets"
# Made here, once, and kept only on this server.
SECRETS=deploy/secrets.env
umask 077
if [ ! -f "$SECRETS" ]; then
  for name in JWT_SECRET OTP_SECRET PIN_KEY SECRETS_KEY ID_FINGERPRINT_KEY ADMIN_TOTP_KEY FIELD_KEY \
    ADMIN_TOKEN_SECRET ADMIN_PANEL_SECRET POSTGRES_PASSWORD REDIS_PASSWORD; do
    echo "$name=$(openssl rand -hex 32)"
  done >"$SECRETS"
  echo "Made new secrets in $SECRETS. Keep a copy somewhere safe: without them the data can't be read."
else
  echo "Keeping the secrets in $SECRETS."
fi
{
  echo "# Written by deploy/setup.sh. Change its options and run it again rather than editing this."
  echo "API_HOST=$API_HOST"
  echo "ADMIN_HOST=$ADMIN_HOST"
  echo "CONTACT_EMAIL=$EMAIL"
  cat "$SECRETS"
} >deploy/.env

step "Building and starting (the first build takes a few minutes)"
docker compose -f deploy/compose.yml up -d --build

step "Waiting for the API"
for _ in $(seq 1 60); do
  if docker compose -f deploy/compose.yml exec -T api \
    node -e "fetch('http://localhost:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" \
    >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 3
done
if [ -z "${ready:-}" ]; then
  echo "The API didn't start. Its log: sudo deploy/jiffo logs api" >&2
  exit 1
fi

cat <<EOF

Jiffo's test server is running.

  API:          https://$API_HOST
  Admin panel:  https://$ADMIN_HOST

Next, make yourself the first owner, with your own email and phone number. It prints your invite link:

  sudo deploy/jiffo admin invite --email $EMAIL --name "Your Name" --role owner --phone +2348012345678 --reason "First owner"

Then follow docs/deploy.md from "In the admin panel".
EOF

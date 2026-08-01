#!/usr/bin/env bash
set -euo pipefail

CERT_DIR="$(cd "$(dirname "$0")/.." && pwd)/data/certs"
CERT_FILE="$CERT_DIR/server.crt"
KEY_FILE="$CERT_DIR/server.key"
DAYS=3650

usage() {
  echo "使い方: $0 [WireGuard内IP ...]"
  echo "例:     $0 10.10.0.2 10.10.0.3"
  echo ""
  echo "証明書の生成先:"
  echo "  証明書: $CERT_FILE"
  echo "  秘密鍵: $KEY_FILE"
  exit 1
}

if ! command -v openssl &>/dev/null; then
  echo "エラー: openssl コマンドが見つかりません。インストールしてください。" >&2
  exit 1
fi

SAN_IPS=("127.0.0.1")
for ip in "$@"; do
  SAN_IPS+=("$ip")
done

SAN_LIST=""
idx=1
for ip in "${SAN_IPS[@]}"; do
  SAN_LIST="${SAN_LIST}IP.${idx} = ${ip}\n"
  idx=$((idx + 1))
done
SAN_LIST="${SAN_LIST}DNS.1 = localhost"

echo "=== server-manager-api TLS 証明書セットアップ ==="
echo ""
echo "SAN (Subject Alternative Names):"
for ip in "${SAN_IPS[@]}"; do
  echo "  IP: $ip"
done
echo "  DNS: localhost"
echo ""
echo "有効期限: ${DAYS}日 (約10年)"
echo ""

if [[ -f "$CERT_FILE" || -f "$KEY_FILE" ]]; then
  echo "既存の証明書が見つかりました:"
  [[ -f "$CERT_FILE" ]] && echo "  $CERT_FILE"
  [[ -f "$KEY_FILE" ]] && echo "  $KEY_FILE"
  echo ""
  read -r -p "上書きしますか？ [y/N]: " confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "キャンセルしました。"
    exit 0
  fi
fi

mkdir -p "$CERT_DIR"
chmod 700 "$CERT_DIR"

TMPCONF=$(mktemp /tmp/openssl-san-XXXXXX.cnf)
trap 'rm -f "$TMPCONF"' EXIT

cat > "$TMPCONF" <<EOF
[req]
default_bits       = 4096
default_md         = sha256
distinguished_name = req_distinguished_name
x509_extensions    = v3_req
prompt             = no

[req_distinguished_name]
CN = server-manager

[v3_req]
subjectAltName = @alt_names
keyUsage       = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
$(echo -e "$SAN_LIST")
EOF

openssl req -x509 -newkey rsa:4096 \
  -keyout "$KEY_FILE" \
  -out "$CERT_FILE" \
  -days "$DAYS" \
  -nodes \
  -config "$TMPCONF"

chmod 600 "$KEY_FILE"
chmod 644 "$CERT_FILE"

echo ""
echo "=== 証明書の生成が完了しました ==="
echo ""
echo "  証明書: $CERT_FILE"
echo "  秘密鍵: $KEY_FILE"
echo ""
echo "フィンガープリント (SHA-256):"
openssl x509 -noout -fingerprint -sha256 -in "$CERT_FILE"
echo ""
echo ".env への設定例:"
echo "  TLS_ENABLED=true"
echo "  TLS_CERT_PATH=$CERT_FILE"
echo "  TLS_KEY_PATH=$KEY_FILE"

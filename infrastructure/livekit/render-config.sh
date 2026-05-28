#!/usr/bin/env sh
set -eu

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created infrastructure/livekit/.env from .env.example. Review secrets before production use." >&2
fi

set -a
. ./.env
set +a

: "${LIVEKIT_REDIS_ADDRESS:=dev_golinelli_ai-redis-1:6379}"
: "${LIVEKIT_API_KEY:=devkey}"
: "${LIVEKIT_API_SECRET:=change-me-long-random-secret}"
: "${LIVEKIT_USE_EXTERNAL_IP:=false}"

awk \
  -v redis_address="$LIVEKIT_REDIS_ADDRESS" \
  -v api_key="$LIVEKIT_API_KEY" \
  -v api_secret="$LIVEKIT_API_SECRET" \
  -v use_external_ip="$LIVEKIT_USE_EXTERNAL_IP" \
  '{
    gsub(/\$\{LIVEKIT_REDIS_ADDRESS\}/, redis_address)
    gsub(/\$\{LIVEKIT_API_KEY\}/, api_key)
    gsub(/\$\{LIVEKIT_API_SECRET\}/, api_secret)
    gsub(/\$\{LIVEKIT_USE_EXTERNAL_IP\}/, use_external_ip)
    print
  }' config.yaml > config.generated.yaml

echo "Generated infrastructure/livekit/config.generated.yaml"

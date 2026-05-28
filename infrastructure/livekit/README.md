# LiveKit voice stack

Standalone LiveKit stack for EduAI classroom voice chat. The main app uses Socket.IO for room state and queue management, while browsers connect directly to LiveKit for Opus/WebRTC audio.

## Local setup

From this directory:

```bash
cp .env.example .env
./render-config.sh
docker compose up -d
```

Then set the main repository `.env` to the same API credentials:

```env
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=change-me-long-random-secret
LIVEKIT_TOKEN_TTL_MINUTES=90
```

Restart the app services that read `.env`:

```bash
docker compose up -d --build api frontend nginx
```

## Staging/production notes

LiveKit runs on **`livekit.golinelli.ai`** (dedicated VM). TURN relay is handled by a
separate **coturn** instance on **`turn.golinelli.ai`**.

### Firewall — livekit.golinelli.ai

| Port | Protocol | Purpose |
|------|----------|---------|
| 7880 | TCP | LiveKit API + WebSocket (put behind nginx/Caddy with TLS) |
| 7881 | TCP | WebRTC TCP fallback |
| 7882 | UDP | WebRTC UDP mux |
| 50000–50100 | UDP | WebRTC media relay range |

Port **3478 UDP is NOT needed here** — TURN runs on `turn.golinelli.ai`.

### Firewall — turn.golinelli.ai (coturn)

| Port | Protocol | Purpose |
|------|----------|---------|
| 3478 | UDP + TCP | TURN standard |
| 5349 | TCP + UDP | TURNS (TLS) |
| 49152–65535 | UDP | Relay media ports |

### coturn config (`/etc/turnserver.conf`)

```
realm=turn.golinelli.ai
server-name=turn.golinelli.ai
external-ip=<PUBLIC_IP_TURN_SERVER>
listening-port=3478
tls-listening-port=5349
cert=/etc/letsencrypt/live/turn.golinelli.ai/fullchain.pem
pkey=/etc/letsencrypt/live/turn.golinelli.ai/privkey.pem
use-auth-secret
static-auth-secret=<same value as TURN_SECRET in backend .env>
no-loopback-peers
no-multicast-peers
min-port=49152
max-port=65535
```

### Backend `.env` on the main app server

```env
LIVEKIT_URL=wss://livekit.golinelli.ai
LIVEKIT_API_KEY=<key>
LIVEKIT_API_SECRET=<secret>
LIVEKIT_TOKEN_TTL_MINUTES=90

TURN_HOST=turn.golinelli.ai
TURN_PORT=5349
TURN_SECRET=<same as static-auth-secret in coturn>
TURN_TTL_SECONDS=86400
```

### `infrastructure/livekit/.env` on the LiveKit server

```env
LIVEKIT_URL=wss://livekit.golinelli.ai
LIVEKIT_API_KEY=<same as backend>
LIVEKIT_API_SECRET=<same as backend>
LIVEKIT_REDIS_ADDRESS=<IP_MAIN_SERVER>:6379
LIVEKIT_USE_EXTERNAL_IP=true
```

### Deploy

```bash
./render-config.sh
docker compose up -d
```

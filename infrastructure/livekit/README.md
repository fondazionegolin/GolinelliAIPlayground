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

Use a real random `LIVEKIT_API_SECRET`, expose `LIVEKIT_URL` as `wss://voice.<domain>`, and open the required firewall ports:

- `7880/tcp` for LiveKit API/WebSocket, normally behind TLS reverse proxy.
- `7881/tcp` for WebRTC TCP fallback.
- `7882/udp` for UDP mux.
- `3478/udp` for embedded TURN.
- `50000-50100/udp` for WebRTC media in this compact configuration.

Set `LIVEKIT_USE_EXTERNAL_IP=true` when the service runs on a public VM.

The compose file joins the main Docker network through `LIVEKIT_DOCKER_NETWORK`; update it if the main compose project name differs.

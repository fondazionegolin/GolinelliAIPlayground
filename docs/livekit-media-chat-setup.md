# LiveKit media chat setup

This project uses the existing LiveKit room used for voice chat to publish:

- microphone audio
- camera video
- teacher screen sharing

The application backend still mints LiveKit JWTs through `POST /api/v1/voice/livekit-token`.

## Application changes

- The frontend `VoiceRoomPanel` subscribes to LiveKit audio and video tracks.
- Teachers can publish microphone, camera, and screen share.
- Students can publish microphone, camera, and screen share while they have the floor.
- The teacher can grant the floor to multiple students at the same time.
- Remote camera and screen-share tracks are rendered as compact thumbnails in the chat media panel.
- The media panel can be expanded to a dedicated full-screen videocall view.
- The chat sidebar is kept mounted when hidden on desktop, so active media sessions are not disconnected.
- Camera publishing supports `low` and `hi` quality presets.
- Screen sharing is published at a high-quality, low-frame-rate profile capped at 5fps.

No extra frontend environment variable is required. The browser receives the LiveKit URL, token, and optional ICE servers from the backend.

## Backend settings

Required:

```env
LIVEKIT_URL=wss://livekit.example.com
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_TOKEN_TTL_MINUTES=90
```

Optional, when using an external coturn server:

```env
TURN_HOST=turn.example.com
TURN_PORT=5349
TURN_SECRET=...
TURN_TTL_SECONDS=86400
```

`TURN_SECRET` must match coturn `static-auth-secret` when coturn is configured with `use-auth-secret`.

## LiveKit server requirements

The LiveKit server must be reachable by browsers over secure WebSocket:

```text
wss://livekit.example.com
```

Expose LiveKit signaling through HTTPS/WSS on port `443` via your reverse proxy.

LiveKit must also have working RTC ports. Typical options:

- UDP `7882` open to the internet for WebRTC media.
- TCP `7881` open if you enable LiveKit TCP fallback.
- A valid `rtc.node_ip` or `rtc.use_external_ip: true` so clients receive reachable candidates.

The API key and secret configured in LiveKit must match `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` in this app.

## TURN server requirements

TURN is needed for restrictive school, corporate, and mobile networks.

Recommended coturn basics:

```text
use-auth-secret
static-auth-secret=<same value as TURN_SECRET>
realm=turn.example.com
fingerprint
lt-cred-mech
no-multicast-peers
no-cli
cert=/path/fullchain.pem
pkey=/path/privkey.pem
listening-port=3478
tls-listening-port=5349
```

Open firewall ports:

- TCP `5349` for TURN over TLS.
- UDP `3478` for plain TURN UDP fallback.
- UDP relay range configured in coturn, for example `49152-65535/udp`.

DNS and TLS:

- `turn.example.com` must resolve publicly to the coturn server.
- TLS certificate must be valid for `turn.example.com`.

The app currently returns both:

```text
turns:<TURN_HOST>:<TURN_PORT>?transport=tcp
turn:<TURN_HOST>:3478?transport=udp
```

## Browser requirements

Camera, microphone, and screen share require a secure origin:

- production: HTTPS
- local development: `localhost` is accepted by browsers

Screen sharing cannot be started automatically. The browser must show the native picker after a user click.

# EduAI Platform

An AI-powered educational platform for schools, featuring multi-tenant architecture, LLM chatbot, ML no-code tools, and self-assessment capabilities.

## Architecture

- **Backend**: FastAPI with async SQLAlchemy
- **Frontend**: React with TypeScript + Vite
- **Database**: PostgreSQL with pgvector for embeddings
- **Cache/Queue**: Redis + Celery
- **Storage**: MinIO (S3-compatible)
- **LLM Providers**: OpenAI, Anthropic, DeepSeek, Gemini, OpenRouter, Ollama
- **Monitoring**: Prometheus + Grafana

## Features

- Multi-tenant support with Row Level Security
- Role-based access control (Admin, Teacher, Student)
- Real-time collaboration via Socket.IO
- LLM chatbot with multiple didactic modes
- RAG (Retrieval Augmented Generation) for document Q&A
- ML no-code module for tabular data experiments
- Self-assessment with lessons, quizzes, and badges
- Full audit logging and teacher controls

## Quick Start with Docker

```bash
# Copy environment file and configure
cp .env.example .env
# Edit .env with your settings

# Start all services
docker-compose up -d

# Run database migrations
docker-compose exec api alembic upgrade head

# Access the application at http://localhost
```

## Development Setup

### Prerequisites

- Python 3.11+
- Node.js 20+
- PostgreSQL 16+ with pgvector
- Redis 7+
- MinIO or S3-compatible storage

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run migrations
alembic upgrade head

# Start the server
uvicorn app.main:app --reload
```

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

- `DB_PASSWORD`: PostgreSQL password
- `SECRET_KEY`: JWT secret key (min 32 chars)
- `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`: MinIO credentials
- `OPENAI_API_KEY`: OpenAI API key (optional)
- `ANTHROPIC_API_KEY`: Anthropic API key (optional)
- `OPENROUTER_API_KEY`: OpenRouter key, used only by the backend (optional)

### OpenRouter: chatbot and video models

Add your key to the root `.env` file, which is ignored by Git. Do not put it in frontend
variables or source code:

```dotenv
OPENROUTER_API_KEY=your-key-here
```

Recreate both backend services to load the key (a plain restart does not reload Compose environment files):

```bash
docker compose -p dev_golinelli_ai up -d --force-recreate --no-deps api api-pool
```

In **Admin → Modelli**, run the model scan and filter by **OpenRouter**. New models
start as **Rilevato**, with no automatic distribution. Text prices come from OpenRouter's
API and are converted from USD/token to USD/million tokens; later price changes require
admin approval. Tick the desired text models in the admin checkbox list to make them
available to teacher and student chatbots. Ticking a priced discovered model also activates it.
Only checked models with configured providers appear in menus; even the platform default can
be unchecked. Empty selections remain empty across scans and restarts. Model dropdowns support
search by name, ID and provider. Students can also choose the model for text teacherbot chats.
Excel `.xls` and `.xlsx` attachments are extracted across all sheets in these chats; document
context is retained for follow-up questions. Common LaTeX delimiters render through KaTeX. The roles panel can assign OpenRouter
models to compatible chat features, including the platform default; native provider features
such as Realtime keep their existing compatibility restrictions. Role assignment performs
a short real API call and can consume credits.

For videos, select the **Video** tab and activate the desired models. In **Video Studio**,
choose a model, duration and resolution before rendering. The backend validates those options
against the live `/videos/models` catalogue, sends the storyboard image as the first frame,
polls the asynchronous job and stores the result in the existing project storage. The local
image animation option remains available. Storyboard image generation still requires
`OPENAI_API_KEY`; OpenRouter replaces the video rendering stage. Video generation spends
OpenRouter credits, and the returned generation cost is added to the project's USD total;
the platform's chatbot token budget does not limit this admin-only video flow.

Backend routes (admin authentication required):

- `POST /api/v1/admin/models/scan`: discover text/video models and update price proposals.
- `GET /api/v1/admin/video-studio/video-models`: active video models and live capabilities.
- `POST /api/v1/admin/video-studio/projects/{id}/render`: render with, for example,
  `{"provider":"openrouter","model":"<active-model-id>","duration":4,"resolution":"720p"}`.
  Use values advertised by the selected model. Omitting `provider` uses local animation.

Reference: [OpenRouter chat API](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request)
and [video generation](https://openrouter.ai/docs/guides/overview/multimodal/video-generation).

## Voice Lab and starter teacherbots

Teachers and admins can open **Crea → Voice Lab** (`/teacher/voice-lab`); student
accounts cannot call its APIs. Set `ELEVENLABS_API_KEY` in the root `.env` and recreate
`api` and `api-pool` with the explicit development project `dev_golinelli_ai` to load it.
The API key stays on the server. `ELEVENLABS_TTS_MODEL` selects the initial speech model;
Standard ElevenLabs API rates are converted automatically into platform credits; see [Voice Lab](docs/voice-lab.md). `ELEVENLABS_COST_PER_1000_CHARS` is deprecated.
Other services depend on the connected ElevenLabs plan and consume its quota.

The workspace includes text-to-speech, multi-voice dialogue, instant voice cloning,
voice design/remix and saving, voice changing, transcription, audio isolation, sound
effects, music, dubbing and forced alignment. Generated files are private and saved
in both the Voice Lab library and the teacher's Files. Cloned/designed voices are
private to their creator; recordings and generated audio are never exposed through
public upload URLs. Dubbing jobs can be reopened from the library and refreshed.
Voice verification, if required by ElevenLabs, must be completed in the provider account.

**Admin → Chatbot → Teacherbot per tutti** has independent student and teacher lists.
Choose admin-created bots from its searchable dropdowns. Students receive them alongside
their class publications; teachers can find them in Teacherbot and the assistant selector.
Global bots are usable across tenants, while editing and private conversation history
remain restricted to their owners. Teacher chats are persisted on the server.

Migration `115_voice_lab` creates the private library. The navbar cover is
`frontend/public/illustrations/nav/voice-lab.webp`; its generation prompt is saved in
`docs/assets/voice-lab-cover-prompt.txt`.
API reference: [ElevenLabs](https://elevenlabs.io/docs/api-reference/introduction),
[official OpenAPI schema](https://api.elevenlabs.io/openapi.json).

## Project Structure

```
├── backend/
│   ├── app/
│   │   ├── api/          # REST API endpoints
│   │   ├── core/         # Config, security, database
│   │   ├── models/       # SQLAlchemy ORM models
│   │   ├── schemas/      # Pydantic schemas
│   │   ├── services/     # Business logic services
│   │   ├── workers/      # Celery tasks
│   │   └── realtime/     # Socket.IO gateway
│   └── alembic/          # Database migrations
├── frontend/
│   └── src/
│       ├── components/   # UI components
│       ├── pages/        # Page components
│       ├── stores/       # Zustand stores
│       └── lib/          # Utilities and API client
├── infrastructure/
│   ├── nginx/            # Reverse proxy config
│   ├── postgres/         # Database init scripts
│   ├── prometheus/       # Metrics config
│   └── grafana/          # Dashboard provisioning
└── docker-compose.yml    # Full stack deployment
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| nginx | 80, 443 | Reverse proxy |
| api | 8000 | FastAPI backend |
| frontend | - | React SPA |
| postgres | 5432 | PostgreSQL + pgvector |
| redis | 6379 | Cache and message broker |
| minio | 9000, 9001 | Object storage |
| ollama | 11434 | Local LLM inference |
| prometheus | 9090 | Metrics collection |
| grafana | 3001 | Monitoring dashboards |

## Direct document links and QR codes

Document and presentation editors expose **Condividi link e QR code** for teachers and students' own documents. Choose **Sola lettura** or **Può modificare**, then create a link, copy it or download its QR image. The two permissions have independent, revocable links. Guests open `/d/<token>` without an account; edit links save to the original with an explicit save button. A stale revision returns a conflict so guests can download their unsaved changes before reloading. Teacher drafts retain a checkpoint before anonymous edits. Published teacher documents can also be shared; students cannot grant access to teacher lessons or submitted work.

Link management requires source ownership/access. Public image access is limited to files explicitly authorized by the sharer. Database migration `127_document_share_links` adds persistent capability links; no Google or external sharing service is required.

## Google Docs and Slides export

The document and presentation editors offer **Google Docs** and **Google Slides** in the export menu for teachers and students. The dialog opens Google's account chooser, shows the selected account, then creates an editable native file in that account's **My Drive** and opens it in a new tab. Each export creates a separate copy. Spreadsheets are excluded.

To enable the integration:

1. Enable Google Drive API in a Google Cloud project and configure its OAuth consent screen.
2. Create an OAuth client of type **Web application** and register the exact platform origins (scheme, host and port) under **Authorized JavaScript origins**, including the development origin if needed. This popup token flow does not need a client secret or redirect URI.
3. Configure the `https://www.googleapis.com/auth/drive.file` scope. Add test users while the OAuth app is in testing; Workspace administrators may need to allow the app.
4. Set `GOOGLE_WORKSPACE_CLIENT_ID` in `.env` and recreate the API services with the explicit development project name: `docker compose -p dev_golinelli_ai up -d --no-deps api api-pool`.

Only the public client ID is exposed by the authenticated configuration endpoint. Short-lived access tokens stay in dialog memory and are sent directly to Google; passwords and refresh tokens are never stored. The integration loads Google Identity Services only when opening the export dialog. With no configured client ID, the dialog explains that export is unavailable.

Compatibility uses the existing rich DOCX/PPTX exporters followed by Google's native import, preserving editable content rather than flattening pages to images. Google may adjust unsupported fonts, effects, embedded media or advanced layouts; pixel-perfect conversion is not guaranteed. Large files use a resumable upload session. If the browser blocks the new tab, the success dialog retains an **Open** link to the created file.

References: [Google token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [Drive uploads and native conversion](https://developers.google.com/workspace/drive/api/guides/manage-uploads).

## License

MIT

# EduAI Platform

An AI-powered educational platform for schools, featuring multi-tenant architecture, LLM chatbot, ML no-code tools, and self-assessment capabilities.

## Architecture

- **Backend**: FastAPI with async SQLAlchemy
- **Frontend**: React with TypeScript + Vite
- **Database**: PostgreSQL with pgvector for embeddings
- **Cache/Queue**: Redis + Celery
- **Storage**: MinIO (S3-compatible)
- **LLM Providers**: OpenAI, Anthropic, Ollama
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

## License

MIT

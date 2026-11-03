#!/usr/bin/env sh
set -eu

# The pool waits for the gateway, which owns the migrations: running alembic from
# several containers at once would race.
if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
  echo "[api] Running database migrations (alembic upgrade head)..."
  retries=30
  attempt=1

  until alembic upgrade head; do
    if [ "$attempt" -ge "$retries" ]; then
      echo "[api] Alembic migration failed after ${retries} attempts."
      exit 1
    fi
    echo "[api] Alembic attempt ${attempt}/${retries} failed. Retrying in 3s..."
    attempt=$((attempt + 1))
    sleep 3
  done
  echo "[api] Migrations applied."
fi

echo "[api] Starting uvicorn (role=${API_ROLE:-gateway}, workers=${UVICORN_WORKERS:-1})..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers "${UVICORN_WORKERS:-1}"

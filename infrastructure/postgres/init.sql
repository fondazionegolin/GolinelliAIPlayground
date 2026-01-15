-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create initial admin user (password: admin123 - CHANGE IN PRODUCTION)
-- This will be handled by Alembic migrations, but we ensure extensions are ready

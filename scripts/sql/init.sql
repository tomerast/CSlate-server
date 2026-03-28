-- Runs once when the Docker container is first created
-- Enables pgvector extension on the dev database

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- For text search
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

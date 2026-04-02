-- Enable extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- users
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL UNIQUE,
  "api_key_hash" text NOT NULL,
  "display_name" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

-- components
CREATE TABLE IF NOT EXISTS "components" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "tags" text[] NOT NULL DEFAULT '{}',
  "version" text NOT NULL DEFAULT '1.0.0',
  "category" text,
  "subcategory" text,
  "complexity" text CHECK (complexity IN ('simple', 'moderate', 'complex')),
  "summary" text,
  "context_summary" text,
  "author_id" uuid REFERENCES users(id) ON DELETE SET NULL,
  "manifest" jsonb NOT NULL,
  "embedding" vector(1536),
  "storage_key" text NOT NULL,
  "download_count" integer NOT NULL DEFAULT 0,
  "rating_sum" integer NOT NULL DEFAULT 0,
  "rating_count" integer NOT NULL DEFAULT 0,
  "parent_id" uuid,
  "flagged" boolean NOT NULL DEFAULT false,
  "revoked" boolean NOT NULL DEFAULT false,
  "revoke_reason" text CHECK (revoke_reason IN ('security', 'abuse', 'legal', 'author-request')),
  "revoked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_components_embedding ON components USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_components_tags ON components USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_components_category ON components(category);
CREATE INDEX IF NOT EXISTS idx_components_author ON components(author_id);
CREATE INDEX IF NOT EXISTS idx_components_name_author ON components(name, author_id);
CREATE INDEX IF NOT EXISTS idx_components_download ON components(download_count DESC);

-- uploads
CREATE TABLE IF NOT EXISTS "uploads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "author_id" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "manifest" jsonb NOT NULL,
  "storage_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'approved', 'rejected')),
  "current_stage" text,
  "completed_stages" jsonb NOT NULL DEFAULT '[]',
  "rejection_reasons" jsonb,
  "component_id" uuid REFERENCES components(id),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_uploads_author ON uploads(author_id);
CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status);

-- checkpoints
CREATE TABLE IF NOT EXISTS "checkpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "project_id" text NOT NULL,
  "component_local_id" text NOT NULL,
  "component_name" text NOT NULL,
  "version" integer NOT NULL,
  "manifest" jsonb NOT NULL,
  "storage_key" text NOT NULL,
  "description" text NOT NULL,
  "trigger" text NOT NULL CHECK (trigger IN ('user-accepted', 'manual', 'before-major-change', 'auto-interval')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, project_id, component_local_id, version)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_user_project ON checkpoints(user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_component ON checkpoints(user_id, component_local_id);

-- ratings
CREATE TABLE IF NOT EXISTS "ratings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "component_id" uuid NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "rating" integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  "comment" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  UNIQUE(component_id, user_id)
);

-- reports
CREATE TABLE IF NOT EXISTS "reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "component_id" uuid NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  "reporter_id" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "reason" text NOT NULL CHECK (reason IN ('malicious', 'broken', 'inappropriate', 'copyright', 'other')),
  "description" text,
  "status" text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  UNIQUE(component_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS idx_reports_component ON reports(component_id);

-- rate_limits
CREATE TABLE IF NOT EXISTS "rate_limits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "endpoint_group" text NOT NULL,
  "window_start" timestamptz NOT NULL,
  "count" integer NOT NULL DEFAULT 1,
  UNIQUE(user_id, endpoint_group, window_start)
);

-- download_events (partitioned)
CREATE TABLE IF NOT EXISTS "download_events" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "component_id" uuid NOT NULL,
  "user_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

-- Create initial partitions (current + next 2 months)
DO $$
DECLARE
  d DATE := DATE_TRUNC('month', NOW())::DATE;
  i INT;
BEGIN
  FOR i IN 0..2 LOOP
    DECLARE
      start_date DATE := (d + (i || ' months')::INTERVAL)::DATE;
      end_date DATE := (d + ((i + 1) || ' months')::INTERVAL)::DATE;
      partition_name TEXT := 'download_events_' || TO_CHAR(start_date, 'YYYY_MM');
    BEGIN
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF download_events FOR VALUES FROM (%L) TO (%L)',
        partition_name, start_date, end_date
      );
    END;
  END LOOP;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_download_events_component_time ON download_events(component_id, created_at DESC);

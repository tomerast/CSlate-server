-- Migration: Add pipelines and pipeline_uploads tables

CREATE TABLE IF NOT EXISTS "pipelines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "pipeline_id" text NOT NULL,
  "description" text NOT NULL,
  "tags" text[] NOT NULL DEFAULT '{}',
  "version" text NOT NULL DEFAULT '1.0.0',
  "category" text,
  "subcategory" text,
  "complexity" text CHECK (complexity IN ('simple', 'moderate', 'complex')),
  "strategy_type" text NOT NULL CHECK (strategy_type IN ('on-demand', 'polling', 'streaming')),
  "secret_names" text[] NOT NULL DEFAULT '{}',
  "output_schema" jsonb,
  "summary" text,
  "context_summary" text,
  "author_id" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "manifest" jsonb NOT NULL,
  "embedding" vector(1536),
  "storage_key" text,
  "download_count" integer NOT NULL DEFAULT 0,
  "rating_sum" integer NOT NULL DEFAULT 0,
  "rating_count" integer NOT NULL DEFAULT 0,
  "parent_id" uuid,
  "flagged" boolean NOT NULL DEFAULT false,
  "revoked" boolean NOT NULL DEFAULT false,
  "revoke_reason" text CHECK (revoke_reason IN ('security', 'abuse', 'legal', 'author-request')),
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipelines_embedding ON pipelines USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_pipelines_tags ON pipelines USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_pipelines_category ON pipelines(category);
CREATE INDEX IF NOT EXISTS idx_pipelines_author ON pipelines(author_id);
CREATE INDEX IF NOT EXISTS idx_pipelines_name_author ON pipelines(name, author_id);
CREATE INDEX IF NOT EXISTS idx_pipelines_download ON pipelines(download_count DESC);
CREATE INDEX IF NOT EXISTS idx_pipelines_strategy ON pipelines(strategy_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipelines_pipeline_id ON pipelines(pipeline_id);

CREATE TABLE IF NOT EXISTS "pipeline_uploads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "author_id" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "manifest" jsonb NOT NULL,
  "storage_key" text,
  "status" text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'approved', 'rejected')),
  "current_stage" text,
  "completed_stages" jsonb NOT NULL DEFAULT '[]',
  "rejection_reasons" jsonb,
  "pipeline_id" uuid REFERENCES pipelines(id),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_uploads_author ON pipeline_uploads(author_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_uploads_status ON pipeline_uploads(status);

CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"category" text,
	"subcategory" text,
	"complexity" text,
	"summary" text,
	"context_summary" text,
	"author_id" uuid,
	"manifest" jsonb NOT NULL,
	"storage_key" text NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"rating_sum" integer DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"parent_id" uuid,
	"flagged" boolean DEFAULT false NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"revoke_reason" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"manifest" jsonb NOT NULL,
	"storage_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_stage" text,
	"completed_stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rejection_reasons" jsonb,
	"component_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" text NOT NULL,
	"component_local_id" text NOT NULL,
	"component_name" text NOT NULL,
	"version" integer NOT NULL,
	"manifest" jsonb NOT NULL,
	"storage_key" text NOT NULL,
	"description" text NOT NULL,
	"trigger" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_checkpoints_version" UNIQUE("user_id","project_id","component_local_id","version")
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_ratings_user_component" UNIQUE("component_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_reports_user_component" UNIQUE("component_id","reporter_id")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint_group" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "uq_rate_limits_window" UNIQUE("user_id","endpoint_group","window_start")
);
--> statement-breakpoint
CREATE TABLE "download_events" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"component_id" uuid NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"pipeline_id" text NOT NULL,
	"description" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"category" text,
	"subcategory" text,
	"complexity" text,
	"strategy_type" text NOT NULL,
	"secret_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"output_schema" jsonb,
	"summary" text,
	"context_summary" text,
	"author_id" uuid NOT NULL,
	"manifest" jsonb NOT NULL,
	"storage_key" text,
	"download_count" integer DEFAULT 0 NOT NULL,
	"rating_sum" integer DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"parent_id" uuid,
	"flagged" boolean DEFAULT false NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"revoke_reason" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"manifest" jsonb NOT NULL,
	"storage_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_stage" text,
	"completed_stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rejection_reasons" jsonb,
	"pipeline_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviewer_standards" (
	"id" text PRIMARY KEY NOT NULL,
	"dimension" integer NOT NULL,
	"rule" text NOT NULL,
	"rationale" text NOT NULL,
	"examples_good" jsonb DEFAULT '[]'::jsonb,
	"examples_bad" jsonb DEFAULT '[]'::jsonb,
	"source" text NOT NULL,
	"confidence" real DEFAULT 50,
	"created_at" timestamp with time zone DEFAULT now(),
	"last_confirmed_at" timestamp with time zone,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reviewer_patterns" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"pattern_desc" text NOT NULL,
	"regex" text,
	"dimension" integer NOT NULL,
	"occurrences" integer DEFAULT 0 NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"examples" jsonb DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE TABLE "review_outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"upload_id" text NOT NULL,
	"verdict" text NOT NULL,
	"dimension_scores" jsonb NOT NULL,
	"findings" jsonb NOT NULL,
	"post_review_signals" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_corrections" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"finding_id" text NOT NULL,
	"correction_type" text NOT NULL,
	"original_severity" text NOT NULL,
	"original_dimension" integer NOT NULL,
	"corrected_severity" text NOT NULL,
	"corrected_dimension" integer NOT NULL,
	"reason" text NOT NULL,
	"corrected_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviewer_dimension_weights" (
	"id" text PRIMARY KEY NOT NULL,
	"dimension" integer NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"strictness_level" text DEFAULT 'standard' NOT NULL,
	"adjusted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviewer_knowledge_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"change_type" text NOT NULL,
	"change_description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_costs" (
	"id" text PRIMARY KEY NOT NULL,
	"upload_id" text NOT NULL,
	"phase" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"estimated_cost" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviewer_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"max_concurrent_reviews" integer DEFAULT 5,
	"max_reviews_per_hour" integer DEFAULT 30,
	"review_throttle_seconds" integer DEFAULT 10,
	"pause_reviews" boolean DEFAULT false,
	"max_llm_cost_per_day" real DEFAULT 50,
	"max_expert_agent_iterations" integer DEFAULT 12,
	"max_red_team_iterations" integer DEFAULT 10,
	"max_judge_iterations" integer DEFAULT 12,
	"quality_threshold" integer DEFAULT 70,
	"max_warnings" integer DEFAULT 5,
	"model_overrides" jsonb DEFAULT '{}'::jsonb,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "components" ADD CONSTRAINT "components_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_component_id_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_component_id_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_component_id_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_uploads" ADD CONSTRAINT "pipeline_uploads_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_uploads" ADD CONSTRAINT "pipeline_uploads_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_components_tags" ON "components" USING btree ("tags");--> statement-breakpoint
CREATE INDEX "idx_components_category" ON "components" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_components_author" ON "components" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "idx_components_name_author" ON "components" USING btree ("name","author_id");--> statement-breakpoint
CREATE INDEX "idx_components_download" ON "components" USING btree ("download_count");--> statement-breakpoint
CREATE INDEX "idx_uploads_author" ON "uploads" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "idx_uploads_status" ON "uploads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_checkpoints_user_project" ON "checkpoints" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE INDEX "idx_checkpoints_component" ON "checkpoints" USING btree ("user_id","component_local_id");--> statement-breakpoint
CREATE INDEX "idx_reports_component" ON "reports" USING btree ("component_id");--> statement-breakpoint
CREATE INDEX "idx_pipelines_tags" ON "pipelines" USING btree ("tags");--> statement-breakpoint
CREATE INDEX "idx_pipelines_category" ON "pipelines" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_pipelines_author" ON "pipelines" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "idx_pipelines_name_author" ON "pipelines" USING btree ("name","author_id");--> statement-breakpoint
CREATE INDEX "idx_pipelines_download" ON "pipelines" USING btree ("download_count");--> statement-breakpoint
CREATE INDEX "idx_pipelines_strategy" ON "pipelines" USING btree ("strategy_type");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_pipelines_pipeline_id" ON "pipelines" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX "idx_pipeline_uploads_author" ON "pipeline_uploads" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "idx_pipeline_uploads_status" ON "pipeline_uploads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_reviewer_standards_dimension" ON "reviewer_standards" USING btree ("dimension");--> statement-breakpoint
CREATE INDEX "idx_review_outcomes_upload" ON "review_outcomes" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "idx_review_outcomes_verdict" ON "review_outcomes" USING btree ("verdict");--> statement-breakpoint
CREATE INDEX "idx_dimension_weights_dim" ON "reviewer_dimension_weights" USING btree ("dimension");
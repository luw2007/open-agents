CREATE TABLE "task_node_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"node_type" text NOT NULL,
	"iteration" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"output_summary" text,
	"tool_call_count" integer DEFAULT 0,
	"token_usage" jsonb,
	"verify_result" jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'planning' NOT NULL,
	"current_phase" text,
	"priority" text DEFAULT 'P2',
	"prd" text NOT NULL,
	"plan" text,
	"workflow_run_id" text,
	"verify_commands" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "task_node_runs" ADD CONSTRAINT "task_node_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_node_runs_task_id_idx" ON "task_node_runs" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_session_slug_idx" ON "tasks" USING btree ("session_id","slug");--> statement-breakpoint
CREATE INDEX "tasks_session_id_idx" ON "tasks" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "tasks_user_id_idx" ON "tasks" USING btree ("user_id");
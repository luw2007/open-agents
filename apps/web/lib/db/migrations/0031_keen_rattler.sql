DROP TABLE "vercel_project_links" CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "vercel_project_id";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "vercel_project_name";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "vercel_team_id";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "vercel_team_slug";
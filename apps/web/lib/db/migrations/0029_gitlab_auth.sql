-- Add gitlab as a valid provider for users table
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_provider_check";
ALTER TABLE "users" ADD CONSTRAINT "users_provider_check"
  CHECK (provider IN ('github', 'vercel', 'gitlab'));

-- Update default_sandbox_type to support srt, default to srt
ALTER TABLE "user_preferences" DROP CONSTRAINT IF EXISTS "user_preferences_default_sandbox_type_check";
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_default_sandbox_type_check"
  CHECK (default_sandbox_type IN ('vercel', 'srt'));
ALTER TABLE "user_preferences" ALTER COLUMN "default_sandbox_type" SET DEFAULT 'srt';

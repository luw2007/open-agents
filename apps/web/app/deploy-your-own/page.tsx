import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Deploy your own",
  description: "Deploy your own copy of Open Agents.",
};

export const REQUIRED_ENV_VARS = [
  "POSTGRES_URL",
  "JWE_SECRET",
  "ENCRYPTION_KEY",
  "GITLAB_URL",
  "GITLAB_CLIENT_ID",
  "GITLAB_CLIENT_SECRET",
  "GITLAB_BOT_ACCESS_TOKEN",
  "GITLAB_WEBHOOK_SECRET",
] as const;

export default function DeployYourOwnPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-24 text-foreground">
      <div className="flex max-w-xl flex-col items-center text-center">
        <p className="text-sm font-medium text-muted-foreground">Open Agents</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">
          Self-hosted deployment
        </h1>
        <p className="mt-4 text-base leading-7 text-muted-foreground">
          See the <code>.env.example</code> file for the required environment
          variables to run your own instance.
        </p>
      </div>
    </main>
  );
}

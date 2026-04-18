"use client";

import { Loader2 } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";

function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
    </svg>
  );
}

function resolveRedirectPath(value: string): string {
  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin === window.location.origin) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return window.location.pathname + window.location.search;
  }

  return window.location.pathname + window.location.search;
}

type SignInButtonProps = {
  callbackUrl?: string;
} & Omit<ComponentProps<typeof Button>, "onClick">;

export function SignInButton({
  callbackUrl,
  disabled,
  ...props
}: SignInButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  function handleSignIn() {
    if (disabled || isLoading) {
      return;
    }

    const fallback = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const redirectPath = resolveRedirectPath(callbackUrl ?? fallback);
    const encodedRedirect = encodeURIComponent(redirectPath);
    const destination = `/api/auth/signin/gitlab?next=${encodedRedirect}`;

    setIsLoading(true);
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        window.location.assign(destination);
      }, 0);
    });
  }

  return (
    <Button
      {...props}
      aria-busy={isLoading}
      disabled={disabled || isLoading}
      onClick={handleSignIn}
    >
      {isLoading ? <Loader2 className="animate-spin" /> : <GitLabIcon />}
      {isLoading ? "Signing in..." : "Sign in with GitLab"}
    </Button>
  );
}

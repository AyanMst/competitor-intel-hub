"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { RouteError } from "@/components/ui/route-error";
import "./globals.css";

// Root-layout crash boundary (must render its own <html>/<body>).
// Sentry capture lives here — not in business-logic try/except blocks.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-full antialiased">
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="w-full max-w-md">
            <RouteError
              title="Something went wrong"
              description="This page hit an unexpected error."
              detail={error.message}
              onRetry={reset}
            />
          </div>
        </div>
      </body>
    </html>
  );
}

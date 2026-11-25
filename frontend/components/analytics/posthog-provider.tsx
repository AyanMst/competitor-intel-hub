"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { createClient } from "@/lib/supabase/client";
import { identifyUser, trackSignupIfNewAccount } from "@/lib/analytics";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

let initialized = false;

function initPosthog(): void {
  if (initialized || !POSTHOG_KEY || typeof window === "undefined") return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: false,
    capture_pageleave: true,
    persistence: "localStorage",
  });
  initialized = true;
}

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!POSTHOG_KEY) return;
    initPosthog();
    let url = window.origin + pathname;
    const query = searchParams.toString();
    if (query) url += `?${query}`;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

function AuthConversions() {
  useEffect(() => {
    if (!POSTHOG_KEY) return;
    initPosthog();
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      if (!user) return;
      identifyUser(user.id);
      trackSignupIfNewAccount({ id: user.id, created_at: user.created_at });
    });
  }, []);

  return null;
}

/**
 * Layout-level PostHog. Pageviews + signup identification live here.
 * first_battlecard_generated / paywall_hit fire from UI surfaces only.
 */
export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPosthog();
  }, []);

  if (!POSTHOG_KEY) {
    return <>{children}</>;
  }

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      <AuthConversions />
      {children}
    </PHProvider>
  );
}

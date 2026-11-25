"use client";

import posthog from "posthog-js";
import { listReports } from "@/lib/api";

/**
 * Product analytics event names (frontend only).
 * Mirrored in config.yaml observability.analytics.events.
 * Do not fire these from job_worker.py or any backend job path.
 */
export const AnalyticsEvents = {
  SIGNUP: "signup",
  FIRST_BATTLECARD_GENERATED: "first_battlecard_generated",
  PAYWALL_HIT: "paywall_hit",
} as const;

export type AnalyticsEventName =
  (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

function analyticsEnabled(): boolean {
  return typeof window !== "undefined" && Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
}

export function trackEvent(
  name: AnalyticsEventName,
  properties?: Record<string, unknown>,
): void {
  if (!analyticsEnabled()) return;
  posthog.capture(name, properties);
}

export function identifyUser(userId: string): void {
  if (!analyticsEnabled()) return;
  posthog.identify(userId);
}

export function trackOnce(
  storageKey: string,
  name: AnalyticsEventName,
  properties?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(storageKey)) return;
    trackEvent(name, properties);
    window.localStorage.setItem(storageKey, "1");
  } catch {
    trackEvent(name, properties);
  }
}

export function trackOncePerSession(
  storageKey: string,
  name: AnalyticsEventName,
  properties?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  try {
    if (window.sessionStorage.getItem(storageKey)) return;
    trackEvent(name, properties);
    window.sessionStorage.setItem(storageKey, "1");
  } catch {
    trackEvent(name, properties);
  }
}

/** First authenticated session within 24h of account creation. */
export function trackSignupIfNewAccount(user: {
  id: string;
  created_at?: string;
}): void {
  const created = user.created_at ? Date.parse(user.created_at) : Number.NaN;
  const isNew =
    Number.isFinite(created) && Date.now() - created < 24 * 60 * 60 * 1000;
  if (!isNew) return;
  trackOnce(`cih:analytics:signup:${user.id}`, AnalyticsEvents.SIGNUP);
}

/**
 * Fires once when the signed-in user has at most one saved report
 * (the one that just completed, or none yet if the list is stale).
 * Never called from backend job processing.
 */
export async function trackFirstBattlecardGenerated(): Promise<void> {
  if (!analyticsEnabled()) return;
  try {
    const reports = await listReports();
    if (reports.length > 1) return;
    trackOnce(
      "cih:analytics:first_battlecard",
      AnalyticsEvents.FIRST_BATTLECARD_GENERATED,
      { report_count: reports.length },
    );
  } catch {
    // Analytics must never break the product surface.
  }
}

export function trackPaywallHit(source: "banner" | "generate"): void {
  trackOncePerSession("cih:analytics:paywall_hit", AnalyticsEvents.PAYWALL_HIT, {
    source,
  });
}

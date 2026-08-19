import {
  google,
  type youtube_v3,
  type youtubeAnalytics_v2,
  type youtubereporting_v1,
} from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import { googleAuth, handleInvalidGrant, isInvalidGrantError } from '../auth/googleAuth'
import { CapabilityError } from '../capabilities/types'
import { recordUsage, type QuotaEndpoint } from './quota'

/**
 * Thin wrappers over the two YouTube APIs.
 *
 * Everything goes through here so that no call can bypass the quota ledger, and
 * so `invalid_grant` is handled in exactly one place. Feature code never touches
 * `googleapis` directly.
 *
 * Two APIs, two quotas:
 *   - Data API (youtube)          — 10,000 units/day, the scarce one.
 *   - Analytics API (youtubeAnalytics) — separate quota, request-based, generous.
 * Only Data API calls are metered here.
 */

export interface YouTubeClients {
  data: youtube_v3.Youtube
  analytics: youtubeAnalytics_v2.Youtubeanalytics
}

export function getYouTubeClients(): YouTubeClients {
  const auth = googleAuth.getClient()
  if (!auth) {
    throw new CapabilityError(
      'No Google account connected. Connect one in Settings first.',
      'not_connected'
    )
  }
  if (!googleAuth.hasScopes('youtube')) {
    throw new CapabilityError(
      'Your Google account is connected but has not granted YouTube access. ' +
        'Reconnect in Settings to approve the YouTube scopes.',
      'not_connected'
    )
  }
  return clientsFor(auth)
}

function clientsFor(auth: OAuth2Client): YouTubeClients {
  return {
    data: google.youtube({ version: 'v3', auth }),
    analytics: google.youtubeAnalytics({ version: 'v2', auth }),
  }
}

/**
 * Runs a Data API call, meters it, and translates the failures worth
 * distinguishing into errors the model can report honestly.
 */
export async function meteredCall<T>(
  endpoint: QuotaEndpoint,
  fn: () => Promise<T>
): Promise<T> {
  try {
    const result = await fn()
    // Recorded only on success: a request that failed before reaching Google
    // (offline, DNS) costs nothing, and over-reporting would refuse syncs that
    // are actually affordable.
    recordUsage(endpoint)
    return result
  } catch (err) {
    if (isInvalidGrantError(err)) {
      throw new CapabilityError(handleInvalidGrant(`YouTube ${endpoint}`), 'not_connected')
    }

    const reason = quotaReason(err)
    if (reason) {
      // Google rejected it, but it still counted against the daily allowance.
      recordUsage(endpoint)
      throw new CapabilityError(
        `YouTube API quota exhausted (${reason}). It resets at midnight Pacific.`,
        'handler_failed'
      )
    }

    throw new CapabilityError(
      `YouTube ${endpoint} failed: ${(err as Error)?.message ?? String(err)}`,
      'handler_failed'
    )
  }
}

function quotaReason(err: unknown): string | null {
  const errors = (err as { errors?: Array<{ reason?: string }> })?.errors ?? []
  const reason = errors.find((e) =>
    ['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded'].includes(e.reason ?? '')
  )?.reason
  return reason ?? null
}

/** Analytics API calls are unmetered here but share the same auth failure handling. */
export async function analyticsCall<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isInvalidGrantError(err)) {
      throw new CapabilityError(handleInvalidGrant(`YouTube Analytics ${label}`), 'not_connected')
    }
    throw new CapabilityError(
      `YouTube Analytics ${label} failed: ${(err as Error)?.message ?? String(err)}`,
      'handler_failed'
    )
  }
}

/**
 * The Reporting API client.
 *
 * A third Google surface, sharing the `yt-analytics.readonly` scope the
 * Analytics calls already hold — so a connected account needs no further
 * consent to use it.
 */
export function getReportingClient(): youtubereporting_v1.Youtubereporting {
  const auth = googleAuth.getClient()
  if (!auth) {
    throw new CapabilityError(
      'No Google account connected. Connect one in Settings first.',
      'not_connected'
    )
  }
  if (!googleAuth.hasScopes('youtube')) {
    throw new CapabilityError(
      'Your Google account is connected but has not granted YouTube access. ' +
        'Reconnect in Settings to approve the YouTube scopes.',
      'not_connected'
    )
  }
  return google.youtubereporting({ version: 'v1', auth })
}

/**
 * Reporting API calls, sharing the auth failure handling of the other two.
 *
 * Deliberately not metered: bulk reports draw on a separate quota, and charging
 * them against the 10,000 Data API units would refuse syncs that are affordable.
 * Errors other than a dead grant keep Google's own message — for a disabled API
 * that text carries the enablement link, which is the only useful part.
 */
export async function reportingCall<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isInvalidGrantError(err)) {
      throw new CapabilityError(handleInvalidGrant(`YouTube Reporting ${label}`), 'not_connected')
    }
    throw new CapabilityError(
      `YouTube Reporting ${label} failed: ${(err as Error)?.message ?? String(err)}`,
      'handler_failed'
    )
  }
}

/** ISO 8601 duration ("PT4M13S") → seconds. */
export function parseDuration(iso: string | null | undefined): number {
  if (!iso) return 0
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso)
  if (!m) return 0
  const [, d, h, min, s] = m
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0)
}

/** YYYY-MM-DD in UTC — the format both APIs expect for date ranges. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

import { HttpError, supabaseRpc, type AuthContext } from './http.ts'

export type QuotaBucket = 'chat' | 'artifact' | 'research' | 'discover' | 'speech' | 'import'

export interface QuotaDecision {
  allowed: boolean
  bucket: string
  limit: number
  remaining: number
  retryAfterSeconds: number
}

const BUCKET_LABELS: Record<QuotaBucket, string> = {
  chat: 'chat answer',
  artifact: 'Studio output',
  research: 'Deep Research',
  discover: 'web discovery',
  speech: 'audio narration',
  import: 'source import',
}

/**
 * Reserves one unit of the caller's hourly budget before any paid provider work
 * starts. The account is derived from the JWT inside Postgres, so the bucket is
 * the only thing the request can influence.
 */
export async function consumeQuota(context: AuthContext, bucket: QuotaBucket): Promise<QuotaDecision> {
  const decision = await supabaseRpc<QuotaDecision>(context, 'consume_ai_quota', { requested_bucket: bucket })
  if (!decision.allowed) {
    throw new HttpError(
      `The ${BUCKET_LABELS[bucket]} limit of ${decision.limit} per hour is reached for this account. Please try again later.`,
      'QUOTA_EXCEEDED',
      429,
      String(Math.max(1, decision.retryAfterSeconds)),
    )
  }
  return decision
}

export interface BurstLimiter {
  take(key: string, now?: number): { allowed: boolean; retryAfterSeconds: number }
  size(): number
}

/**
 * Per-instance burst guard. A new anonymous account costs nothing, so the durable
 * per-account quota alone cannot slow down a caller that keeps creating accounts.
 * This adds a cheap network-level ceiling in front of it; it is intentionally
 * best-effort because Edge instances neither share nor survive state.
 */
export function createBurstLimiter(options: { limit: number; windowMs: number; maxKeys?: number }): BurstLimiter {
  const maxKeys = options.maxKeys ?? 5_000
  const windows = new Map<string, { start: number; count: number }>()

  const prune = (now: number) => {
    for (const [key, window] of windows) {
      if (now - window.start >= options.windowMs) windows.delete(key)
    }
  }

  return {
    take(key, now = Date.now()) {
      if (windows.size >= maxKeys) prune(now)
      const window = windows.get(key)
      if (!window || now - window.start >= options.windowMs) {
        windows.set(key, { start: now, count: 1 })
        return { allowed: true, retryAfterSeconds: 0 }
      }
      window.count += 1
      if (window.count > options.limit) {
        window.count -= 1
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((window.start + options.windowMs - now) / 1_000)),
        }
      }
      return { allowed: true, retryAfterSeconds: 0 }
    },
    size() {
      return windows.size
    },
  }
}

export function clientAddress(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
}

const requestBurst = createBurstLimiter({ limit: 40, windowMs: 60_000 })

export function assertWithinBurstLimit(request: Request, limiter: BurstLimiter = requestBurst) {
  const decision = limiter.take(clientAddress(request))
  if (!decision.allowed) {
    throw new HttpError(
      'Too many requests from this network. Please slow down and try again shortly.',
      'BURST_LIMITED',
      429,
      String(decision.retryAfterSeconds),
    )
  }
}

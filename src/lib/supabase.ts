import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
export const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const supabaseConfigurationError =
  !supabaseUrl || !publishableKey
    ? 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.'
    : null

// Null rather than a throw at import time, so a misconfigured deployment can still boot far
// enough to render supabaseConfigurationError.
export const supabase =
  supabaseUrl && publishableKey
    ? createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null

export function requireSupabase() {
  if (!supabase) throw new Error(supabaseConfigurationError || 'Supabase is unavailable.')
  return supabase
}

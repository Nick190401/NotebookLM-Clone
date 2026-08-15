export function createId(prefix: string) {
  // randomUUID needs a secure context; ids are local keys, so the fallback is good enough.
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
  return `${prefix}-${random}`
}

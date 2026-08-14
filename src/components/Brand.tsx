import { Sparkles } from 'lucide-react'

export function NotebookMark({ size = 32 }: { size?: number }) {
  return (
    <span className="notebook-mark" style={{ width: size, height: size }} aria-hidden="true">
      <span className="mark-arc mark-arc-one" />
      <span className="mark-arc mark-arc-two" />
      <span className="mark-arc mark-arc-three" />
      <Sparkles size={Math.max(8, size * 0.28)} strokeWidth={2.6} />
    </span>
  )
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="NotebookLM Clone">
      <NotebookMark size={compact ? 28 : 32} />
      {!compact && <span>NotebookLM</span>}
    </div>
  )
}

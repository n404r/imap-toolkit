import { useState, useEffect } from 'react'

interface Props {
  reconnectAt?: number | null
  statusMsg?: string
  onRetry?: () => void
}

export function ReconnectTimer({ reconnectAt, statusMsg, onRetry }: Props) {
  const [remaining, setRemaining] = useState<number | null>(null)
  const [retrying, setRetrying] = useState(false)

  // Strip any old static "(reconnecting in 60s…)" text from statusMsg
  const cleanMsg = (statusMsg ?? 'IMAP error')
    .replace(/\s*\(reconnecting in \d+s…?\)/gi, '')
    .trim()

  // Extract fallback seconds if reconnectAt is not provided
  const parsedSecs = (() => {
    const match = (statusMsg ?? '').match(/\(reconnecting in (\d+)s…?\)/i)
    return match ? parseInt(match[1], 10) : null
  })()

  useEffect(() => {
    let target = reconnectAt
    if (!target && parsedSecs) {
      target = Date.now() + parsedSecs * 1000
    }

    if (!target) {
      setRemaining(null)
      return
    }

    const update = () => {
      const diffMs = target! - Date.now()
      const secs = Math.ceil(diffMs / 1000)
      if (secs <= 0) {
        setRemaining(0)
      } else {
        setRemaining(secs)
      }
    }

    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [reconnectAt, statusMsg])

  const handleRetry = async () => {
    if (!onRetry || retrying) return
    setRetrying(true)
    try {
      await onRetry()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="flex-shrink-0 text-red-400">⚠</span>
        <span className="truncate">{cleanMsg || 'IMAP connection error'}</span>
        {remaining !== null && (
          <span className="font-mono text-amber-300 font-semibold ml-1">
            {remaining > 0 ? `(reconnecting in ${remaining}s…)` : '(connecting now…)'}
          </span>
        )}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="text-[11px] underline text-accent hover:text-accent-hover font-medium flex-shrink-0 ml-auto"
        >
          {retrying ? 'Connecting…' : 'Retry now'}
        </button>
      )}
    </div>
  )
}

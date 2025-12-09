import { Activity, ChevronDown, ChevronUp, History } from 'lucide-react'
import type { ChatTurn, LatencyMap } from '../../types/app'

type StreamPanelProps = {
  isMobile: boolean
  streamCollapsed: boolean
  historyOpen: boolean
  showLatencyPanel: boolean
  partial: string
  chatTurns: ChatTurn[]
  latency: LatencyMap
  onToggleHistory: () => void
  onToggleLatency: () => void
  onToggleStream: () => void
}

export function StreamPanel({
  isMobile,
  streamCollapsed,
  historyOpen,
  showLatencyPanel,
  partial,
  chatTurns,
  latency,
  onToggleHistory,
  onToggleLatency,
  onToggleStream,
}: StreamPanelProps) {
  const latestTurn = chatTurns.at(-1)

  return (
    <div className={`stream-fab glass-panel ${streamCollapsed ? 'collapsed' : ''}`}>
      <div className="stream-head">
        {!isMobile ? (
          <div>
            <div className="eyebrow">STT / LLM</div>
          </div>
        ) : null}
        <div className="stream-actions">
          <button className="ghost compact" onClick={onToggleHistory} disabled={streamCollapsed}>
            {isMobile ? <History size={18} /> : historyOpen ? 'history ▲' : 'history ▼'}
          </button>
          <button className="ghost compact" onClick={onToggleLatency} disabled={streamCollapsed}>
            {isMobile ? <Activity size={18} /> : showLatencyPanel ? 'latency ▲' : 'latency ▼'}
          </button>
          <button className="ghost compact collapse-action" onClick={onToggleStream}>
            {isMobile ? (streamCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />) : streamCollapsed ? '展開' : '収納'}
          </button>
        </div>
      </div>
      {!streamCollapsed ? (
        <>
          <div className="stream-mini">
            <div className="stream-row">
              <span className="label">partial</span>
              <p className="mono tiny text-ellipsis">{partial || '—'}</p>
            </div>
            <div className="stream-row">
              <span className="label">user</span>
              <p className="mono tiny text-ellipsis">{latestTurn?.userText || '—'}</p>
            </div>
            <div className="stream-row">
              <span className="label">assistant</span>
              <p className="mono tiny text-ellipsis assistant">{latestTurn?.assistantText || '—'}</p>
            </div>
          </div>
          {showLatencyPanel ? (
            <div className="latency-card mini">
              <div className="latency-grid">
                <div>
                  <span>STT</span>
                  <strong>{latency.stt ?? '—'}</strong>
                </div>
                <div>
                  <span>LLM</span>
                  <strong>{latency.llm ?? '—'}</strong>
                </div>
                <div>
                  <span>TTS</span>
                  <strong>{latency.tts ?? '—'}</strong>
                </div>
              </div>
            </div>
          ) : null}
          {historyOpen ? (
            <div className="history-list mini">
              {chatTurns
                .slice()
                .reverse()
                .map((turn) => (
                  <div key={turn.id} className="history-card">
                    <p className="mono tiny text-ellipsis">{turn.userText || '（user textなし）'}</p>
                    <p className="mono tiny text-ellipsis assistant">{turn.assistantText || '応答なし'}</p>
                  </div>
                ))}
              {!chatTurns.length ? <p className="hint tiny">履歴なし</p> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

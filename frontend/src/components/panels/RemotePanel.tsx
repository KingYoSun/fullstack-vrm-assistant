import { type ChangeEvent, type MutableRefObject } from 'react'
import { ChevronDown, ChevronUp, FlaskConical, ScrollText, Settings2, Upload, UserRound } from 'lucide-react'

type RemotePanelProps = {
  isMobile: boolean
  remoteCollapsed: boolean
  connectionDrawerOpen: boolean
  personaDrawerOpen: boolean
  diagnosticsDrawerOpen: boolean
  logsDrawerOpen: boolean
  mouthOpen: number
  avatarName: string | null
  vrmFileInputRef: MutableRefObject<HTMLInputElement | null>
  onToggleRemote: () => void
  onToggleConnection: () => void
  onTogglePersona: () => void
  onToggleDiagnostics: () => void
  onToggleLogs: () => void
  onOpenVrmFilePicker: () => void
  onVrmFileChange: (event: ChangeEvent<HTMLInputElement>) => void
}

export function RemotePanel({
  isMobile,
  remoteCollapsed,
  connectionDrawerOpen,
  personaDrawerOpen,
  diagnosticsDrawerOpen,
  logsDrawerOpen,
  mouthOpen,
  avatarName,
  vrmFileInputRef,
  onToggleRemote,
  onToggleConnection,
  onTogglePersona,
  onToggleDiagnostics,
  onToggleLogs,
  onOpenVrmFilePicker,
  onVrmFileChange,
}: RemotePanelProps) {
  return (
    <div className={`remote-fab glass-panel ${remoteCollapsed ? 'collapsed' : ''}`}>
      {!isMobile ? (
        <div className="fab-head">
          <div>
            <div className="eyebrow">設定 / ログ</div>
          </div>
        </div>
      ) : null}
      <div className="remote-chips compact">
        <button className="remote-chip" onClick={onOpenVrmFilePicker} aria-label="VRM を読み込む">
          <Upload size={18} />
        </button>
        <input
          ref={vrmFileInputRef}
          type="file"
          accept=".vrm,.glb,.gltf,model/gltf-binary,model/gltf+json"
          onChange={onVrmFileChange}
          style={{ display: 'none' }}
        />
        <button
          className={`remote-chip ${connectionDrawerOpen ? 'active' : ''}`}
          onClick={onToggleConnection}
          aria-label="接続 / ソース"
        >
          <Settings2 size={18} />
        </button>
        <button
          className={`remote-chip ${personaDrawerOpen ? 'active' : ''}`}
          onClick={onTogglePersona}
          aria-label="キャラクター"
        >
          <UserRound size={18} />
        </button>
        <button
          className={`remote-chip ${diagnosticsDrawerOpen ? 'active' : ''}`}
          onClick={onToggleDiagnostics}
          aria-label="Diagnostics"
        >
          <FlaskConical size={18} />
        </button>
        <button className={`remote-chip ${logsDrawerOpen ? 'active' : ''}`} onClick={onToggleLogs} aria-label="WS / オーディオ">
          <ScrollText size={18} />
        </button>
        <button className="remote-chip collapse-toggle" onClick={onToggleRemote}>
          {isMobile ? (remoteCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />) : remoteCollapsed ? '収納' : '展開'}
        </button>
      </div>
      {!remoteCollapsed ? (
        <div className="remote-meta compact">
          <p className="mono tiny">{avatarName ?? 'VRM'}</p>
          <div className="meter mini">
            <div className="bar" style={{ width: `${mouthOpen * 100}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

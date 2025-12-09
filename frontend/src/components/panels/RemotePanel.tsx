import { type ChangeEvent, type MutableRefObject } from 'react'
import { ChevronDown, ChevronUp, FlaskConical, ScrollText, Settings2, Upload, UserRound } from 'lucide-react'
import { useAppStore } from '../../store/appStore'

type RemotePanelProps = {
  vrmFileInputRef: MutableRefObject<HTMLInputElement | null>
  onOpenVrmFilePicker: () => void
  onVrmFileChange: (event: ChangeEvent<HTMLInputElement>) => void
}

export function RemotePanel({
  vrmFileInputRef,
  onOpenVrmFilePicker,
  onVrmFileChange,
}: RemotePanelProps) {
  const isMobile = useAppStore((s) => s.isMobile)
  const remoteCollapsed = useAppStore((s) => s.remoteCollapsed)
  const connectionDrawerOpen = useAppStore((s) => s.connectionDrawerOpen)
  const personaDrawerOpen = useAppStore((s) => s.personaDrawerOpen)
  const diagnosticsDrawerOpen = useAppStore((s) => s.diagnosticsDrawerOpen)
  const logsDrawerOpen = useAppStore((s) => s.logsDrawerOpen)
  const mouthOpen = useAppStore((s) => Math.min(1, Math.max(s.audioMouth, s.avatarMouth)))
  const avatarName = useAppStore((s) => s.avatarName)
  const toggleRemoteCollapsed = useAppStore((s) => s.toggleRemoteCollapsed)
  const toggleDrawer = useAppStore((s) => s.toggleDrawer)

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
          onClick={() => toggleDrawer('connectionDrawerOpen')}
          aria-label="接続 / ソース"
        >
          <Settings2 size={18} />
        </button>
        <button
          className={`remote-chip ${personaDrawerOpen ? 'active' : ''}`}
          onClick={() => toggleDrawer('personaDrawerOpen')}
          aria-label="キャラクター"
        >
          <UserRound size={18} />
        </button>
        <button
          className={`remote-chip ${diagnosticsDrawerOpen ? 'active' : ''}`}
          onClick={() => toggleDrawer('diagnosticsDrawerOpen')}
          aria-label="Diagnostics"
        >
          <FlaskConical size={18} />
        </button>
        <button
          className={`remote-chip ${logsDrawerOpen ? 'active' : ''}`}
          onClick={() => toggleDrawer('logsDrawerOpen')}
          aria-label="WS / オーディオ"
        >
          <ScrollText size={18} />
        </button>
        <button className="remote-chip collapse-toggle" onClick={toggleRemoteCollapsed}>
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

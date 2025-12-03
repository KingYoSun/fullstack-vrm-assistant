import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { GLTFLoader, type GLTF, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import './App.css'

type WsState = 'disconnected' | 'connecting' | 'connected'

type LogEntry = { time: string; text: string }

type ChatTurn = {
  id: string
  userText: string
  assistantText: string
  status: 'listening' | 'responding' | 'done'
  startedAt: number
}

type LatencyMap = { stt?: number; llm?: number; tts?: number }

type SttDiagResult = {
  text: string
  byteLength: number
  provider: string
  endpoint: string
  fallbackUsed: boolean
}

type LlmDiagResult = {
  assistantText: string
  tokens: string[]
  latencyMs: number
  provider: string
  endpoint: string
  fallbackUsed: boolean
}

type TtsDiagMeta = {
  mimeType: string
  byteLength: number
  chunkCount: number
  latencyMs: number
  provider: string
  endpoint: string
  sampleRate: number
  fallbackUsed: boolean
}

type EmbeddingDiagResult = {
  vector: number[]
  dimensions: number
  provider: string
  endpoint: string
  fallbackUsed: boolean
}

type RagDiagResult = {
  query: string
  documents: { source: string; content: string }[]
  contextText: string
  ragIndexLoaded: boolean
  topK: number
}

type DbDiagResult = { status: string; detail?: string | null; conversationLogCount?: number | null }

type LegacyGetUserMedia = (
  constraints: MediaStreamConstraints,
  successCallback: (stream: MediaStream) => void,
  errorCallback?: (error: unknown) => void
) => void

type NavigatorWithLegacyGetUserMedia = Navigator & {
  getUserMedia?: LegacyGetUserMedia
  webkitGetUserMedia?: LegacyGetUserMedia
  mozGetUserMedia?: LegacyGetUserMedia
}

const DEFAULT_VRM = '/AliciaSolid.vrm'
const DEFAULT_WS_PATH = '/ws/session'
const DEFAULT_API_BASE_PATH = '/api/v1'

const normalizePath = (path: string, fallback = DEFAULT_WS_PATH) => {
  const base = path || fallback
  const withLeadingSlash = base.startsWith('/') ? base : `/${base}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash.slice(0, -1) : withLeadingSlash
}

const resolveDefaultWsBaseUrl = () => {
  const explicitBase = import.meta.env.VITE_WS_BASE_URL
  if (explicitBase) return explicitBase

  const wsPath = normalizePath(import.meta.env.VITE_WS_PATH ?? DEFAULT_WS_PATH)
  const host =
    import.meta.env.VITE_BACKEND_HOST ||
    (typeof window !== 'undefined' && window.location.hostname) ||
    'localhost'
  const envPort = import.meta.env.VITE_BACKEND_PORT
  const port = envPort === '' ? '' : envPort ?? '8000'
  const protocol =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const portPart = port ? `:${port}` : ''

  return `${protocol}//${host}${portPart}${wsPath}`
}

const DEFAULT_WS_BASE_URL = resolveDefaultWsBaseUrl()
const resolveDefaultApiBaseUrl = () => {
  const explicitBase = import.meta.env.VITE_API_BASE_URL
  if (explicitBase) return explicitBase.endsWith('/') ? explicitBase.slice(0, -1) : explicitBase

  const host =
    import.meta.env.VITE_BACKEND_HOST ||
    (typeof window !== 'undefined' && window.location.hostname) ||
    'localhost'
  const envPort = import.meta.env.VITE_BACKEND_PORT
  const port = envPort === '' ? '' : envPort ?? '8000'
  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https:' : 'http:'
  const apiPath = normalizePath(import.meta.env.VITE_API_BASE_PATH ?? DEFAULT_API_BASE_PATH, DEFAULT_API_BASE_PATH)
  const portPart = port ? `:${port}` : ''

  return `${protocol}//${host}${portPart}${apiPath}`
}

const DEFAULT_API_BASE_URL = resolveDefaultApiBaseUrl()

type CanvasErrorBoundaryProps = { resetKey?: string; onError?: (error: Error) => void; children: ReactNode }
type CanvasErrorBoundaryState = { error: Error | null }

class CanvasErrorBoundary extends Component<CanvasErrorBoundaryProps, CanvasErrorBoundaryState> {
  state: CanvasErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): CanvasErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error)
  }

  componentDidUpdate(prevProps: CanvasErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      return (
        <div className="canvas-error">
          <div className="eyebrow">VRM 読み込みエラー</div>
          <p className="mono small">{this.state.error.message}</p>
          <button onClick={this.handleReset}>再試行</button>
        </div>
      )
    }
    return this.props.children
  }
}

type VrmModelProps = { url: string; mouthOpen: number; onLoaded?: (name: string) => void }

function VrmModel({ url, mouthOpen, onLoaded }: VrmModelProps) {
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.register((parser: GLTFParser) => new VRMLoaderPlugin(parser))
  }) as GLTF

  const vrm = useMemo(() => {
    const loaded = gltf.userData.vrm as VRM | undefined
    if (!loaded) return null
    VRMUtils.removeUnnecessaryJoints(loaded.scene)
    VRMUtils.removeUnnecessaryVertices(loaded.scene)
    loaded.scene.traverse((obj) => {
      obj.frustumCulled = false
    })
    return loaded
  }, [gltf])

  useEffect(() => {
    if (vrm && onLoaded) {
      const meta = vrm.meta
      const name = meta.metaVersion === '0' ? meta.title ?? 'VRM avatar' : meta.name ?? 'VRM avatar'
      onLoaded(name)
    }
  }, [onLoaded, vrm])

  useFrame((_, delta) => {
    if (!vrm) return
    const intensity = Math.min(1, Math.max(0, mouthOpen))
    vrm.expressionManager?.setValue('aa', intensity)
    vrm.expressionManager?.setValue('ih', intensity * 0.25)
    vrm.expressionManager?.update()
    vrm.update(delta)
  })

  return vrm ? <primitive object={vrm.scene} /> : null
}

type AvatarCanvasProps = { url: string; mouthOpen: number; onLoaded?: (name: string) => void }

function AvatarCanvas({ url, mouthOpen, onLoaded }: AvatarCanvasProps) {
  return (
    <Canvas camera={{ position: [0, 1.4, 2.4], fov: 28 }} shadows style={{ height: '100%', width: '100%' }}>
      <color attach="background" args={['#0b1021']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[2, 3, 2]} intensity={1.1} castShadow />
      <Suspense
        fallback={
          <Html center>
            <span className="loading">Loading VRM...</span>
          </Html>
        }
      >
        <VrmModel url={url} mouthOpen={mouthOpen} onLoaded={onLoaded} />
        <OrbitControls minDistance={1.5} maxDistance={3} />
      </Suspense>
    </Canvas>
  )
}

type ChatLogProps = { turns: ChatTurn[]; partial: string }

function ChatLog({ turns, partial }: ChatLogProps) {
  if (!turns.length && !partial) {
    return <div className="empty">まだメッセージがありません。マイクを開始してみてください。</div>
  }

  return (
    <div className="chat-log">
      {partial ? (
        <div className="chat-card live">
          <div className="chat-meta">
            <span className="pill pill-user">User</span>
            <span className="pill pill-live">listening</span>
          </div>
          <p className="chat-text mono">{partial}</p>
        </div>
      ) : null}
      {turns
        .slice()
        .reverse()
        .map((turn) => (
          <div key={turn.id} className="chat-card">
            <div className="chat-meta">
              <span className="pill pill-user">User</span>
              <span className={`pill status-${turn.status}`}>{turn.status}</span>
            </div>
            <p className="chat-text">{turn.userText || '（user textなし）'}</p>
            <div className="divider" />
            <div className="chat-meta">
              <span className="pill pill-assistant">Assistant</span>
              <span className="pill pill-soft">stream</span>
            </div>
            <p className="chat-text assistant">{turn.assistantText || '応答待ち...'}</p>
          </div>
        ))}
    </div>
  )
}

function App() {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_WS_BASE_URL)
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL)
  const [sessionId, setSessionId] = useState('demo-session')
  const [vrmUrl, setVrmUrl] = useState(DEFAULT_VRM)
  const [state, setState] = useState<WsState>('disconnected')
  const [partial, setPartial] = useState('')
  const [latency, setLatency] = useState<LatencyMap>({})
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [micActive, setMicActive] = useState(false)
  const [ttsBytes, setTtsBytes] = useState(0)
  const [audioMouth, setAudioMouth] = useState(0)
  const [avatarMouth, setAvatarMouth] = useState(0)
  const [avatarName, setAvatarName] = useState<string | null>(null)
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([])
  const [sttFile, setSttFile] = useState<File | null>(null)
  const [sttResult, setSttResult] = useState<SttDiagResult | null>(null)
  const [sttError, setSttError] = useState<string | null>(null)
  const [sttLoading, setSttLoading] = useState(false)
  const [llmPrompt, setLlmPrompt] = useState('システムの状態を簡潔に教えて。')
  const [llmContext, setLlmContext] = useState('')
  const [llmResult, setLlmResult] = useState<LlmDiagResult | null>(null)
  const [llmError, setLlmError] = useState<string | null>(null)
  const [llmLoading, setLlmLoading] = useState(false)
  const [ttsText, setTtsText] = useState('これは音声合成のテストです。音質とレスポンスを確認します。')
  const [ttsVoice, setTtsVoice] = useState('')
  const [ttsMeta, setTtsMeta] = useState<TtsDiagMeta | null>(null)
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null)
  const [ttsError, setTtsError] = useState<string | null>(null)
  const [ttsLoading, setTtsLoading] = useState(false)
  const [embeddingText, setEmbeddingText] = useState('3D アバターの対話体験を向上させるためのヒントを教えて')
  const [embeddingResult, setEmbeddingResult] = useState<EmbeddingDiagResult | null>(null)
  const [embeddingError, setEmbeddingError] = useState<string | null>(null)
  const [embeddingLoading, setEmbeddingLoading] = useState(false)
  const [ragQuery, setRagQuery] = useState('このプロジェクトの目的は？')
  const [ragTopK, setRagTopK] = useState('4')
  const [ragResult, setRagResult] = useState<RagDiagResult | null>(null)
  const [ragError, setRagError] = useState<string | null>(null)
  const [ragLoading, setRagLoading] = useState(false)
  const [dbStatus, setDbStatus] = useState<DbDiagResult | null>(null)
  const [dbError, setDbError] = useState<string | null>(null)
  const [dbLoading, setDbLoading] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const ttsBuffersRef = useRef<Uint8Array[]>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const mouthRafRef = useRef<number | null>(null)
  const currentTurnIdRef = useRef<string | null>(null)

  const micSupported = useMemo(() => {
    if (typeof navigator === 'undefined') return false
    const nav = navigator as NavigatorWithLegacyGetUserMedia
    return Boolean(
      nav.mediaDevices?.getUserMedia ??
        nav.getUserMedia ??
        nav.webkitGetUserMedia ??
        nav.mozGetUserMedia
    )
  }, [])

  const apiBase = useMemo(() => {
    const base = (apiBaseUrl || DEFAULT_API_BASE_URL).trim()
    const trimmed = base.endsWith('/') ? base.slice(0, -1) : base
    return trimmed || DEFAULT_API_BASE_URL
  }, [apiBaseUrl])

  const wsUrl = useMemo(() => {
    const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
    return `${normalized}/${sessionId}`
  }, [baseUrl, sessionId])

  const buildApiUrl = (path: string) => {
    const normalized = path.startsWith('/') ? path : `/${path}`
    return `${apiBase}${normalized}`
  }

  const parseError = (err: unknown) => (err instanceof Error ? err.message : String(err))

  const requestJson = async <T,>(path: string, init: RequestInit) => {
    const response = await fetch(buildApiUrl(path), init)
    const text = await response.text()
    if (!response.ok) {
      const message = text || `${response.status} ${response.statusText}`
      throw new Error(message)
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new Error('invalid JSON response from backend')
    }
  }

  useEffect(() => {
    return () => {
      wsRef.current?.close()
      stopMic()
      stopAudioMeter()
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      setAvatarMouth((prev) => (prev > 0.01 ? prev * 0.9 : 0))
    }, 90)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    setAvatarName(null)
  }, [vrmUrl])

  useEffect(() => {
    return () => {
      if (ttsAudioUrl) {
        URL.revokeObjectURL(ttsAudioUrl)
      }
    }
  }, [ttsAudioUrl])

  const mouthOpen = useMemo(() => Math.min(1, Math.max(audioMouth, avatarMouth)), [audioMouth, avatarMouth])
  const latestTurn = chatTurns.at(-1)
  const lastUserText = latestTurn?.userText ?? '—'
  const lastAssistantText = latestTurn?.assistantText ?? '—'

  const appendLog = (text: string) => {
    setLogs((prev) => {
      const next = [...prev, { time: new Date().toLocaleTimeString(), text }]
      return next.slice(-80)
    })
  }

  useEffect(() => {
    if (!micSupported) {
      const hint =
        typeof window !== 'undefined' && !window.isSecureContext
          ? 'secure context ではないためマイク API が無効です（HTTPS または localhost で開いてください）'
          : 'ブラウザがマイク API をサポートしていません'
      appendLog(`mic unsupported: ${hint}`)
    }
  }, [micSupported])

  const ensureTurnId = (turnId?: string) => {
    if (turnId) {
      currentTurnIdRef.current = turnId
      return turnId
    }
    if (!currentTurnIdRef.current) {
      currentTurnIdRef.current = crypto.randomUUID?.() ?? `turn-${Date.now()}`
    }
    return currentTurnIdRef.current
  }

  const upsertTurn = (turnId: string, build: (prev: ChatTurn | null) => ChatTurn) => {
    setChatTurns((prev) => {
      const idx = prev.findIndex((t) => t.id === turnId)
      const base = idx >= 0 ? prev[idx] : null
      const updated = build(base)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = updated
        return next
      }
      return [...prev, updated]
    })
  }

  const connect = () => {
    if (state !== 'disconnected') return
    setState('connecting')
    setPartial('')
    setChatTurns([])
    setAvatarMouth(0)
    setAudioMouth(0)
    setTtsBytes(0)
    ttsBuffersRef.current = []
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setState('connected')
      appendLog(`connected: ${wsUrl}`)
    }
    ws.onclose = (event) => {
      setState('disconnected')
      currentTurnIdRef.current = null
      appendLog(`closed (${event.code}): ${event.reason || 'no reason'}`)
      stopMic()
      stopAudioMeter()
    }
    ws.onerror = () => {
      appendLog('websocket error')
    }
    ws.onmessage = (event) => {
      void handleMessage(event.data)
    }
  }

  const disconnect = () => {
    wsRef.current?.close()
    wsRef.current = null
    setState('disconnected')
    stopMic()
    stopAudioMeter()
  }

  const sendControl = (type: 'ping' | 'flush' | 'resume') => {
    if (!wsRef.current || state !== 'connected') return
    wsRef.current.send(JSON.stringify({ type }))
  }

  const requestMicStream = async () => {
    if (typeof navigator === 'undefined') {
      throw new Error('navigator is not available（非ブラウザ環境）')
    }
    const nav = navigator as NavigatorWithLegacyGetUserMedia
    const mediaDevicesGetUserMedia = nav.mediaDevices?.getUserMedia
    if (mediaDevicesGetUserMedia) {
      return mediaDevicesGetUserMedia.call(nav.mediaDevices, { audio: true })
    }
    const legacy = nav.getUserMedia ?? nav.webkitGetUserMedia ?? nav.mozGetUserMedia
    if (legacy) {
      return new Promise<MediaStream>((resolve, reject) => {
        legacy.call(nav, { audio: true }, resolve, reject)
      })
    }
    const secureContext = typeof window !== 'undefined' ? window.isSecureContext : true
    const hint = secureContext
      ? 'ブラウザがマイク API をサポートしていません'
      : 'HTTPS または localhost でアクセスしてください（secure context でないためマイク API が無効）'
    throw new Error(hint)
  }

  const startMic = async () => {
    if (micActive || state !== 'connected') return
    try {
      const stream = await requestMicStream()
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 })
      recorder.ondataavailable = async (event) => {
        if (!wsRef.current || state !== 'connected') return
        if (event.data && event.data.size > 0) {
          const buffer = await event.data.arrayBuffer()
          wsRef.current.send(buffer)
        }
      }
      recorder.start(100)
      mediaRecorderRef.current = recorder
      setMicActive(true)
      appendLog('mic started')
    } catch (err) {
      appendLog(`mic error: ${(err as Error).message}`)
    }
  }

  const stopMic = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop())
      mediaRecorderRef.current = null
      setMicActive(false)
      appendLog('mic stopped')
    }
  }

  const ensureAudioContext = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }
    await audioContextRef.current.resume()
    return audioContextRef.current
  }

  const stopAudioMeter = (haltSource = true) => {
    if (mouthRafRef.current !== null) {
      cancelAnimationFrame(mouthRafRef.current)
      mouthRafRef.current = null
    }
    if (haltSource && audioSourceRef.current) {
      try {
        audioSourceRef.current.stop()
      } catch {
        // noop
      }
      audioSourceRef.current.disconnect()
      audioSourceRef.current = null
    }
    setAudioMouth(0)
  }

  const playTtsBuffer = async () => {
    const buffers = ttsBuffersRef.current
    if (!buffers.length) return
    const blob = new Blob(buffers.map((b) => new Uint8Array(b)), { type: 'audio/ogg; codecs=opus' })
    ttsBuffersRef.current = []
    try {
      const ctx = await ensureAudioContext()
      const arrayBuffer = await blob.arrayBuffer()
      const decoded = await ctx.decodeAudioData(arrayBuffer)
      const source = ctx.createBufferSource()
      const analyser = analyserRef.current ?? ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.88
      analyserRef.current = analyser

      source.buffer = decoded
      source.connect(analyser)
      analyser.connect(ctx.destination)

      stopAudioMeter()
      audioSourceRef.current = source
      const dataArray = new Uint8Array(analyser.fftSize)

      const tick = () => {
        analyser.getByteTimeDomainData(dataArray)
        const rms =
          Math.sqrt(dataArray.reduce((sum, v) => sum + (v - 128) * (v - 128), 0) / dataArray.length) / 128
        const openness = Math.min(1, Math.max(0, (rms - 0.02) * 6))
        setAudioMouth((prev) => prev * 0.4 + openness * 0.6)
        mouthRafRef.current = requestAnimationFrame(tick)
      }

      tick()
      source.start()
      source.onended = () => {
        stopAudioMeter(false)
      }
    } catch (err) {
      appendLog(`audio decode error: ${(err as Error).message}`)
    }
  }

  const handleJson = (payload: any) => {
    const type = payload?.type
    switch (type) {
      case 'partial_transcript':
        setPartial(payload.text ?? '')
        break
      case 'final_transcript': {
        const turnId = ensureTurnId(payload.turn_id)
        setPartial('')
        upsertTurn(turnId, (prev) => ({
          id: turnId,
          userText: payload.text ?? prev?.userText ?? '',
          assistantText: prev?.assistantText ?? '',
          status: 'responding',
          startedAt: prev?.startedAt ?? Date.now(),
        }))
        if (payload.latency_ms?.stt) {
          setLatency((prev) => ({ ...prev, stt: payload.latency_ms.stt }))
        }
        break
      }
      case 'llm_token': {
        const turnId = ensureTurnId(payload.turn_id)
        const token = payload.token ?? ''
        upsertTurn(turnId, (prev) => ({
          id: turnId,
          userText: prev?.userText ?? '',
          assistantText: `${prev?.assistantText ?? ''}${token}`,
          status: 'responding',
          startedAt: prev?.startedAt ?? Date.now(),
        }))
        break
      }
      case 'llm_done': {
        const turnId = ensureTurnId(payload.turn_id)
        appendLog(`llm_done turn=${turnId} text=${(payload.assistant_text ?? '').slice(0, 120)}`)
        upsertTurn(turnId, (prev) => ({
          id: turnId,
          userText: prev?.userText ?? '',
          assistantText: payload.assistant_text ?? prev?.assistantText ?? '',
          status: 'done',
          startedAt: prev?.startedAt ?? Date.now(),
        }))
        if (payload.latency_ms) {
          setLatency((prev) => ({
            ...prev,
            stt: payload.latency_ms.stt ?? prev.stt,
            llm: payload.latency_ms.llm ?? prev.llm,
          }))
        }
        break
      }
      case 'tts_start':
        setTtsBytes(0)
        ttsBuffersRef.current = []
        appendLog(`tts_start turn=${payload.turn_id}`)
        break
      case 'tts_end':
        appendLog(`tts_end turn=${payload.turn_id}`)
        void playTtsBuffer()
        if (payload.latency_ms) {
          setLatency((prev) => ({
            ...prev,
            llm: payload.latency_ms.llm ?? prev.llm,
            tts: payload.latency_ms.tts ?? prev.tts,
          }))
        }
        break
      case 'avatar_event':
        if (typeof payload.mouth_open === 'number') {
          const openness = Math.min(1, Math.max(0, payload.mouth_open))
          setAvatarMouth((prev) => prev * 0.5 + openness * 0.5)
        }
        break
      case 'error':
        appendLog(`error: ${payload.message} (recoverable=${payload.recoverable})`)
        break
      case 'pong':
        appendLog('pong')
        break
      default:
        appendLog(`message: ${JSON.stringify(payload)}`)
        break
    }
  }

  const handleMessage = async (data: unknown) => {
    if (typeof data === 'string') {
      try {
        const payload = JSON.parse(data)
        handleJson(payload)
      } catch {
        appendLog(`text: ${data}`)
      }
      return
    }
    if (data instanceof Blob) {
      setTtsBytes((prev) => prev + data.size)
      ttsBuffersRef.current.push(new Uint8Array(await data.arrayBuffer()))
      return
    }
    if (data instanceof ArrayBuffer) {
      setTtsBytes((prev) => prev + data.byteLength)
      ttsBuffersRef.current.push(new Uint8Array(data))
      return
    }
    appendLog('unknown message type')
  }

  const audioFromBase64 = (base64: string, mimeType: string) => {
    const binary = atob(base64)
    const buffer = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      buffer[i] = binary.charCodeAt(i)
    }
    return new Blob([buffer], { type: mimeType })
  }

  const runSttCheck = async () => {
    setSttError(null)
    if (!sttFile) {
      setSttError('音声ファイルを選択してください')
      return
    }
    setSttLoading(true)
    try {
      const form = new FormData()
      form.append('audio', sttFile)
      const data = await requestJson<{
        text: string
        byte_length: number
        provider: string
        endpoint: string
        fallback_used: boolean
      }>('/diagnostics/stt', { method: 'POST', body: form })
      setSttResult({
        text: data.text,
        byteLength: data.byte_length,
        provider: data.provider,
        endpoint: data.endpoint,
        fallbackUsed: data.fallback_used,
      })
      appendLog(`diagnostics: stt ok (${data.byte_length} bytes)`)
    } catch (err) {
      const message = parseError(err)
      setSttError(message)
      appendLog(`diagnostics: stt failed (${message})`)
    } finally {
      setSttLoading(false)
    }
  }

  const runLlmCheck = async () => {
    setLlmError(null)
    const prompt = llmPrompt.trim()
    const context = llmContext.trim()
    if (!prompt) {
      setLlmError('プロンプトを入力してください')
      return
    }
    setLlmLoading(true)
    try {
      const data = await requestJson<{
        assistant_text: string
        tokens: string[]
        latency_ms: number
        provider: string
        endpoint: string
        fallback_used: boolean
      }>('/diagnostics/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, context: context || undefined }),
      })
      setLlmResult({
        assistantText: data.assistant_text,
        tokens: data.tokens,
        latencyMs: data.latency_ms,
        provider: data.provider,
        endpoint: data.endpoint,
        fallbackUsed: data.fallback_used,
      })
      appendLog(`diagnostics: llm ok (${data.tokens.length} tokens)`)
    } catch (err) {
      const message = parseError(err)
      setLlmError(message)
      appendLog(`diagnostics: llm failed (${message})`)
    } finally {
      setLlmLoading(false)
    }
  }

  const runTtsCheck = async () => {
    setTtsError(null)
    const text = ttsText.trim()
    const voice = ttsVoice.trim()
    if (!text) {
      setTtsError('TTS テキストを入力してください')
      return
    }
    setTtsLoading(true)
    try {
      const data = await requestJson<{
        audio_base64: string
        mime_type: string
        byte_length: number
        chunk_count: number
        latency_ms: number
        provider: string
        endpoint: string
        sample_rate: number
        fallback_used: boolean
      }>('/diagnostics/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: voice || undefined }),
      })
      const blob = audioFromBase64(data.audio_base64, data.mime_type)
      const nextUrl = URL.createObjectURL(blob)
      setTtsAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return nextUrl
      })
      setTtsMeta({
        mimeType: data.mime_type,
        byteLength: data.byte_length,
        chunkCount: data.chunk_count,
        latencyMs: data.latency_ms,
        provider: data.provider,
        endpoint: data.endpoint,
        sampleRate: data.sample_rate,
        fallbackUsed: data.fallback_used,
      })
      appendLog(`diagnostics: tts ok (${data.byte_length} bytes)`)
    } catch (err) {
      const message = parseError(err)
      setTtsError(message)
      setTtsMeta(null)
      setTtsAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      appendLog(`diagnostics: tts failed (${message})`)
    } finally {
      setTtsLoading(false)
    }
  }

  const runEmbeddingCheck = async () => {
    setEmbeddingError(null)
    const text = embeddingText.trim()
    if (!text) {
      setEmbeddingError('テキストを入力してください')
      return
    }
    setEmbeddingLoading(true)
    try {
      const data = await requestJson<{
        vector: number[]
        dimensions: number
        provider: string
        endpoint: string
        fallback_used: boolean
      }>('/diagnostics/embedding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      setEmbeddingResult({
        vector: data.vector,
        dimensions: data.dimensions,
        provider: data.provider,
        endpoint: data.endpoint,
        fallbackUsed: data.fallback_used,
      })
      appendLog(`diagnostics: embedding ok (dim=${data.dimensions})`)
    } catch (err) {
      const message = parseError(err)
      setEmbeddingError(message)
      appendLog(`diagnostics: embedding failed (${message})`)
    } finally {
      setEmbeddingLoading(false)
    }
  }

  const runRagCheck = async () => {
    setRagError(null)
    const query = ragQuery.trim()
    const trimmedTopK = ragTopK.trim()
    const topKNumber = trimmedTopK ? Number(trimmedTopK) : undefined
    if (!query) {
      setRagError('クエリを入力してください')
      return
    }
    if (topKNumber !== undefined && (!Number.isFinite(topKNumber) || topKNumber <= 0)) {
      setRagError('top_k は 1 以上の数値で入力してください')
      return
    }
    setRagLoading(true)
    try {
      const payload: Record<string, string | number> = { query }
      if (topKNumber !== undefined) {
        payload.top_k = topKNumber
      }
      const data = await requestJson<{
        query: string
        documents: { source: string; content: string }[]
        context_text: string
        rag_index_loaded: boolean
        top_k: number
      }>('/diagnostics/rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setRagResult({
        query: data.query,
        documents: data.documents,
        contextText: data.context_text,
        ragIndexLoaded: data.rag_index_loaded,
        topK: data.top_k,
      })
      appendLog(`diagnostics: rag ok (docs=${data.documents.length})`)
    } catch (err) {
      const message = parseError(err)
      setRagError(message)
      appendLog(`diagnostics: rag failed (${message})`)
    } finally {
      setRagLoading(false)
    }
  }

  const pingDatabase = async () => {
    setDbError(null)
    setDbLoading(true)
    try {
      const data = await requestJson<{
        status: string
        detail?: string | null
        conversation_log_count?: number | null
      }>('/diagnostics/db', { method: 'GET' })
      setDbStatus({
        status: data.status,
        detail: data.detail,
        conversationLogCount: data.conversation_log_count,
      })
      appendLog(`diagnostics: db status ${data.status}`)
    } catch (err) {
      const message = parseError(err)
      setDbError(message)
      appendLog(`diagnostics: db failed (${message})`)
    } finally {
      setDbLoading(false)
    }
  }

  return (
    <div className="shell">
      <header className="hero">
        <div>
          <div className="eyebrow">VRM Voice Assistant</div>
          <h1>Phase 3 Frontend MVP</h1>
          <p className="sub">
            WebSocket ストリームと VRM をひとつの画面で確認できるデバッグ UI。音量ベースのリップシンクを含む。
          </p>
          <div className="hero-pills">
            <span className={`pill state-${state}`}>{state}</span>
            <span className={`pill ${micActive ? 'pill-hot' : ''}`}>mic {micActive ? 'on' : 'off'}</span>
            <span className="pill pill-soft">mouth {mouthOpen.toFixed(2)}</span>
          </div>
        </div>
        <div className="latency-card">
          <div className="eyebrow">Latency (ms)</div>
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
      </header>

      <section className="panel controls">
        <div className="section-head">
          <div>
            <div className="eyebrow">接続とソース</div>
            <h3>WebSocket / VRM</h3>
          </div>
          <div className="ws-url mono">{wsUrl}</div>
        </div>
        <div className="control-grid">
          <div className="field">
            <label>Base WS URL</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={DEFAULT_WS_BASE_URL}
            />
          </div>
          <div className="field">
            <label>Session ID</label>
            <input value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
          </div>
          <div className="field">
            <label>VRM URL</label>
            <input value={vrmUrl} onChange={(e) => setVrmUrl(e.target.value)} placeholder="https://...vrm" />
          </div>
        </div>
        <div className="actions">
          <button onClick={connect} disabled={state === 'connected' || state === 'connecting'}>
            Connect
          </button>
          <button onClick={disconnect} disabled={state === 'disconnected'}>
            Disconnect
          </button>
          <button onClick={() => sendControl('ping')} disabled={state !== 'connected'}>
            Ping
          </button>
          <button onClick={() => sendControl('flush')} disabled={state !== 'connected'}>
            Flush
          </button>
          <button onClick={() => sendControl('resume')} disabled={state !== 'connected'}>
            Resume
          </button>
          <button onClick={startMic} disabled={state !== 'connected' || micActive || !micSupported}>
            Start Mic
          </button>
          <button onClick={stopMic} disabled={!micActive}>
            Stop Mic
          </button>
        </div>
        <div className="live-stats">
          <div className="stat-block">
            <div className="eyebrow">Partial</div>
            <p className="mono">{partial || '—'}</p>
          </div>
          <div className="stat-block">
            <div className="eyebrow">User (latest)</div>
            <p className="mono">{lastUserText || '—'}</p>
          </div>
          <div className="stat-block">
            <div className="eyebrow">Assistant stream</div>
            <p className="mono small">{lastAssistantText || '—'}</p>
          </div>
          <div className="stat-block">
            <div className="eyebrow">TTS bytes</div>
            <p className="mono">{ttsBytes}</p>
          </div>
        </div>
      </section>

      <div className="main-grid">
        <section className="panel avatar-panel">
          <div className="section-head">
            <div>
              <div className="eyebrow">three-vrm + react-three-fiber</div>
              <h3>{avatarName ?? 'VRM Viewer'}</h3>
            </div>
            <div className="pill pill-soft">mouth {mouthOpen.toFixed(2)}</div>
          </div>
          <div className="canvas-wrap">
            <CanvasErrorBoundary
              resetKey={vrmUrl}
              onError={(err) => appendLog(`vrm load error: ${err.message}`)}
            >
              <AvatarCanvas key={vrmUrl} url={vrmUrl} mouthOpen={mouthOpen} onLoaded={setAvatarName} />
            </CanvasErrorBoundary>
          </div>
          <div className="avatar-meta">
            <div>
              <div className="eyebrow">VRM</div>
              <p className="mono small">{vrmUrl}</p>
            </div>
            <div>
              <div className="eyebrow">リップシンク</div>
              <div className="meter">
                <div className="bar" style={{ width: `${mouthOpen * 100}%` }} />
              </div>
            </div>
          </div>
        </section>

        <section className="panel chat-panel">
          <div className="section-head">
            <div>
              <div className="eyebrow">Text Chat Log</div>
              <h3>STT / LLM ストリーム</h3>
            </div>
          </div>
          <ChatLog turns={chatTurns} partial={partial} />
        </section>
      </div>

      <section className="panel diagnostics">
        <div className="section-head diag-headline">
          <div>
            <div className="eyebrow">要素別検証</div>
            <h3>Diagnostics Playground</h3>
            <p className="sub small">
              STT / LLM / TTS / Embedding / RAG / DB を個別に叩き、ボトルネックを切り分けます。
            </p>
          </div>
          <div className="field api-field">
            <label>API Base URL</label>
            <input
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder={DEFAULT_API_BASE_URL}
            />
            <p className="hint mono small">{`${apiBase}/diagnostics/...`}</p>
          </div>
        </div>

        <div className="diag-grid">
          <div className="diag-card">
            <div className="diag-head">
              <div>
                <div className="eyebrow">Speech to Text</div>
                <h4>STT</h4>
              </div>
              <div className="pill pill-soft">
                {sttResult ? `${(sttResult.byteLength / 1024).toFixed(1)} KB` : 'audio → text'}
              </div>
            </div>
            <div className="diag-body">
              <label className="inline-label">音声ファイル</label>
              <input type="file" accept="audio/*" onChange={(e) => setSttFile(e.target.files?.[0] ?? null)} />
              <div className="diag-actions">
                <button onClick={runSttCheck} disabled={sttLoading}>
                  {sttLoading ? 'Running...' : 'STT 実行'}
                </button>
                {sttResult?.fallbackUsed ? <span className="pill pill-hot">fallback</span> : null}
              </div>
              {sttError ? <p className="error-text">{sttError}</p> : null}
              {sttResult ? (
                <div className="diag-result">
                  <div className="diag-meta mono small">
                    <span>{sttResult.provider}</span>
                    <span>{sttResult.endpoint}</span>
                  </div>
                  <p className="mono small">{sttResult.text || '（空文字列）'}</p>
                </div>
              ) : (
                <p className="hint">短い OGG/WebM を送り、音声のみでパイプラインを確認します。</p>
              )}
            </div>
          </div>

          <div className="diag-card">
            <div className="diag-head">
              <div>
                <div className="eyebrow">Language</div>
                <h4>LLM</h4>
              </div>
              <div className="pill pill-soft">{llmResult ? `${llmResult.latencyMs.toFixed(0)} ms` : 'prompt → tokens'}</div>
            </div>
            <div className="diag-body">
              <label className="inline-label">プロンプト</label>
              <textarea value={llmPrompt} onChange={(e) => setLlmPrompt(e.target.value)} rows={3} />
              <label className="inline-label">コンテキスト（任意）</label>
              <textarea
                value={llmContext}
                onChange={(e) => setLlmContext(e.target.value)}
                rows={2}
                placeholder="追加したい文脈があれば貼り付け"
              />
              <div className="diag-actions">
                <button onClick={runLlmCheck} disabled={llmLoading}>
                  {llmLoading ? 'Running...' : 'LLM 実行'}
                </button>
                {llmResult ? <span className="pill pill-soft">tokens {llmResult.tokens.length}</span> : null}
                {llmResult?.fallbackUsed ? <span className="pill pill-hot">fallback</span> : null}
              </div>
              {llmError ? <p className="error-text">{llmError}</p> : null}
              {llmResult ? (
                <div className="diag-result">
                  <div className="diag-meta mono small">
                    <span>{llmResult.provider}</span>
                    <span>{llmResult.endpoint}</span>
                  </div>
                  <p className="mono small preview-text">{llmResult.assistantText || '(empty response)'}</p>
                </div>
              ) : (
                <p className="hint">音声抜きで LLM 単体のレイテンシと応答をチェック。</p>
              )}
            </div>
          </div>

          <div className="diag-card">
            <div className="diag-head">
              <div>
                <div className="eyebrow">Text to Speech</div>
                <h4>TTS</h4>
              </div>
              <div className="pill pill-soft">{ttsMeta ? `${ttsMeta.byteLength} bytes` : 'text → audio'}</div>
            </div>
            <div className="diag-body">
              <label className="inline-label">テキスト</label>
              <textarea value={ttsText} onChange={(e) => setTtsText(e.target.value)} rows={3} />
              <label className="inline-label">Voice（任意）</label>
              <input value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)} placeholder="provider 側の voice id" />
              <div className="diag-actions">
                <button onClick={runTtsCheck} disabled={ttsLoading}>
                  {ttsLoading ? 'Running...' : 'TTS 実行'}
                </button>
                {ttsMeta?.fallbackUsed ? <span className="pill pill-hot">fallback</span> : null}
                {ttsMeta ? <span className="pill pill-soft">{ttsMeta.latencyMs.toFixed(0)} ms</span> : null}
              </div>
              {ttsError ? <p className="error-text">{ttsError}</p> : null}
              {ttsAudioUrl && ttsMeta ? (
                <div className="diag-result">
                  <audio controls src={ttsAudioUrl} />
                  <div className="diag-meta mono small">
                    <span>{ttsMeta.provider}</span>
                    <span>{ttsMeta.mimeType}</span>
                    <span>{ttsMeta.chunkCount} chunks</span>
                  </div>
                </div>
              ) : (
                <p className="hint">音声合成のみを実行し、再生とフォーマットを確認。</p>
              )}
            </div>
          </div>

          <div className="diag-card">
            <div className="diag-head">
              <div>
                <div className="eyebrow">Embedding</div>
                <h4>ベクトル生成</h4>
              </div>
              <div className="pill pill-soft">
                {embeddingResult ? `${embeddingResult.dimensions} dim` : 'text → vector'}
              </div>
            </div>
            <div className="diag-body">
              <label className="inline-label">テキスト</label>
              <textarea value={embeddingText} onChange={(e) => setEmbeddingText(e.target.value)} rows={3} />
              <div className="diag-actions">
                <button onClick={runEmbeddingCheck} disabled={embeddingLoading}>
                  {embeddingLoading ? 'Running...' : 'Embedding 実行'}
                </button>
                {embeddingResult?.fallbackUsed ? <span className="pill pill-hot">fallback</span> : null}
              </div>
              {embeddingError ? <p className="error-text">{embeddingError}</p> : null}
              {embeddingResult ? (
                <div className="diag-result">
                  <div className="diag-meta mono small">
                    <span>{embeddingResult.provider}</span>
                    <span>{embeddingResult.endpoint}</span>
                  </div>
                  <p className="mono small vector-preview">
                    {embeddingResult.vector.slice(0, 8).map((value, idx) => (
                      <span key={idx} className="vector-chip">
                        {value.toFixed(3)}
                      </span>
                    ))}
                    {embeddingResult.vector.length > 8 ? ' ...' : ''}
                  </p>
                </div>
              ) : (
                <p className="hint">RAG の前段となる埋め込み生成だけを計測。</p>
              )}
            </div>
          </div>

          <div className="diag-card">
            <div className="diag-head">
              <div>
                <div className="eyebrow">RAG</div>
                <h4>検索</h4>
              </div>
              <div className="pill pill-soft">
                {ragResult ? `${ragResult.documents.length} docs` : 'query → context'}
              </div>
            </div>
            <div className="diag-body">
              <label className="inline-label">クエリ</label>
              <input value={ragQuery} onChange={(e) => setRagQuery(e.target.value)} />
              <label className="inline-label">top_k</label>
              <input
                type="number"
                min={1}
                max={50}
                value={ragTopK}
                onChange={(e) => setRagTopK(e.target.value)}
              />
              <div className="diag-actions">
                <button onClick={runRagCheck} disabled={ragLoading}>
                  {ragLoading ? 'Running...' : 'RAG 検索'}
                </button>
                {ragResult ? (
                  <span className={`pill ${ragResult.ragIndexLoaded ? 'pill-soft' : 'pill-hot'}`}>
                    index {ragResult.ragIndexLoaded ? 'loaded' : 'not loaded'}
                  </span>
                ) : null}
              </div>
              {ragError ? <p className="error-text">{ragError}</p> : null}
              {ragResult ? (
                <div className="diag-result">
                  <div className="diag-meta mono small">
                    <span>top_k: {ragResult.topK}</span>
                    <span>docs: {ragResult.documents.length}</span>
                  </div>
                  <ul className="doc-list">
                    {ragResult.documents.map((doc, idx) => (
                      <li key={`${doc.source}-${idx}`}>
                        <div className="pill pill-soft">#{idx + 1} {doc.source}</div>
                        <p className="mono small">{doc.content}</p>
                      </li>
                    ))}
                  </ul>
                  <pre className="context-preview mono small">{ragResult.contextText || 'context empty'}</pre>
                </div>
              ) : (
                <p className="hint">FAISS や文書ロードの結果だけを先にチェック。</p>
              )}
            </div>
          </div>

          <div className="diag-card">
            <div className="diag-head">
              <div>
                <div className="eyebrow">Database</div>
                <h4>DB 接続</h4>
              </div>
              <div className="pill pill-soft">{dbStatus?.status ?? 'ping only'}</div>
            </div>
            <div className="diag-body">
              <p className="hint">DB だけを切り離してヘルス確認。ログ件数が取れれば書き込みも確認。</p>
              <div className="diag-actions">
                <button onClick={pingDatabase} disabled={dbLoading}>
                  {dbLoading ? 'Pinging...' : 'DB Ping'}
                </button>
              </div>
              {dbError ? <p className="error-text">{dbError}</p> : null}
              {dbStatus ? (
                <div className="diag-result">
                  <div className="diag-meta mono small">
                    <span>status: {dbStatus.status}</span>
                    {typeof dbStatus.conversationLogCount === 'number' ? (
                      <span>logs: {dbStatus.conversationLogCount}</span>
                    ) : null}
                  </div>
                  {dbStatus.detail ? <p className="mono small">{dbStatus.detail}</p> : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="panel log">
        <div className="section-head">
          <div>
            <div className="eyebrow">Events</div>
            <h3>WS / オーディオログ</h3>
          </div>
          <div className="pill pill-soft">max 80 entries</div>
        </div>
        <ul>
          {logs
            .slice()
            .reverse()
            .map((entry, idx) => (
              <li key={idx}>
                <span className="time">{entry.time}</span>
                <span className="text">{entry.text}</span>
              </li>
            ))}
        </ul>
      </section>
    </div>
  )
}

export default App

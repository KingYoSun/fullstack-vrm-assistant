import { create } from 'zustand'
import type {
  ChatTurn,
  CharacterProfile,
  DbDiagResult,
  EmbeddingDiagResult,
  LatencyMap,
  LlmDiagResult,
  LogEntry,
  MotionDiagResult,
  MotionKeyframe,
  MotionRootPosition,
  RagDiagResult,
  SttDiagResult,
  SystemPrompt,
  TtsDiagMeta,
  WsState,
} from '../types/app'

type WsPayload = {
  type?: string
  text?: string
  turn_id?: string
  assistant_text?: string
  token?: string
  latency_ms?: { stt?: number; llm?: number; tts?: number }
  sample_rate?: number
  channels?: number
  mouth_open?: number
  job_id?: string
  url?: string
  output_path?: string
  format?: string
  duration_sec?: number
  fps?: number
  tracks?: Record<string, MotionKeyframe[]>
  rootPosition?: MotionRootPosition[]
  fallback?: boolean
  provider?: string
  endpoint?: string
  recoverable?: boolean
  message?: string
}

type CharacterForm = { name: string; persona: string; speakingStyle: string }
type SystemPromptForm = { title: string; content: string; isActive: boolean }

const DEFAULT_SYSTEM_PROMPT =
  'あなたは音声対応の VRM アシスタントです。ユーザーと自然な会話をするように口語で話し、本文は150文字以内にまとめてください。要点だけを端的に返し、一息で読み上げられる長さを維持します。提供されたコンテキストは関連する部分だけ取り込み、無い場合は簡潔に答えてください。'

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
  const noBackendPort = import.meta.env.VITE_NO_BACKEND_PORT
  const port = envPort === '' || noBackendPort ? '' : envPort ?? '8000'
  const protocol =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const portPart = port ? `:${port}` : ''

  return `${protocol}//${host}${portPart}${wsPath}`
}

const resolveDefaultApiBaseUrl = () => {
  const explicitBase = import.meta.env.VITE_API_BASE_URL
  if (explicitBase) return explicitBase.endsWith('/') ? explicitBase.slice(0, -1) : explicitBase

  const host =
    import.meta.env.VITE_BACKEND_HOST ||
    (typeof window !== 'undefined' && window.location.hostname) ||
    'localhost'
  const envPort = import.meta.env.VITE_BACKEND_PORT
  const noBackendPort = import.meta.env.VITE_NO_BACKEND_PORT
  const port = envPort === '' || noBackendPort ? '' : envPort ?? '8000'
  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https:' : 'http:'
  const apiPath = normalizePath(import.meta.env.VITE_API_BASE_PATH ?? DEFAULT_API_BASE_PATH, DEFAULT_API_BASE_PATH)
  const portPart = port ? `:${port}` : ''

  return `${protocol}//${host}${portPart}${apiPath}`
}

const DEFAULT_WS_BASE_URL = resolveDefaultWsBaseUrl()
const DEFAULT_API_BASE_URL = resolveDefaultApiBaseUrl()

const normalizeApiBase = (value: string) => {
  const base = (value || DEFAULT_API_BASE_URL).trim()
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base
  return trimmed || DEFAULT_API_BASE_URL
}

const initialCharacterForm: CharacterForm = {
  name: 'デフォルトキャラクター',
  persona: '',
  speakingStyle: '',
}

const initialSystemPromptForm: SystemPromptForm = {
  title: 'デフォルトプロンプト',
  content: DEFAULT_SYSTEM_PROMPT,
  isActive: true,
}

const detectMicSupported = () => {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & {
    getUserMedia?: (constraints: MediaStreamConstraints, successCallback: (stream: MediaStream) => void, errorCallback?: (error: unknown) => void) => void
    webkitGetUserMedia?: (constraints: MediaStreamConstraints, successCallback: (stream: MediaStream) => void, errorCallback?: (error: unknown) => void) => void
    mozGetUserMedia?: (constraints: MediaStreamConstraints, successCallback: (stream: MediaStream) => void, errorCallback?: (error: unknown) => void) => void
  }
  return Boolean(
    nav.mediaDevices?.getUserMedia ??
      nav.getUserMedia ??
      nav.webkitGetUserMedia ??
      nav.mozGetUserMedia
  )
}

const concatUint8Arrays = (chunks: Uint8Array[]) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const result = new Uint8Array(total)
  let offset = 0
  chunks.forEach((chunk) => {
    result.set(chunk, offset)
    offset += chunk.byteLength
  })
  return result
}

const detectAudioMime = (data: Uint8Array): string | null => {
  if (data.length < 12) return null
  if (data[0] === 0x4f && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53) return 'audio/ogg'
  if (
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x41 &&
    data[10] === 0x56 &&
    data[11] === 0x45
  ) {
    return 'audio/wav'
  }
  if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) return 'audio/webm'
  return null
}

const pcmToWav = (pcm: Uint8Array, sampleRate: number, channels = 1) => {
  const sampleWidth = 2
  const blockAlign = channels * sampleWidth
  const byteRate = sampleRate * blockAlign
  const buffer = new ArrayBuffer(44 + pcm.byteLength)
  const view = new DataView(buffer)

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + pcm.byteLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, sampleWidth * 8, true)
  writeString(36, 'data')
  view.setUint32(40, pcm.byteLength, true)

  new Uint8Array(buffer, 44).set(pcm)
  return new Uint8Array(buffer)
}

const audioFromBase64 = (base64: string, mimeType: string) => {
  const binary = atob(base64)
  const buffer = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    buffer[i] = binary.charCodeAt(i)
  }
  return new Blob([buffer], { type: mimeType })
}

const toNumber = (value: unknown, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

const normalizeMotionKeyframe = (value: unknown): MotionKeyframe | null => {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  return {
    t: toNumber(item.t, 0),
    x: toNumber(item.x, 0),
    y: toNumber(item.y, 0),
    z: toNumber(item.z, 0),
    w: toNumber(item.w, 1),
  }
}

const normalizeMotionTracks = (value: unknown): Record<string, MotionKeyframe[]> => {
  const tracks: Record<string, MotionKeyframe[]> = {}
  if (!value || typeof value !== 'object') return tracks
  Object.entries(value as Record<string, unknown>).forEach(([bone, raw]) => {
    if (!Array.isArray(raw)) return
    const frames = raw
      .map((entry) => normalizeMotionKeyframe(entry))
      .filter((kf): kf is MotionKeyframe => Boolean(kf))
    tracks[bone] = frames
  })
  return tracks
}

const normalizeRootPositions = (value: unknown): MotionRootPosition[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const item = entry as Record<string, unknown>
      return {
        t: toNumber(item.t, 0),
        x: toNumber(item.x, 0),
        y: toNumber(item.y, 0),
        z: toNumber(item.z, 0),
      }
    })
    .filter((pos): pos is MotionRootPosition => Boolean(pos))
}

const normalizeFallbackFlag = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lowered = value.toLowerCase()
    if (lowered === 'true') return true
    if (lowered === 'false') return false
  }
  return false
}

const normalizeMotionPayload = (data: Record<string, unknown>): MotionDiagResult => {
  const rootRaw = (data as { rootPosition?: unknown; root_position?: unknown }).rootPosition ?? (data as { root_position?: unknown }).root_position
  const url = typeof data.url === 'string' ? data.url : typeof data.output_path === 'string' ? data.output_path : ''
  const outputPath = typeof data.output_path === 'string' ? data.output_path : url
  const rootPosition = normalizeRootPositions(rootRaw)
  return {
    jobId:
      typeof data.job_id === 'string'
        ? data.job_id
        : typeof (data as { jobId?: string }).jobId === 'string'
          ? (data as { jobId?: string }).jobId!
          : 'unknown',
    url,
    outputPath,
    format: typeof data.format === 'string' ? data.format : 'vrm-json',
    durationSec: toNumber((data as { duration_sec?: unknown; duration?: unknown }).duration_sec ?? (data as { duration?: unknown }).duration, 0),
    fps: toNumber((data as { fps?: unknown }).fps, 0),
    tracks: normalizeMotionTracks((data as { tracks?: unknown }).tracks),
    rootPosition: rootPosition.length ? rootPosition : undefined,
    provider: typeof data.provider === 'string' ? data.provider : undefined,
    endpoint: typeof data.endpoint === 'string' ? data.endpoint : undefined,
    fallbackUsed: normalizeFallbackFlag((data as { fallback_used?: unknown; fallback?: unknown }).fallback_used ?? (data as { fallback?: unknown }).fallback),
  }
}

type AppState = {
  baseUrl: string
  apiBaseUrl: string
  apiBase: string
  sessionId: string
  vrmUrl: string
  state: WsState
  partial: string
  latency: LatencyMap
  logs: LogEntry[]
  micActive: boolean
  micSupported: boolean
  ttsBytes: number
  audioMouth: number
  avatarMouth: number
  avatarName: string | null
  cameraResetKey: number
  chatTurns: ChatTurn[]
  isMobile: boolean
  remoteCollapsed: boolean
  streamCollapsed: boolean
  connectionDrawerOpen: boolean
  personaDrawerOpen: boolean
  diagnosticsDrawerOpen: boolean
  logsDrawerOpen: boolean
  historyOpen: boolean
  showLatencyPanel: boolean
  sttFile: File | null
  sttResult: SttDiagResult | null
  sttError: string | null
  sttLoading: boolean
  llmPrompt: string
  llmContext: string
  llmResult: LlmDiagResult | null
  llmError: string | null
  llmLoading: boolean
  ttsText: string
  ttsVoice: string
  ttsMeta: TtsDiagMeta | null
  ttsAudioUrl: string | null
  ttsError: string | null
  ttsLoading: boolean
  motionPrompt: string
  motionResult: MotionDiagResult | null
  motionError: string | null
  motionLoading: boolean
  lastMotionEvent: MotionDiagResult | null
  motionPlayback: MotionDiagResult | null
  motionPlaybackKey: number
  vrmaUrl: string
  vrmaKey: number
  embeddingText: string
  embeddingResult: EmbeddingDiagResult | null
  embeddingError: string | null
  embeddingLoading: boolean
  ragQuery: string
  ragTopK: string
  ragResult: RagDiagResult | null
  ragError: string | null
  ragLoading: boolean
  dbStatus: DbDiagResult | null
  dbError: string | null
  dbLoading: boolean
  characters: CharacterProfile[]
  activeCharacterId: number | null
  characterForm: CharacterForm
  characterEditingId: number | null
  characterError: string | null
  characterLoading: boolean
  characterSaving: boolean
  characterDeletingId: number | null
  systemPrompts: SystemPrompt[]
  systemPromptEditingId: number | null
  systemPromptForm: SystemPromptForm
  systemPromptError: string | null
  systemPromptLoading: boolean
  systemPromptSaving: boolean
  systemPromptDeletingId: number | null
}

type AppActions = {
  appendLog: (text: string) => void
  setBaseUrl: (value: string) => void
  setApiBaseUrl: (value: string) => void
  setSessionId: (value: string) => void
  setIsMobile: (value: boolean) => void
  setConnectionDrawerOpen: (value: boolean) => void
  setPersonaDrawerOpen: (value: boolean) => void
  setDiagnosticsDrawerOpen: (value: boolean) => void
  setLogsDrawerOpen: (value: boolean) => void
  setRemoteCollapsed: (value: boolean) => void
  setStreamCollapsed: (value: boolean) => void
  setHistoryOpen: (value: boolean) => void
  setShowLatencyPanel: (value: boolean) => void
  incrementCameraResetKey: () => void
  setAvatarName: (value: string | null) => void
  updateVrmUrl: (url: string, options?: { isLocal?: boolean }) => void
  setPartial: (value: string) => void
  setLlmPrompt: (value: string) => void
  setLlmContext: (value: string) => void
  setTtsText: (value: string) => void
  setTtsVoice: (value: string) => void
  setMotionPrompt: (value: string) => void
  triggerMotionPlayback: (motion: MotionDiagResult | null) => void
  setVrmaUrl: (url: string) => void
  playVrma: () => void
  setEmbeddingText: (value: string) => void
  setRagQuery: (value: string) => void
  setRagTopK: (value: string) => void
  connect: () => void
  disconnect: () => void
  sendControl: (type: 'ping' | 'flush' | 'resume') => void
  startMic: () => Promise<void>
  stopMic: (options?: { flush?: boolean; reason?: string }) => void
  resetMouthDecay: () => void
  decayAvatarMouth: () => void
  toggleDrawer: (key: 'connectionDrawerOpen' | 'personaDrawerOpen' | 'diagnosticsDrawerOpen' | 'logsDrawerOpen') => void
  toggleRemoteCollapsed: () => void
  toggleStreamCollapsed: () => void
  toggleHistory: () => void
  toggleLatency: () => void
  setSttFile: (file: File | null) => void
  runSttCheck: () => Promise<void>
  runLlmCheck: () => Promise<void>
  runTtsCheck: () => Promise<void>
  runMotionCheck: () => Promise<void>
  runEmbeddingCheck: () => Promise<void>
  runRagCheck: () => Promise<void>
  pingDatabase: () => Promise<void>
  changeCharacterForm: (key: 'name' | 'persona' | 'speakingStyle', value: string) => void
  resetCharacterForm: () => void
  startEditCharacter: (profile: CharacterProfile) => void
  selectCharacter: (id: number | null) => void
  saveCharacter: () => Promise<void>
  deleteCharacter: (id: number) => Promise<void>
  loadCharacters: () => Promise<void>
  changeSystemPromptForm: (key: 'title' | 'content' | 'isActive', value: string | boolean) => void
  resetSystemPromptForm: () => void
  startEditSystemPrompt: (prompt: SystemPrompt) => void
  saveSystemPrompt: () => Promise<void>
  deleteSystemPrompt: (id: number) => Promise<void>
  setActiveSystemPrompt: (id: number) => Promise<void>
  loadSystemPrompts: () => Promise<void>
  clearTtsAudioUrl: () => void
  cleanup: () => void
}

export type AppStore = AppState & AppActions

let wsRef: WebSocket | null = null
let mediaRecorderRef: MediaRecorder | null = null
let ttsBuffersRef: Uint8Array[] = []
let ttsFormatRef = { sampleRate: 16000, channels: 1 }
let micBuffersRef: Uint8Array[] = []
let audioContextRef: AudioContext | null = null
let analyserRef: AnalyserNode | null = null
let audioSourceRef: AudioBufferSourceNode | null = null
let mouthRafRef: number | null = null
let currentTurnIdRef: string | null = null
let messageQueueRef: Promise<void> = Promise.resolve()
let localVrmObjectUrlRef: string | null = null

const micSupported = detectMicSupported()

export const useAppStore = create<AppStore>((set, get) => {
  const parseError = (err: unknown) => (err instanceof Error ? err.message : String(err))

  const buildApiUrl = (path: string) => {
    const normalized = path.startsWith('/') ? path : `/${path}`
    return `${get().apiBase}${normalized}`
  }

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

  const appendLog = (text: string) => {
    set((state) => {
      const next = [...state.logs, { time: new Date().toLocaleTimeString(), text }]
      return { logs: next.slice(-80) }
    })
  }

  const setTtsAudioUrl = (next: string | null) => {
    const prev = get().ttsAudioUrl
    if (prev && prev !== next) {
      URL.revokeObjectURL(prev)
    }
    set({ ttsAudioUrl: next })
  }

  const updateVrmUrl = (nextUrl: string, options: { isLocal?: boolean } = {}) => {
    if (localVrmObjectUrlRef && localVrmObjectUrlRef !== nextUrl) {
      URL.revokeObjectURL(localVrmObjectUrlRef)
      localVrmObjectUrlRef = null
    }
    if (options.isLocal) {
      localVrmObjectUrlRef = nextUrl
    }
    set({ vrmUrl: nextUrl, avatarName: null })
  }

  const resetCharacterForm = () => {
    set({
      characterError: null,
      characterEditingId: null,
      characterForm: initialCharacterForm,
    })
  }

  const resetSystemPromptForm = () => {
    set({
      systemPromptError: null,
      systemPromptEditingId: null,
      systemPromptForm: initialSystemPromptForm,
    })
  }

  const changeCharacterForm = (key: 'name' | 'persona' | 'speakingStyle', value: string) => {
    set((state) => ({ characterForm: { ...state.characterForm, [key]: value } }))
  }

  const changeSystemPromptForm = (key: 'title' | 'content' | 'isActive', value: string | boolean) => {
    set((state) => ({
      systemPromptForm: { ...state.systemPromptForm, [key]: key === 'isActive' ? Boolean(value) : String(value) },
    }))
  }

  const mapCharacter = (data: {
    id: number
    name: string
    persona: string
    speaking_style?: string | null
    created_at: string
    updated_at: string
  }): CharacterProfile => ({
    id: data.id,
    name: data.name,
    persona: data.persona,
    speakingStyle: data.speaking_style ?? '',
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  })

  const mapSystemPrompt = (data: {
    id: number
    title: string
    content: string
    is_active: boolean
    created_at: string
    updated_at: string
  }): SystemPrompt => ({
    id: data.id,
    title: data.title,
    content: data.content,
    isActive: data.is_active,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  })

  const ensureTurnId = (turnId?: string) => {
    if (turnId) {
      currentTurnIdRef = turnId
      return turnId
    }
    if (!currentTurnIdRef) {
      currentTurnIdRef = crypto.randomUUID?.() ?? `turn-${Date.now()}`
    }
    return currentTurnIdRef
  }

  const upsertTurn = (turnId: string, build: (prev: ChatTurn | null) => ChatTurn) => {
    set((state) => {
      const idx = state.chatTurns.findIndex((t) => t.id === turnId)
      const base = idx >= 0 ? state.chatTurns[idx] : null
      const updated = build(base)
      if (idx >= 0) {
        const next = [...state.chatTurns]
        next[idx] = updated
        return { chatTurns: next }
      }
      return { chatTurns: [...state.chatTurns, updated] }
    })
  }

  const stopAudioMeter = (haltSource = true) => {
    if (mouthRafRef !== null) {
      cancelAnimationFrame(mouthRafRef)
      mouthRafRef = null
    }
    if (haltSource && audioSourceRef) {
      try {
        audioSourceRef.stop()
      } catch {
        // noop
      }
      audioSourceRef.disconnect()
      audioSourceRef = null
    }
    set({ audioMouth: 0 })
  }

  const ensureAudioContext = async () => {
    if (!audioContextRef) {
      audioContextRef = new AudioContext()
    }
    await audioContextRef.resume()
    return audioContextRef
  }

  const playTtsBuffer = async () => {
    const buffers = ttsBuffersRef
    if (!buffers.length) return
    ttsBuffersRef = []
    const combined = concatUint8Arrays(buffers)
    const detectedMime = detectAudioMime(combined)
    const { sampleRate, channels } = ttsFormatRef
    const audioBytes = detectedMime ? combined : pcmToWav(combined, sampleRate, channels)
    const mimeType = detectedMime ?? 'audio/wav'
    const blob = new Blob([audioBytes], { type: mimeType })
    try {
      const ctx = await ensureAudioContext()
      const arrayBuffer = await blob.arrayBuffer()
      const decoded = await ctx.decodeAudioData(arrayBuffer)
      const source = ctx.createBufferSource()
      const analyser = analyserRef ?? ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.88
      analyserRef = analyser

      source.buffer = decoded
      source.connect(analyser)
      analyser.connect(ctx.destination)

      stopAudioMeter()
      audioSourceRef = source
      const dataArray = new Uint8Array(analyser.fftSize)

      const tick = () => {
        analyser.getByteTimeDomainData(dataArray)
        const rms =
          Math.sqrt(dataArray.reduce((sum, v) => sum + (v - 128) * (v - 128), 0) / dataArray.length) / 128
        const openness = Math.min(1, Math.max(0, (rms - 0.02) * 6))
        set((state) => ({ audioMouth: state.audioMouth * 0.4 + openness * 0.6 }))
        mouthRafRef = requestAnimationFrame(tick)
      }

      tick()
      const motion = get().lastMotionEvent
      if (motion) {
        triggerMotionPlayback(motion)
      }
      source.start()
      source.onended = () => {
        stopAudioMeter(false)
      }
    } catch (err) {
      appendLog(`audio decode error: ${(err as Error).message}`)
    }
  }

  const stopMic = (options?: { flush?: boolean; reason?: string }) => {
    const { flush = false, reason } = options ?? {}
    const wasActive = Boolean(mediaRecorderRef)
    if (mediaRecorderRef) {
      mediaRecorderRef.stop()
      mediaRecorderRef.stream.getTracks().forEach((t) => t.stop())
      mediaRecorderRef = null
      set({ micActive: false })
    }
    if (flush && wsRef && get().state === 'connected') {
      const chunks = micBuffersRef
      if (chunks.length) {
        const payload = concatUint8Arrays(chunks)
        wsRef.send(payload.buffer)
      }
      micBuffersRef = []
      wsRef.send(JSON.stringify({ type: 'flush' }))
    }
    if (wasActive || flush) {
      appendLog(`mic stopped${reason ? ` (${reason})` : ''}${flush ? ' + flush' : ''}`)
    }
  }

  const requestMicStream = async () => {
    if (typeof navigator === 'undefined') {
      throw new Error('navigator is not available（非ブラウザ環境）')
    }
    const nav = navigator as Navigator & {
      getUserMedia?: (constraints: MediaStreamConstraints, successCallback: (stream: MediaStream) => void, errorCallback?: (error: unknown) => void) => void
      webkitGetUserMedia?: (constraints: MediaStreamConstraints, successCallback: (stream: MediaStream) => void, errorCallback?: (error: unknown) => void) => void
      mozGetUserMedia?: (constraints: MediaStreamConstraints, successCallback: (stream: MediaStream) => void, errorCallback?: (error: unknown) => void) => void
    }
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
    if (get().micActive || get().state !== 'connected') return
    try {
      stopAudioMeter()
      if (audioSourceRef) {
        try {
          audioSourceRef.stop()
        } catch {
          // noop
        }
      }
      micBuffersRef = []
      const stream = await requestMicStream()
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 })
      recorder.ondataavailable = async (event) => {
        if (event.data && event.data.size > 0) {
          const buffer = await event.data.arrayBuffer()
          micBuffersRef.push(new Uint8Array(buffer))
        }
      }
      recorder.start(100)
      mediaRecorderRef = recorder
      set({ micActive: true })
      appendLog('mic started (one-shot)')
    } catch (err) {
      appendLog(`mic error: ${(err as Error).message}`)
    }
  }

  const handleJson = (payload: WsPayload) => {
    const type = payload?.type
    switch (type) {
      case 'partial_transcript':
        set({ partial: payload.text ?? '' })
        break
      case 'final_transcript': {
        const turnId = ensureTurnId(payload.turn_id)
        set({ partial: '' })
        upsertTurn(turnId, (prev) => ({
          id: turnId,
          userText: payload.text ?? prev?.userText ?? '',
          assistantText: prev?.assistantText ?? '',
          status: 'responding',
          startedAt: prev?.startedAt ?? Date.now(),
        }))
        stopMic({ reason: 'final_transcript' })
        if (typeof payload.latency_ms?.stt === 'number') {
          const sttLatency = payload.latency_ms.stt
          set((state) => ({ latency: { ...state.latency, stt: sttLatency } }))
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
        const latency = payload.latency_ms
        if (latency) {
          set((state) => ({
            latency: {
              ...state.latency,
              stt: latency.stt ?? state.latency.stt,
              llm: latency.llm ?? state.latency.llm,
            },
          }))
        }
        break
      }
      case 'tts_start': {
        set({ ttsBytes: 0 })
        ttsBuffersRef = []
        const sampleRate =
          typeof payload.sample_rate === 'number' && payload.sample_rate > 0 ? payload.sample_rate : 16000
        const channels = typeof payload.channels === 'number' && payload.channels > 0 ? payload.channels : 1
        ttsFormatRef = { sampleRate, channels }
        appendLog(`tts_start turn=${payload.turn_id}`)
        break
      }
      case 'tts_end': {
        appendLog(`tts_end turn=${payload.turn_id}`)
        void playTtsBuffer()
        const latency = payload.latency_ms
        if (latency) {
          set((state) => ({
            latency: {
              ...state.latency,
              llm: latency.llm ?? state.latency.llm,
              tts: latency.tts ?? state.latency.tts,
            },
          }))
        }
        break
      }
      case 'assistant_motion': {
        const result = normalizeMotionPayload(payload as Record<string, unknown>)
        set({ lastMotionEvent: result })
        appendLog(`assistant_motion job=${result.jobId || 'n/a'} fps=${result.fps || 0}`)
        break
      }
      case 'avatar_event':
        if (typeof payload.mouth_open === 'number') {
          const openness = Math.min(1, Math.max(0, payload.mouth_open))
          set((state) => ({ avatarMouth: state.avatarMouth * 0.5 + openness * 0.5 }))
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
      set((state) => ({ ttsBytes: state.ttsBytes + data.size }))
      ttsBuffersRef.push(new Uint8Array(await data.arrayBuffer()))
      return
    }
    if (data instanceof ArrayBuffer) {
      set((state) => ({ ttsBytes: state.ttsBytes + data.byteLength }))
      ttsBuffersRef.push(new Uint8Array(data))
      return
    }
    appendLog('unknown message type')
  }

  const connect = () => {
    if (get().state !== 'disconnected') return
    set({
      state: 'connecting',
      partial: '',
      chatTurns: [],
      avatarMouth: 0,
      audioMouth: 0,
      ttsBytes: 0,
    })
    ttsBuffersRef = []
    micBuffersRef = []
    const baseUrl = get().baseUrl.endsWith('/') ? get().baseUrl.slice(0, -1) : get().baseUrl
    const query = get().activeCharacterId ? `?character_id=${get().activeCharacterId}` : ''
    const wsUrl = `${baseUrl}/${get().sessionId}${query}`
    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    messageQueueRef = Promise.resolve()
    wsRef = ws

    ws.onopen = () => {
      set({ state: 'connected' })
      appendLog(`connected: ${wsUrl}`)
    }
    ws.onclose = (event) => {
      set({ state: 'disconnected' })
      currentTurnIdRef = null
      messageQueueRef = Promise.resolve()
      appendLog(`closed (${event.code}): ${event.reason || 'no reason'}`)
      stopMic()
      stopAudioMeter()
    }
    ws.onerror = () => {
      appendLog('websocket error')
    }
    ws.onmessage = (event) => {
      messageQueueRef = messageQueueRef
        .then(() => handleMessage(event.data))
        .catch((err) => {
          appendLog(`message handler error: ${err instanceof Error ? err.message : String(err)}`)
        })
    }
  }

  const disconnect = () => {
    wsRef?.close()
    wsRef = null
    set({ state: 'disconnected' })
    stopMic()
    stopAudioMeter()
  }

  const sendControl = (type: 'ping' | 'flush' | 'resume') => {
    if (!wsRef || get().state !== 'connected') return
    wsRef.send(JSON.stringify({ type }))
  }

  const setSttFile = (file: File | null) => set({ sttFile: file })

  const runSttCheck = async () => {
    set({ sttError: null })
    const { sttFile } = get()
    if (!sttFile) {
      set({ sttError: '音声ファイルを選択してください' })
      return
    }
    set({ sttLoading: true })
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
      set({
        sttResult: {
          text: data.text,
          byteLength: data.byte_length,
          provider: data.provider,
          endpoint: data.endpoint,
          fallbackUsed: data.fallback_used,
        },
      })
      appendLog(`diagnostics: stt ok (${data.byte_length} bytes)`)
    } catch (err) {
      const message = parseError(err)
      set({ sttError: message })
      appendLog(`diagnostics: stt failed (${message})`)
    } finally {
      set({ sttLoading: false })
    }
  }

  const runLlmCheck = async () => {
    set({ llmError: null })
    const prompt = get().llmPrompt.trim()
    const context = get().llmContext.trim()
    if (!prompt) {
      set({ llmError: 'プロンプトを入力してください' })
      return
    }
    set({ llmLoading: true })
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
        body: JSON.stringify({
          prompt,
          context: context || undefined,
          character_id: get().activeCharacterId ?? undefined,
        }),
      })
      set({
        llmResult: {
          assistantText: data.assistant_text,
          tokens: data.tokens,
          latencyMs: data.latency_ms,
          provider: data.provider,
          endpoint: data.endpoint,
          fallbackUsed: data.fallback_used,
        },
      })
      appendLog(`diagnostics: llm ok (${data.tokens.length} tokens)`)
    } catch (err) {
      const message = parseError(err)
      set({ llmError: message })
      appendLog(`diagnostics: llm failed (${message})`)
    } finally {
      set({ llmLoading: false })
    }
  }

  const runTtsCheck = async () => {
    set({ ttsError: null })
    const text = get().ttsText.trim()
    const voice = get().ttsVoice.trim()
    if (!text) {
      set({ ttsError: 'TTS テキストを入力してください' })
      return
    }
    set({ ttsLoading: true })
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
      setTtsAudioUrl(nextUrl)
      set({
        ttsMeta: {
          mimeType: data.mime_type,
          byteLength: data.byte_length,
          chunkCount: data.chunk_count,
          latencyMs: data.latency_ms,
          provider: data.provider,
          endpoint: data.endpoint,
          sampleRate: data.sample_rate,
          fallbackUsed: data.fallback_used,
        },
      })
      appendLog(`diagnostics: tts ok (${data.byte_length} bytes)`)
    } catch (err) {
      const message = parseError(err)
      set({ ttsError: message, ttsMeta: null })
      setTtsAudioUrl(null)
      appendLog(`diagnostics: tts failed (${message})`)
    } finally {
      set({ ttsLoading: false })
    }
  }

  const runMotionCheck = async () => {
    set({ motionError: null })
    const prompt = get().motionPrompt.trim()
    if (!prompt) {
      set({ motionError: 'モーション指示を入力してください' })
      return
    }
    set({ motionLoading: true })
    try {
      const data = await requestJson<Record<string, unknown>>('/diagnostics/motion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const result = normalizeMotionPayload(data)
      set({
        motionResult: result,
        lastMotionEvent: result,
        motionPlayback: result,
        motionPlaybackKey: Date.now(),
      })
      appendLog(`diagnostics: motion ok (job=${result.jobId || 'n/a'})`)
    } catch (err) {
      const message = parseError(err)
      set({ motionError: message })
      appendLog(`diagnostics: motion failed (${message})`)
    } finally {
      set({ motionLoading: false })
    }
  }

  const runEmbeddingCheck = async () => {
    set({ embeddingError: null })
    const text = get().embeddingText.trim()
    if (!text) {
      set({ embeddingError: 'テキストを入力してください' })
      return
    }
    set({ embeddingLoading: true })
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
      set({
        embeddingResult: {
          vector: data.vector,
          dimensions: data.dimensions,
          provider: data.provider,
          endpoint: data.endpoint,
          fallbackUsed: data.fallback_used,
        },
      })
      appendLog(`diagnostics: embedding ok (dim=${data.dimensions})`)
    } catch (err) {
      const message = parseError(err)
      set({ embeddingError: message })
      appendLog(`diagnostics: embedding failed (${message})`)
    } finally {
      set({ embeddingLoading: false })
    }
  }

  const runRagCheck = async () => {
    set({ ragError: null })
    const query = get().ragQuery.trim()
    const trimmedTopK = get().ragTopK.trim()
    const topKNumber = trimmedTopK ? Number(trimmedTopK) : undefined
    if (!query) {
      set({ ragError: 'クエリを入力してください' })
      return
    }
    if (topKNumber !== undefined && (!Number.isFinite(topKNumber) || topKNumber <= 0)) {
      set({ ragError: 'top_k は 1 以上の数値で入力してください' })
      return
    }
    set({ ragLoading: true })
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
      set({
        ragResult: {
          query: data.query,
          documents: data.documents,
          contextText: data.context_text,
          ragIndexLoaded: data.rag_index_loaded,
          topK: data.top_k,
        },
      })
      appendLog(`diagnostics: rag ok (docs=${data.documents.length})`)
    } catch (err) {
      const message = parseError(err)
      set({ ragError: message })
      appendLog(`diagnostics: rag failed (${message})`)
    } finally {
      set({ ragLoading: false })
    }
  }

  const pingDatabase = async () => {
    set({ dbError: null, dbLoading: true })
    try {
      const data = await requestJson<{
        status: string
        detail?: string | null
        conversation_log_count?: number | null
      }>('/diagnostics/db', { method: 'GET' })
      set({
        dbStatus: {
          status: data.status,
          detail: data.detail,
          conversationLogCount: data.conversation_log_count,
        },
      })
      appendLog(`diagnostics: db status ${data.status}`)
    } catch (err) {
      const message = parseError(err)
      set({ dbError: message })
      appendLog(`diagnostics: db failed (${message})`)
    } finally {
      set({ dbLoading: false })
    }
  }

  const loadCharacters = async () => {
    set({ characterError: null, characterLoading: true })
    try {
      const data = await requestJson<
        {
          id: number
          name: string
          persona: string
          speaking_style?: string | null
          created_at: string
          updated_at: string
        }[]
      >('/characters', { method: 'GET' })
      const mapped = data.map(mapCharacter)
      set((state) => {
        let nextActive = state.activeCharacterId
        if (!mapped.length) {
          nextActive = null
        } else if (nextActive && !mapped.some((c) => c.id === nextActive)) {
          nextActive = mapped[0]?.id ?? null
        } else if (!nextActive) {
          nextActive = mapped[0]?.id ?? null
        }
        return { characters: mapped, activeCharacterId: nextActive, characterEditingId: null }
      })
      if (!mapped.length) {
        resetCharacterForm()
      }
    } catch (err) {
      const message = parseError(err)
      set({ characterError: message })
      appendLog(`characters: load failed (${message})`)
    } finally {
      set({ characterLoading: false })
    }
  }

  const loadSystemPrompts = async () => {
    set({ systemPromptError: null, systemPromptLoading: true })
    try {
      const data = await requestJson<
        {
          id: number
          title: string
          content: string
          is_active: boolean
          created_at: string
          updated_at: string
        }[]
      >('/system-prompts', { method: 'GET' })
      const mapped = data.map(mapSystemPrompt).sort((a, b) => a.id - b.id)
      set({ systemPrompts: mapped })
      const editingId = get().systemPromptEditingId
      if (!mapped.length || (editingId && !mapped.some((p) => p.id === editingId))) {
        resetSystemPromptForm()
      }
    } catch (err) {
      const message = parseError(err)
      set({ systemPromptError: message })
      appendLog(`system prompts: load failed (${message})`)
    } finally {
      set({ systemPromptLoading: false })
    }
  }

  const selectCharacter = (id: number | null) => {
    set({ characterError: null, activeCharacterId: id, characterEditingId: id })
    if (id === null) {
      appendLog('characters: デフォルトプロンプトに戻しました')
    } else {
      appendLog(`characters: 適用 id=${id}`)
    }
  }

  const startEditCharacter = (profile: CharacterProfile) => {
    set({
      characterError: null,
      characterEditingId: profile.id,
      characterForm: {
        name: profile.name,
        persona: profile.persona,
        speakingStyle: profile.speakingStyle ?? '',
      },
    })
  }

  const saveCharacter = async () => {
    set({ characterError: null })
    const name = get().characterForm.name.trim()
    const persona = get().characterForm.persona.trim()
    const speakingStyle = get().characterForm.speakingStyle.trim()
    if (!name || !persona) {
      set({ characterError: '名前とキャラクター設定を入力してください' })
      return
    }
    set({ characterSaving: true })
    try {
      const payload = {
        name,
        persona,
        speaking_style: speakingStyle || undefined,
      }
      const path = get().characterEditingId ? `/characters/${get().characterEditingId}` : '/characters'
      const method = get().characterEditingId ? 'PUT' : 'POST'
      const data = await requestJson<{
        id: number
        name: string
        persona: string
        speaking_style?: string | null
        created_at: string
        updated_at: string
      }>(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const saved = mapCharacter(data)
      set((state) => {
        const next = state.characters.filter((c) => c.id !== saved.id)
        return {
          characters: [...next, saved].sort((a, b) => a.id - b.id),
          activeCharacterId: saved.id,
          characterEditingId: saved.id,
          characterForm: {
            name: saved.name,
            persona: saved.persona,
            speakingStyle: saved.speakingStyle ?? '',
          },
        }
      })
      appendLog(`characters: saved ${saved.name} (id=${saved.id})`)
    } catch (err) {
      const message = parseError(err)
      set({ characterError: message })
      appendLog(`characters: save failed (${message})`)
    } finally {
      set({ characterSaving: false })
    }
  }

  const deleteCharacter = async (id: number) => {
    if (typeof window !== 'undefined' && !window.confirm('このキャラクターを削除しますか？')) {
      return
    }
    set({ characterError: null, characterDeletingId: id })
    try {
      const response = await fetch(buildApiUrl(`/characters/${id}`), { method: 'DELETE' })
      const text = await response.text()
      if (!response.ok) {
        const message = text || `${response.status} ${response.statusText}`
        throw new Error(message)
      }
      set((state) => {
        const next = state.characters.filter((c) => c.id !== id)
        const nextActive = state.activeCharacterId === id ? next[0]?.id ?? null : state.activeCharacterId
        return {
          characters: next,
          activeCharacterId: nextActive,
          characterEditingId: state.characterEditingId === id ? null : state.characterEditingId,
        }
      })
      if (get().characterEditingId === id) {
        resetCharacterForm()
      }
      appendLog(`characters: deleted id=${id}`)
    } catch (err) {
      const message = parseError(err)
      set({ characterError: message })
      appendLog(`characters: delete failed (${message})`)
    } finally {
      set({ characterDeletingId: null })
    }
  }

  const startEditSystemPrompt = (prompt: SystemPrompt) => {
    set({
      systemPromptError: null,
      systemPromptEditingId: prompt.id,
      systemPromptForm: {
        title: prompt.title,
        content: prompt.content,
        isActive: prompt.isActive,
      },
    })
  }

  const saveSystemPrompt = async () => {
    set({ systemPromptError: null })
    const title = get().systemPromptForm.title.trim()
    const content = get().systemPromptForm.content.trim()
    if (!title || !content) {
      set({ systemPromptError: 'タイトルと本文を入力してください' })
      return
    }
    set({ systemPromptSaving: true })
    try {
      const payload = {
        title,
        content,
        is_active: get().systemPromptForm.isActive,
      }
      const path = get().systemPromptEditingId ? `/system-prompts/${get().systemPromptEditingId}` : '/system-prompts'
      const method = get().systemPromptEditingId ? 'PUT' : 'POST'
      const data = await requestJson<{
        id: number
        title: string
        content: string
        is_active: boolean
        created_at: string
        updated_at: string
      }>(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const saved = mapSystemPrompt(data)
      set((state) => {
        let next = state.systemPrompts.filter((p) => p.id !== saved.id)
        if (saved.isActive) {
          next = next.map((p) => ({ ...p, isActive: false }))
        }
        return {
          systemPrompts: [...next, saved].sort((a, b) => a.id - b.id),
          systemPromptEditingId: saved.id,
          systemPromptForm: {
            title: saved.title,
            content: saved.content,
            isActive: saved.isActive,
          },
        }
      })
      appendLog(`system prompts: saved ${saved.title} (id=${saved.id})${saved.isActive ? ' [active]' : ''}`)
    } catch (err) {
      const message = parseError(err)
      set({ systemPromptError: message })
      appendLog(`system prompts: save failed (${message})`)
    } finally {
      set({ systemPromptSaving: false })
    }
  }

  const deleteSystemPrompt = async (id: number) => {
    if (typeof window !== 'undefined' && !window.confirm('このシステムプロンプトを削除しますか？')) {
      return
    }
    set({ systemPromptError: null, systemPromptDeletingId: id })
    try {
      const response = await fetch(buildApiUrl(`/system-prompts/${id}`), { method: 'DELETE' })
      const text = await response.text()
      if (!response.ok) {
        const message = text || `${response.status} ${response.statusText}`
        throw new Error(message)
      }
      set((state) => ({
        systemPrompts: state.systemPrompts.filter((p) => p.id !== id),
        systemPromptEditingId: state.systemPromptEditingId === id ? null : state.systemPromptEditingId,
      }))
      if (get().systemPromptEditingId === id) {
        resetSystemPromptForm()
      }
      appendLog(`system prompts: deleted id=${id}`)
      void loadSystemPrompts()
    } catch (err) {
      const message = parseError(err)
      set({ systemPromptError: message })
      appendLog(`system prompts: delete failed (${message})`)
    } finally {
      set({ systemPromptDeletingId: null })
    }
  }

  const setActiveSystemPrompt = async (id: number) => {
    set({ systemPromptError: null })
    try {
      await requestJson(`/system-prompts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: true }),
      })
      appendLog(`system prompts: set active id=${id}`)
      await loadSystemPrompts()
    } catch (err) {
      const message = parseError(err)
      set({ systemPromptError: message })
      appendLog(`system prompts: activate failed (${message})`)
    }
  }

  const setIsMobile = (value: boolean) => {
    set((state) => ({
      isMobile: value,
      remoteCollapsed: value ? true : false,
      streamCollapsed: value ? true : false,
      connectionDrawerOpen: value ? false : state.connectionDrawerOpen,
      personaDrawerOpen: value ? false : state.personaDrawerOpen,
      diagnosticsDrawerOpen: value ? false : state.diagnosticsDrawerOpen,
      logsDrawerOpen: value ? false : state.logsDrawerOpen,
      historyOpen: value ? false : state.historyOpen,
      showLatencyPanel: value ? false : state.showLatencyPanel,
    }))
  }

  const setBaseUrl = (value: string) => set({ baseUrl: value })
  const setApiBaseUrl = (value: string) => {
    const normalized = normalizeApiBase(value)
    set({
      apiBaseUrl: value,
      apiBase: normalized,
      characters: [],
      activeCharacterId: null,
      characterEditingId: null,
      systemPrompts: [],
      systemPromptEditingId: null,
      characterForm: initialCharacterForm,
      systemPromptForm: initialSystemPromptForm,
    })
    void loadCharacters()
    void loadSystemPrompts()
  }
  const setSessionId = (value: string) => set({ sessionId: value })
  const setConnectionDrawerOpen = (value: boolean) => set({ connectionDrawerOpen: value })
  const setPersonaDrawerOpen = (value: boolean) => set({ personaDrawerOpen: value })
  const setDiagnosticsDrawerOpen = (value: boolean) => set({ diagnosticsDrawerOpen: value })
  const setLogsDrawerOpen = (value: boolean) => set({ logsDrawerOpen: value })
  const setRemoteCollapsed = (value: boolean) => set({ remoteCollapsed: value })
  const setStreamCollapsed = (value: boolean) => set({ streamCollapsed: value })
  const setHistoryOpen = (value: boolean) => set({ historyOpen: value })
  const setShowLatencyPanel = (value: boolean) => set({ showLatencyPanel: value })
  const setAvatarName = (value: string | null) => set({ avatarName: value })
  const setPartial = (value: string) => set({ partial: value })
  const setLlmPrompt = (value: string) => set({ llmPrompt: value })
  const setLlmContext = (value: string) => set({ llmContext: value })
  const setTtsText = (value: string) => set({ ttsText: value })
  const setTtsVoice = (value: string) => set({ ttsVoice: value })
  const setMotionPrompt = (value: string) => set({ motionPrompt: value })
  const triggerMotionPlayback = (motion: MotionDiagResult | null) =>
    set({ motionPlayback: motion, motionPlaybackKey: Date.now() })
  const setVrmaUrl = (url: string) => set({ vrmaUrl: url })
  const playVrma = () => {
    const url = get().vrmaUrl.trim()
    if (!url) return
    set({ vrmaKey: Date.now(), lastMotionEvent: null })
    appendLog(`vrma: play ${url}`)
  }
  const setEmbeddingText = (value: string) => set({ embeddingText: value })
  const setRagQuery = (value: string) => set({ ragQuery: value })
  const setRagTopK = (value: string) => set({ ragTopK: value })
  const incrementCameraResetKey = () => set((state) => ({ cameraResetKey: state.cameraResetKey + 1 }))

  const toggleDrawer = (
    key: 'connectionDrawerOpen' | 'personaDrawerOpen' | 'diagnosticsDrawerOpen' | 'logsDrawerOpen'
  ) => {
    set((state) => ({ [key]: !state[key] } as Partial<AppState>))
  }

  const toggleRemoteCollapsed = () => set((state) => ({ remoteCollapsed: !state.remoteCollapsed }))
  const toggleStreamCollapsed = () => set((state) => ({ streamCollapsed: !state.streamCollapsed }))
  const toggleHistory = () => set((state) => ({ historyOpen: !state.historyOpen }))
  const toggleLatency = () => set((state) => ({ showLatencyPanel: !state.showLatencyPanel }))

  const clearTtsAudioUrl = () => setTtsAudioUrl(null)

  const resetMouthDecay = () => set((state) => ({ avatarMouth: state.avatarMouth > 0.01 ? state.avatarMouth * 0.9 : 0 }))
  const decayAvatarMouth = () => set((state) => ({ avatarMouth: state.avatarMouth > 0.01 ? state.avatarMouth * 0.9 : 0 }))

  const cleanup = () => {
    wsRef?.close()
    wsRef = null
    stopMic()
    stopAudioMeter()
    if (localVrmObjectUrlRef) {
      URL.revokeObjectURL(localVrmObjectUrlRef)
      localVrmObjectUrlRef = null
    }
    setTtsAudioUrl(null)
  }

  return {
    baseUrl: DEFAULT_WS_BASE_URL,
    apiBaseUrl: DEFAULT_API_BASE_URL,
    apiBase: normalizeApiBase(DEFAULT_API_BASE_URL),
    sessionId: 'demo-session',
    vrmUrl: DEFAULT_VRM,
    state: 'disconnected',
    partial: '',
    latency: {},
    logs: [],
    micActive: false,
    micSupported,
    ttsBytes: 0,
    audioMouth: 0,
    avatarMouth: 0,
    avatarName: null,
    cameraResetKey: 0,
    chatTurns: [],
    isMobile: typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
    remoteCollapsed: typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
    streamCollapsed: typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
    connectionDrawerOpen: false,
    personaDrawerOpen: false,
    diagnosticsDrawerOpen: false,
    logsDrawerOpen: false,
    historyOpen: false,
    showLatencyPanel: false,
    sttFile: null,
    sttResult: null,
    sttError: null,
    sttLoading: false,
    llmPrompt: 'システムの状態を簡潔に教えて。',
    llmContext: '',
    llmResult: null,
    llmError: null,
    llmLoading: false,
    ttsText: 'これは音声合成のテストです。音質とレスポンスを確認します。',
    ttsVoice: '',
    ttsMeta: null,
    ttsAudioUrl: null,
    ttsError: null,
    ttsLoading: false,
    motionPrompt: '3秒で手を振る',
    motionResult: null,
    motionError: null,
    motionLoading: false,
    lastMotionEvent: null,
    motionPlayback: null,
    motionPlaybackKey: 0,
    vrmaUrl: '',
    vrmaKey: 0,
    embeddingText: '3D アバターの対話体験を向上させるためのヒントを教えて',
    embeddingResult: null,
    embeddingError: null,
    embeddingLoading: false,
    ragQuery: 'このプロジェクトの目的は？',
    ragTopK: '4',
    ragResult: null,
    ragError: null,
    ragLoading: false,
    dbStatus: null,
    dbError: null,
    dbLoading: false,
    characters: [],
    activeCharacterId: null,
    characterForm: initialCharacterForm,
    characterEditingId: null,
    characterError: null,
    characterLoading: false,
    characterSaving: false,
    characterDeletingId: null,
    systemPrompts: [],
    systemPromptEditingId: null,
    systemPromptForm: initialSystemPromptForm,
    systemPromptError: null,
    systemPromptLoading: false,
    systemPromptSaving: false,
    systemPromptDeletingId: null,
    appendLog,
    setBaseUrl,
    setApiBaseUrl,
    setSessionId,
    setIsMobile,
    setConnectionDrawerOpen,
    setPersonaDrawerOpen,
    setDiagnosticsDrawerOpen,
    setLogsDrawerOpen,
    setRemoteCollapsed,
    setStreamCollapsed,
    setHistoryOpen,
    setShowLatencyPanel,
    incrementCameraResetKey,
    setAvatarName,
    updateVrmUrl,
    setPartial,
    setLlmPrompt,
    setLlmContext,
    setTtsText,
    setTtsVoice,
    setMotionPrompt,
    triggerMotionPlayback,
    setEmbeddingText,
    setRagQuery,
    setRagTopK,
    connect,
    disconnect,
    sendControl,
    startMic,
    stopMic,
    resetMouthDecay,
    decayAvatarMouth,
    toggleDrawer,
    toggleRemoteCollapsed,
    toggleStreamCollapsed,
    toggleHistory,
    toggleLatency,
    setSttFile,
    runSttCheck,
    runLlmCheck,
    runTtsCheck,
    runMotionCheck,
    runEmbeddingCheck,
    runRagCheck,
    pingDatabase,
    changeCharacterForm,
    resetCharacterForm,
    startEditCharacter,
    selectCharacter,
    saveCharacter,
    deleteCharacter,
    loadCharacters,
    changeSystemPromptForm,
    resetSystemPromptForm,
    startEditSystemPrompt,
    saveSystemPrompt,
    deleteSystemPrompt,
    setActiveSystemPrompt,
    loadSystemPrompts,
    clearTtsAudioUrl,
    setVrmaUrl,
    playVrma,
    cleanup,
  }
})

export const selectWsUrl = (state: AppState) => {
  const normalized = state.baseUrl.endsWith('/') ? state.baseUrl.slice(0, -1) : state.baseUrl
  const query = state.activeCharacterId ? `?character_id=${state.activeCharacterId}` : ''
  return `${normalized}/${state.sessionId}${query}`
}

export const DEFAULTS = {
  SYSTEM_PROMPT: DEFAULT_SYSTEM_PROMPT,
  VRM: DEFAULT_VRM,
  WS_BASE_URL: DEFAULT_WS_BASE_URL,
  API_BASE_URL: DEFAULT_API_BASE_URL,
}

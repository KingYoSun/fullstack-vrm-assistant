export type WsState = 'disconnected' | 'connecting' | 'connected'

export type LogEntry = { time: string; text: string }

export type ChatTurn = {
  id: string
  userText: string
  assistantText: string
  status: 'listening' | 'responding' | 'done'
  startedAt: number
}

export type LatencyMap = { stt?: number; llm?: number; tts?: number }

export type SttDiagResult = {
  text: string
  byteLength: number
  provider: string
  endpoint: string
  fallbackUsed: boolean
}

export type LlmDiagResult = {
  assistantText: string
  tokens: string[]
  latencyMs: number
  provider: string
  endpoint: string
  fallbackUsed: boolean
}

export type TtsDiagMeta = {
  mimeType: string
  byteLength: number
  chunkCount: number
  latencyMs: number
  provider: string
  endpoint: string
  sampleRate: number
  fallbackUsed: boolean
}

export type EmbeddingDiagResult = {
  vector: number[]
  dimensions: number
  provider: string
  endpoint: string
  fallbackUsed: boolean
}

export type RagDiagResult = {
  query: string
  documents: { source: string; content: string }[]
  contextText: string
  ragIndexLoaded: boolean
  topK: number
}

export type DbDiagResult = { status: string; detail?: string | null; conversationLogCount?: number | null }

export type CharacterProfile = {
  id: number
  name: string
  persona: string
  speakingStyle?: string | null
  createdAt: string
  updatedAt: string
}

export type SystemPrompt = {
  id: number
  title: string
  content: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

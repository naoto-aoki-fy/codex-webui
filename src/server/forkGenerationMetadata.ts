import { createHash } from 'node:crypto'
import { readGenerationMetadata, mergeGenerationMetadata, type TurnGenerationMetadata } from '../turnGenerationMetadata.js'
function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }
// Use exact user and assistant text only when both are present and all user
// inputs are textual. Skip large turns and duplicate fingerprints.
function turnTextFingerprint(turn: unknown): string {
  const items = record(turn)?.items
  if (!Array.isArray(items)) return ''
  const parts: Array<[string, string[]]> = []
  let hasUser = false
  let hasAssistant = false
  let length = 0
  for (const item of items) {
    const row = record(item)
    if (row?.type === 'userMessage') {
      if (!Array.isArray(row.content) || row.content.length === 0) return ''
      const texts: string[] = []
      for (const entry of row.content) {
        const input = record(entry)
        if (input?.type !== 'text' || typeof input.text !== 'string') return ''
        texts.push(input.text)
        length += input.text.length
      }
      hasUser = texts.some((value) => value.length > 0) || hasUser
      parts.push(['user', texts])
    } else if (row?.type === 'agentMessage' && typeof row.text === 'string' && row.text.length > 0) {
      hasAssistant = true
      length += row.text.length
      parts.push(['assistant', [row.text]])
    }
    if (length > 262144) return ''
  }
  return hasUser && hasAssistant ? createHash('sha256').update(JSON.stringify(parts)).digest('hex') : ''
}

// Prefer turn and item IDs. Identical text is used only when it uniquely
// identifies a complete turn on both sides of the fork.
export function inheritForkTurnMetadata(sourceTurns: unknown[], forkTurns: unknown[]): {
  turns: unknown[]
  entries: Array<{ turnId: string; metadata: TurnGenerationMetadata }>
} {
  const byTurnId = new Map<string, Set<number>>()
  const byItemId = new Map<string, Set<number>>()
  const byFingerprint = new Map<string, Set<number>>()
  function index(map: Map<string, Set<number>>, id: string, position: number): void {
    const positions = map.get(id) ?? new Set<number>()
    positions.add(position)
    map.set(id, positions)
  }
  sourceTurns.forEach((turn, position) => {
    const row = record(turn)
    if (typeof row?.id === 'string' && row.id) index(byTurnId, row.id, position)
    const fingerprint = turnTextFingerprint(turn)
    if (fingerprint) index(byFingerprint, fingerprint, position)
    if (Array.isArray(row?.items)) for (const item of row.items) {
      const id = record(item)?.id
      if (typeof id === 'string' && id) index(byItemId, id, position)
    }
  })
  const matches = forkTurns.map((turn) => {
    const row = record(turn)
    if (typeof row?.id !== 'string' || !row.id) return undefined
    const direct = byTurnId.get(row.id)
    if (direct) return direct.size === 1 ? [...direct][0] : undefined
    const candidates = new Set<number>()
    if (Array.isArray(row.items)) for (const item of row.items) {
      const id = record(item)?.id
      if (typeof id !== 'string') continue
      for (const position of byItemId.get(id) ?? []) candidates.add(position)
    }
    if (candidates.size > 0) return candidates.size === 1 ? [...candidates][0] : undefined
    const fingerprint = turnTextFingerprint(turn)
    const textMatches = fingerprint ? byFingerprint.get(fingerprint) : undefined
    return textMatches?.size === 1 ? [...textMatches][0] : undefined
  })
  const counts = new Map<number, number>()
  for (const match of matches) if (match !== undefined) counts.set(match, (counts.get(match) ?? 0) + 1)
  const entries: Array<{ turnId: string; metadata: TurnGenerationMetadata }> = []
  const turns = forkTurns.map((turn, index) => {
    const row = record(turn)
    const match = matches[index]
    if (!row || typeof row.id !== 'string' || match === undefined || counts.get(match) !== 1) return turn
    const source = readGenerationMetadata(record(sourceTurns[match])?.generationMetadata)
    if (!source) return turn
    const existing = readGenerationMetadata(row.generationMetadata)
    const metadata = mergeGenerationMetadata(source, existing)
    if (JSON.stringify(metadata) === JSON.stringify(existing)) return turn
    entries.push({ turnId: row.id, metadata })
    return { ...row, generationMetadata: metadata }
  })
  return { turns, entries }
}

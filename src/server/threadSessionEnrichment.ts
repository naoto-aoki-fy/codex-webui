import { readFile, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { asRecord } from './bridgeHttpUtils.js'
import { sessionMessageTimes, mergeMessageTimes } from './messageTimestamps.js'
import { inheritForkTurnMetadata, SessionGenerationMetadataCache, type TurnGenerationMetadataStore } from './turnGenerationMetadata.js'
import type { TurnGenerationMetadata } from '../turnGenerationMetadata.js'

type RpcExecutor = { rpc: (method: string, params: unknown) => Promise<unknown> }

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : ''
}

type SessionRecoveredSkillInput = {
  name: string
  path: string
}

type SessionSkillInputCacheEntry = {
  size: number
  mtimeMs: number
  skillsByTurnId: Map<string, SessionRecoveredSkillInput[]>
  generationByTurnId: Map<string, TurnGenerationMetadata>
  messageTimes: ReturnType<typeof sessionMessageTimes>
  forkedFromId: string
}

const SESSION_SKILL_INPUT_CACHE_LIMIT = 64
const sessionSkillInputCache = new Map<string, SessionSkillInputCacheEntry>()
const sessionGenerationMetadataCache = new SessionGenerationMetadataCache()

function parseSessionSkillText(value: string): SessionRecoveredSkillInput | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith('<skill>')) return null
  const name = trimmed.match(/<name>\s*([\s\S]*?)\s*<\/name>/u)?.[1]?.trim() ?? ''
  const path = trimmed.match(/<path>\s*([\s\S]*?)\s*<\/path>/u)?.[1]?.trim() ?? ''
  if (!name || !path) return null
  return { name, path }
}

function buildSessionSkillInputsByTurn(sessionLogRaw: string): Map<string, SessionRecoveredSkillInput[]> {
  let currentTurnId = ''
  const skillsByTurnId = new Map<string, SessionRecoveredSkillInput[]>()

  for (const line of sessionLogRaw.split('\n')) {
    if (!line.trim()) continue
    let row: Record<string, unknown> | null = null
    try {
      row = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    if (row.type === 'turn_context') {
      const payloadRecord = asRecord(row.payload)
      currentTurnId = readNonEmptyString(payloadRecord?.turn_id) || currentTurnId
      continue
    }
    if (row.type === 'event_msg') {
      const payloadRecord = asRecord(row.payload)
      if (payloadRecord?.type === 'task_started') {
        currentTurnId = readNonEmptyString(payloadRecord.turn_id) || currentTurnId
      }
      continue
    }

    if (row.type !== 'response_item' || !currentTurnId) continue
    const payloadRecord = asRecord(row.payload)
    if (payloadRecord?.type !== 'message' || payloadRecord.role !== 'user') continue
    const content = Array.isArray(payloadRecord.content) ? payloadRecord.content : []

    for (const contentItem of content) {
      const contentRecord = asRecord(contentItem)
      if (contentRecord?.type !== 'input_text' || typeof contentRecord.text !== 'string') continue
      const skill = parseSessionSkillText(contentRecord.text)
      if (!skill) continue
      const existing = skillsByTurnId.get(currentTurnId) ?? []
      if (!existing.some((item) => item.path === skill.path)) {
        existing.push(skill)
        skillsByTurnId.set(currentTurnId, existing)
      }
    }
  }

  return skillsByTurnId
}

async function readCachedSessionDetails(sessionPath: string): Promise<SessionSkillInputCacheEntry> {
  const sessionStat = await stat(sessionPath)
  const cached = sessionSkillInputCache.get(sessionPath)
  if (cached && cached.size === sessionStat.size && cached.mtimeMs === sessionStat.mtimeMs) {
    return cached
  }

  const sessionLogRaw = await readFile(sessionPath, 'utf8')
  const skillsByTurnId = buildSessionSkillInputsByTurn(sessionLogRaw)
  const entry: SessionSkillInputCacheEntry = {
    size: sessionStat.size,
    mtimeMs: sessionStat.mtimeMs,
    skillsByTurnId,
    messageTimes: sessionMessageTimes(sessionLogRaw),
    generationByTurnId: sessionGenerationMetadataCache.readRaw(sessionPath, sessionLogRaw,
      `${sessionStat.dev}:${sessionStat.ino}`, `${sessionStat.size}:${sessionStat.mtimeMs}`),
    forkedFromId: readSessionForkParent(sessionLogRaw),
  }
  sessionSkillInputCache.set(sessionPath, entry)
  if (sessionSkillInputCache.size > SESSION_SKILL_INPUT_CACHE_LIMIT) {
    const oldestKey = sessionSkillInputCache.keys().next().value
    if (oldestKey) sessionSkillInputCache.delete(oldestKey)
  }
  return entry
}

function readSessionForkParent(raw: string): string {
  // Session metadata is at the beginning of the rollout. Only trust an
  // explicit fork parent, never the parent of a spawned sub-agent.
  for (const line of raw.slice(0, 262144).split('\n')) {
    if (!line.includes('"session_meta"') && !line.includes('"session_configured"')) continue
    try {
      const row = asRecord(JSON.parse(line))
      const payload = asRecord(row?.payload)
      if (row?.type !== 'session_meta' && !(row?.type === 'event_msg' && payload?.type === 'session_configured')) continue
      const id = readNonEmptyString(payload?.forked_from_id) || readNonEmptyString(payload?.forkedFromId)
      if (id) return id
    } catch { /* Ignore malformed or partial records. */ }
  }
  return ''
}

function mergeSessionSkillInputsIntoTurnsFromMap(
  turns: unknown[],
  skillsByTurnId: Map<string, SessionRecoveredSkillInput[]>,
): unknown[] {
  const turnIds = new Set<string>()
  for (const turn of turns) {
    const turnRecord = asRecord(turn)
    const turnId = readNonEmptyString(turnRecord?.id)
    if (turnId) turnIds.add(turnId)
  }
  if (turnIds.size === 0) return turns

  if (skillsByTurnId.size === 0) return turns

  let changed = false
  const nextTurns = turns.map((turn) => {
    const turnRecord = asRecord(turn)
    const turnId = readNonEmptyString(turnRecord?.id)
    const skills = turnId ? skillsByTurnId.get(turnId) : undefined
    const items = Array.isArray(turnRecord?.items) ? turnRecord.items : null
    if (!turnRecord || !skills || skills.length === 0 || !items) return turn

    let targetUserMessageIndex = -1
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const itemRecord = asRecord(items[index])
      if (itemRecord?.type === 'userMessage' && Array.isArray(itemRecord.content)) {
        targetUserMessageIndex = index
        break
      }
    }
    if (targetUserMessageIndex < 0) return turn

    let addedToMessage = false
    const nextItems = items.map((item, index) => {
      const itemRecord = asRecord(item)
      const content = Array.isArray(itemRecord?.content) ? itemRecord.content : null
      if (index !== targetUserMessageIndex || itemRecord?.type !== 'userMessage' || !content) return item

      const existingSkillPaths = new Set(
        content.flatMap((contentItem) => {
          const contentRecord = asRecord(contentItem)
          const path = typeof contentRecord?.path === 'string' ? contentRecord.path.trim() : ''
          return contentRecord?.type === 'skill' && path ? [path] : []
        }),
      )
      const missingSkills = skills.filter((skill) => !existingSkillPaths.has(skill.path))
      if (missingSkills.length === 0) return item

      addedToMessage = true
      changed = true
      return {
        ...itemRecord,
        content: [
          ...content,
          ...missingSkills.map((skill) => ({ type: 'skill', name: skill.name, path: skill.path })),
        ],
      }
    })

    return addedToMessage ? { ...turnRecord, items: nextItems } : turn
  })

  return changed ? nextTurns : turns
}

export function mergeSessionSkillInputsIntoTurns(turns: unknown[], sessionLogRaw: string): unknown[] {
  return mergeSessionSkillInputsIntoTurnsFromMap(turns, buildSessionSkillInputsByTurn(sessionLogRaw))
}

const recoveredForks = new Map<string, string>()
const forkRecoveryInFlight = new Map<string, Promise<unknown>>()
const forkRecoveryRetryAfter = new Map<string, number>()

export function createThreadSessionEnrichment(turnGenerationMetadataStore: Pick<TurnGenerationMetadataStore, 'mergeIntoTurns' | 'saveMany'>) {
  async function mergeSessionSkillInputsIntoThreadResult(result: unknown): Promise<unknown> {
    const record = asRecord(result)
    const thread = asRecord(record?.thread)
    const turns = Array.isArray(thread?.turns) ? thread.turns : null
    const sessionPath = readNonEmptyString(thread?.path)
    const threadId = readNonEmptyString(thread?.id)
    if (!record || !thread || !turns || turns.length === 0 || !threadId) {
      return result
    }

    let mergedTurns = turns
    let execution = new Map<string, TurnGenerationMetadata>()
    if (sessionPath && isAbsolute(sessionPath)) {
      try {
        const details = await readCachedSessionDetails(sessionPath)
        mergedTurns = mergeSessionSkillInputsIntoTurnsFromMap(turns, details.skillsByTurnId)
        mergedTurns = mergeMessageTimes(mergedTurns, details.messageTimes)
        execution = details.generationByTurnId
      } catch { /* Submitted metadata is still available without a session log. */ }
    }
    mergedTurns = await turnGenerationMetadataStore.mergeIntoTurns(threadId, mergedTurns, execution)
    return { ...record, thread: { ...thread, turns: mergedTurns } }
  }


  async function inheritForkMetadata(appServer: RpcExecutor, sourceThreadId: string, forkResult: unknown): Promise<unknown> {
    const forkRecord = asRecord(forkResult)
    const forkThread = asRecord(forkRecord?.thread)
    const forkId = readNonEmptyString(forkThread?.id)
    const forkTurns = Array.isArray(forkThread?.turns) ? forkThread.turns : null
    if (!forkRecord || !forkThread || !forkId || !forkTurns || !sourceThreadId || sourceThreadId === forkId) return forkResult

    const sourceResult = await appServer.rpc('thread/read', { threadId: sourceThreadId, includeTurns: true })
    const enrichedSource = await mergeSessionSkillInputsIntoThreadResult(sourceResult)
    const sourceTurns = asRecord(asRecord(enrichedSource)?.thread)?.turns
    if (!Array.isArray(sourceTurns)) return forkResult
    const enrichedFork = await mergeSessionSkillInputsIntoThreadResult(forkResult)
    const enrichedForkThread = asRecord(asRecord(enrichedFork)?.thread)
    const enrichedForkTurns = Array.isArray(enrichedForkThread?.turns) ? enrichedForkThread.turns : forkTurns
    const inherited = inheritForkTurnMetadata(sourceTurns, enrichedForkTurns)
    await turnGenerationMetadataStore.saveMany(forkId, inherited.entries)
    return { ...forkRecord, thread: { ...forkThread, turns: inherited.turns } }
  }

  async function recoverForkMetadata(appServer: RpcExecutor, result: unknown, explicitParent = ''): Promise<unknown> {
    const thread = asRecord(asRecord(result)?.thread)
    const threadId = readNonEmptyString(thread?.id)
    const turns = Array.isArray(thread?.turns) ? thread.turns : null
    if (!threadId || !turns || turns.length === 0) return result
    let parent = explicitParent
    if (!parent) {
      const path = readNonEmptyString(thread?.path)
      if (path && isAbsolute(path)) {
        try { parent = (await readCachedSessionDetails(path)).forkedFromId } catch { /* no session metadata */ }
      }
    }
    if (!parent || parent === threadId || recoveredForks.get(threadId) === parent
      || (forkRecoveryRetryAfter.get(threadId) ?? 0) > Date.now()) return result
    const existing = forkRecoveryInFlight.get(threadId)
    if (existing) {
      await existing.catch(() => {})
      return result
    }
    const recovery = inheritForkMetadata(appServer, parent, result)
    forkRecoveryInFlight.set(threadId, recovery)
    try {
      const enriched = await recovery
      recoveredForks.set(threadId, parent)
      if (recoveredForks.size > 64) recoveredForks.delete(recoveredForks.keys().next().value!)
      return enriched
    } catch (error) {
      // Fork/read already succeeded; a metadata failure must not fail that operation.
      console.warn('Failed to recover fork turn metadata', error)
      forkRecoveryRetryAfter.set(threadId, Date.now() + 30_000)
      if (forkRecoveryRetryAfter.size > 64) forkRecoveryRetryAfter.delete(forkRecoveryRetryAfter.keys().next().value!)
      return result
    } finally {
      if (forkRecoveryInFlight.get(threadId) === recovery) forkRecoveryInFlight.delete(threadId)
    }
  }


  return { mergeSessionSkillInputsIntoThreadResult, recoverForkMetadata }
}

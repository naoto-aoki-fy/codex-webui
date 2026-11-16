import { clientMessageId } from './clientMessageId'
import { browserTabIdentity } from './browserTabIdentity'
import { profileStorageKey } from './browserConnectionProfile'

export type FileAttachment = { label: string; path: string; fsPath: string }

export type ComposerDraftPayload = {
  apps?: import('../api/apps').AppReference[]
  text: string
  imageUrls: string[]
  fileAttachments: FileAttachment[]
  skills: Array<{ name: string; path: string }>
}

const DRAFT_STORAGE_PREFIX = 'codex-web-local.thread-draft.v2.'
const memories = new WeakMap<object, Map<string, string>>()
function memory() {
  let value = memories.get(window)
  if (!value) { value = new Map(); memories.set(window, value) }
  return value
}
export let draftStorageError = ''
function prefix(threadId: string): string {
  return profileStorageKey(`${DRAFT_STORAGE_PREFIX}${encodeURIComponent(threadId).replace(/\./g, '%2E')}.`)
}
function getDraftStorageKey(threadId: string): string {
  const { tabId, writerId } = browserTabIdentity()
  return `${prefix(threadId)}${tabId}.${writerId}`
}
function pointerKey(threadId: string) { return `${prefix(threadId)}resume` }
function legacyKeys(threadId: string) {
  return [profileStorageKey(`codex-web-local.thread-draft.v1.${threadId}`),
    profileStorageKey(`codex-web-local.thread-fork-recovery.v1.${threadId}`)]
}

export function loadPersistedDraftForThread(threadId: string): ComposerDraftPayload | null {
  if (typeof window === 'undefined') return null
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return null
  try {
    const owned = getDraftStorageKey(normalizedThreadId)
    let previous: string | null = null
    try { previous = window.sessionStorage.getItem(pointerKey(normalizedThreadId)) } catch { /* Recovery picker remains available. */ }
    // Only follow pointers inside this profile/thread namespace. Empty payloads
    // are tombstones, so clearing a draft does not resurrect legacy content.
    const raw = memory().get(owned) ?? window.localStorage.getItem(owned)
      ?? (previous?.startsWith(prefix(normalizedThreadId)) ? window.localStorage.getItem(previous) : null)
      ?? (!hasV2Draft(normalizedThreadId) ? legacyKeys(normalizedThreadId).map(key => window.localStorage.getItem(key)).find(value => value !== null) : null)
    if (!raw) return null
    return parseDraft(raw)
  } catch {
    return null
  }
}

function parseDraft(raw: string): ComposerDraftPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ComposerDraftPayload> | string
    if (!parsed || (typeof parsed !== 'object' && typeof parsed !== 'string')) return null
    if (typeof parsed === 'string') {
      return {
        text: parsed,
        imageUrls: [],
        fileAttachments: [],
        skills: [],
      }
    }
    return {
      ...(Array.isArray(parsed.apps) && parsed.apps.length ? {apps:parsed.apps.slice(0,20).filter(app=>app&&typeof app.id==='string'&&app.id.length<=512&&!/[\s\x00-\x1f]/.test(app.id)&&typeof app.name==='string').map(app=>({id:app.id,name:app.name.slice(0,300)}))} : {}),
      text: typeof parsed.text === 'string' ? parsed.text : '',
      imageUrls: Array.isArray(parsed.imageUrls)
        ? parsed.imageUrls.filter((url): url is string => typeof url === 'string')
        : [],
      fileAttachments: Array.isArray(parsed.fileAttachments)
        ? parsed.fileAttachments.filter((attachment): attachment is FileAttachment => (
          Boolean(attachment)
          && typeof attachment.label === 'string'
          && typeof attachment.path === 'string'
          && typeof attachment.fsPath === 'string'
        ))
        : [],
      skills: Array.isArray(parsed.skills)
        ? parsed.skills.filter((skill): skill is { name: string; path: string } => (
          Boolean(skill)
          && typeof skill.name === 'string'
          && typeof skill.path === 'string'
        ))
        : [],
    }
  } catch {
    return null
  }
}

export function persistDraftForThread(threadId: string, payload: ComposerDraftPayload): void {
  if (typeof window === 'undefined') return
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return
  const key = getDraftStorageKey(normalizedThreadId)
  const raw = JSON.stringify(payload)
  try {
    window.localStorage.setItem(key, raw)
    try { window.sessionStorage.setItem(pointerKey(normalizedThreadId), key) } catch { /* Manual recovery still works. */ }
    memory().delete(key)
    draftStorageError = ''
  } catch {
    memory().set(key, raw)
    draftStorageError = 'Draft is available in this tab only. Browser storage could not save it; copy it before closing.'
  }
}

/** Recovery is an explicit copy. Never claim or delete another document's data. */
export function recoverableDrafts(threadId: string): Array<{ key: string; draft: ComposerDraftPayload }> {
  const result: Array<{ key: string; draft: ComposerDraftPayload }> = []
  if (!threadId.trim() || typeof window === 'undefined') return result
  try {
    const storage = window.localStorage
    const keys = new Set(legacyKeys(threadId))
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith(prefix(threadId)) && key !== getDraftStorageKey(threadId)) keys.add(key)
    }
    for (const key of keys) {
      const raw = storage.getItem(key)
      const draft = raw ? parseDraft(raw) : null
      if (draft && (draft.text.trim() || draft.imageUrls.length || draft.fileAttachments.length || draft.skills.length || draft.apps?.length)) result.push({ key, draft })
    }
  } catch { /* Storage restrictions cannot destroy the live draft. */ }
  return result
}

function hasV2Draft(threadId: string): boolean {
  for (let i = 0; i < window.localStorage.length; i++) if (window.localStorage.key(i)?.startsWith(prefix(threadId))) return true
  return false
}

export function archiveDraftBeforeRecovery(threadId: string, payload: ComposerDraftPayload): boolean {
  try {
    window.localStorage.setItem(`${prefix(threadId)}${browserTabIdentity().tabId}.archive-${clientMessageId()}`, JSON.stringify(payload))
    return true
  } catch { return false }
}

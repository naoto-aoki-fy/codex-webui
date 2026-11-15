import { profileStorageKey } from './browserConnectionProfile'

export type FileAttachment = { label: string; path: string; fsPath: string }

export type ComposerDraftPayload = {
  apps?: import('../api/apps').AppReference[]
  text: string
  imageUrls: string[]
  fileAttachments: FileAttachment[]
  skills: Array<{ name: string; path: string }>
}

const DRAFT_STORAGE_PREFIX = 'codex-web-local.thread-draft.v1.'

function getDraftStorageKey(threadId: string): string {
  return profileStorageKey(`${DRAFT_STORAGE_PREFIX}${threadId}`)
}

export function loadPersistedDraftForThread(threadId: string): ComposerDraftPayload | null {
  if (typeof window === 'undefined') return null
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return null
  try {
    const raw = window.localStorage.getItem(getDraftStorageKey(normalizedThreadId))
      || window.localStorage.getItem(profileStorageKey(`codex-web-local.thread-fork-recovery.v1.${normalizedThreadId}`))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ComposerDraftPayload> | string
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
  try {
    const hasContent = !!payload.apps?.length || payload.text.trim().length > 0
      || payload.imageUrls.length > 0
      || payload.fileAttachments.length > 0
      || payload.skills.length > 0
    if (hasContent) {
      window.localStorage.setItem(getDraftStorageKey(normalizedThreadId), JSON.stringify(payload))
      return
    }
    window.localStorage.removeItem(getDraftStorageKey(normalizedThreadId))
  } catch {
    // Ignore localStorage failures (quota/private mode).
  }
}


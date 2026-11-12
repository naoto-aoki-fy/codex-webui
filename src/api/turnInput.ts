import { resolveRelativePath, toRenderableImageUrl } from '../utils/conversationLinks.js'
import { buildTextWithAttachments } from '../utils/attachmentPrompt.js'

export type FileAttachmentParam = { label: string; path: string; fsPath: string }

function extractLocalImagePathFromUrl(value: string): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value, 'http://localhost')
    if (parsed.pathname !== '/codex-local-image') return null
    const path = parsed.searchParams.get('path')?.trim() ?? ''
    return path.length > 0 ? (path.startsWith('file://') ? resolveRelativePath(path, '') : path) : null
  } catch {
    return null
  }
}

function fileNameFromPath(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  return segments.at(-1) ?? normalized
}

export function buildTurnInput(
  text: string,
  imageUrls: string[] = [],
  skills?: Array<{ name: string; path: string }>,
  fileAttachments: FileAttachmentParam[] = [],
): { input: Array<Record<string, unknown>>; attachments: FileAttachmentParam[] } {
  const localImageAttachments: FileAttachmentParam[] = []
  for (const imageUrl of imageUrls) {
    const localImagePath = extractLocalImagePathFromUrl(toRenderableImageUrl(imageUrl))
    if (!localImagePath) continue
    localImageAttachments.push({
      label: fileNameFromPath(localImagePath),
      path: localImagePath,
      fsPath: localImagePath,
    })
  }
  const allFileAttachments = [...fileAttachments, ...localImageAttachments]
  const dedupedFileAttachments = allFileAttachments.filter((entry, index) =>
    allFileAttachments.findIndex((candidate) => candidate.fsPath === entry.fsPath) === index)
  const finalText = buildTextWithAttachments(text, dedupedFileAttachments)
  const input: Array<Record<string, unknown>> = [{ type: 'text', text: finalText }]
  for (const imageUrl of imageUrls) {
    const normalizedUrl = toRenderableImageUrl(imageUrl)
    if (!normalizedUrl) continue
    const localImagePath = extractLocalImagePathFromUrl(normalizedUrl)
    if (localImagePath) {
      input.push({
        type: 'localImage',
        path: localImagePath,
      })
      continue
    }
    input.push({
      type: 'image',
      url: normalizedUrl,
      image_url: normalizedUrl,
    })
  }
  if (skills) {
    for (const skill of skills) {
      input.push({ type: 'skill', name: skill.name, path: skill.path })
    }
  }
  const attachments = dedupedFileAttachments.map((f) => ({ label: f.label, path: f.path, fsPath: f.fsPath }))
  return { input, attachments }
}

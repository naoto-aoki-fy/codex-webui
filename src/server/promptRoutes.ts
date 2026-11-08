import type { IncomingMessage, ServerResponse } from 'node:http'
import { listComposerPrompts, createComposerPromptFile, removeComposerPromptFile } from './composerPromptFiles.js'

type PromptRouteContext = {
  readJsonBody: (req: IncomingMessage) => Promise<unknown>
  getPromptsDirectory: () => string
  getErrorMessage: (error: unknown, fallback: string) => string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function setJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

export async function handlePromptRoutes(req: IncomingMessage, res: ServerResponse, url: URL, context: PromptRouteContext): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/codex-api/prompts') {
    setJson(res, 200, { data: await listComposerPrompts(context.getPromptsDirectory()) })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/codex-api/prompts') {
    const payload = asRecord(await context.readJsonBody(req))
    const name = typeof payload?.name === 'string' ? payload.name.trim() : ''
    const content = typeof payload?.content === 'string' ? payload.content : ''
    if (!name || !content.trim()) {
      setJson(res, 400, { error: 'Prompt name and content are required' })
      return true
    }
    try {
      const prompt = await createComposerPromptFile(context.getPromptsDirectory(), name, content)
      setJson(res, 200, { data: prompt })
    } catch (error) {
      setJson(res, 500, { error: context.getErrorMessage(error, 'Failed to create prompt') })
    }
    return true
  }

  if (req.method === 'DELETE' && url.pathname === '/codex-api/prompts') {
    const promptPath = url.searchParams.get('path')?.trim() ?? ''
    if (!promptPath) {
      setJson(res, 400, { error: 'Missing path' })
      return true
    }
    try {
      const removed = await removeComposerPromptFile(context.getPromptsDirectory(), promptPath)
      setJson(res, 200, { data: { removed } })
    } catch (error) {
      setJson(res, 400, { error: context.getErrorMessage(error, 'Failed to remove prompt') })
    }
    return true
  }

  return false
}

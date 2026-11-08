import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, expect, it, vi } from 'vitest'
import { handlePromptRoutes } from './promptRoutes.js'
import { listComposerPrompts, createComposerPromptFile, removeComposerPromptFile } from './composerPromptFiles.js'

vi.mock('./composerPromptFiles.js', () => ({
  listComposerPrompts: vi.fn(), createComposerPromptFile: vi.fn(), removeComposerPromptFile: vi.fn(),
}))
const context = {
  readJsonBody: vi.fn<() => Promise<unknown>>(),
  getPromptsDirectory: vi.fn(() => '/home/test/prompts'),
  getErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
}
beforeEach(() => {
  vi.resetAllMocks()
  context.getPromptsDirectory.mockReturnValue('/home/test/prompts')
  context.getErrorMessage.mockImplementation((_error, fallback) => fallback)
})

function route(method: string, path = '/codex-api/prompts') {
  const req = { method } as IncomingMessage
  const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() }
  const result = handlePromptRoutes(req, res as unknown as ServerResponse, new URL(path, 'http://localhost'), context)
  return { result, res }
}
async function response(method: string, path?: string) {
  const { result, res } = route(method, path)
  expect(await result).toBe(true)
  expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8')
  expect(res.end).toHaveBeenCalledTimes(1)
  return { status: res.statusCode, body: JSON.parse(res.end.mock.calls[0]![0]) }
}

it.each([['PUT', '/codex-api/prompts'], ['GET', '/codex-api/prompts/'], ['POST', '/other']])('falls through for %s %s without side effects', async (method, path) => {
  const { result, res } = route(method, path)
  expect(await result).toBe(false)
  expect(res.end).not.toHaveBeenCalled()
  expect(context.readJsonBody).not.toHaveBeenCalled()
  expect(context.getPromptsDirectory).not.toHaveBeenCalled()
  expect(listComposerPrompts).not.toHaveBeenCalled()
  expect(createComposerPromptFile).not.toHaveBeenCalled()
  expect(removeComposerPromptFile).not.toHaveBeenCalled()
})
it('lists the existing records with one storage call', async () => {
  const data = [{ name: 'demo', path: '/home/test/prompts/demo.md', content: 'text\n', description: 'text' }]
  vi.mocked(listComposerPrompts).mockResolvedValueOnce(data)
  expect(await response('GET')).toEqual({ status: 200, body: { data } })
  expect(listComposerPrompts).toHaveBeenCalledExactlyOnceWith('/home/test/prompts')
  expect(context.readJsonBody).not.toHaveBeenCalled()
})
it('trims the name but leaves content normalization to storage', async () => {
  context.readJsonBody.mockResolvedValueOnce({ name: ' demo ', content: ' text ' })
  const data = { name: 'demo', path: '/home/test/prompts/demo.md', content: 'text\n', description: 'text' }
  vi.mocked(createComposerPromptFile).mockResolvedValueOnce(data)
  expect(await response('POST')).toEqual({ status: 200, body: { data } })
  expect(createComposerPromptFile).toHaveBeenCalledExactlyOnceWith('/home/test/prompts', 'demo', ' text ')
  expect(context.readJsonBody).toHaveBeenCalledTimes(1)
})
it.each([null, [], {}, { name: 1, content: 'text' }, { name: ' ', content: 'text' }, { name: 'demo', content: 1 }, { name: 'demo', content: ' ' }])('rejects invalid creation input %j before accessing storage', async payload => {
  context.readJsonBody.mockResolvedValueOnce(payload)
  expect(await response('POST')).toEqual({ status: 400, body: { error: 'Prompt name and content are required' } })
  expect(createComposerPromptFile).not.toHaveBeenCalled()
  expect(context.getPromptsDirectory).not.toHaveBeenCalled()
})
it.each([true, false])('returns the storage deletion result %s', async removed => {
  vi.mocked(removeComposerPromptFile).mockResolvedValueOnce(removed)
  expect(await response('DELETE', '/codex-api/prompts?path=%20%2Fhome%2Ftest%2Fprompts%2Fdemo.md%20')).toEqual({ status: 200, body: { data: { removed } } })
  expect(removeComposerPromptFile).toHaveBeenCalledExactlyOnceWith('/home/test/prompts', '/home/test/prompts/demo.md')
  expect(context.readJsonBody).not.toHaveBeenCalled()
})
it.each(['', '?path=%20'])('rejects a missing deletion path %s', async query => {
  expect(await response('DELETE', `/codex-api/prompts${query}`)).toEqual({ status: 400, body: { error: 'Missing path' } })
  expect(removeComposerPromptFile).not.toHaveBeenCalled()
  expect(context.getPromptsDirectory).not.toHaveBeenCalled()
})
it.each(['create', 'delete'])('preserves the %s storage error response and shared formatter', async operation => {
  const error = new Error('storage failure')
  context.getErrorMessage.mockReturnValueOnce(error.message)
  context.readJsonBody.mockResolvedValueOnce({ name: 'demo', content: 'text' })
  if (operation === 'create') vi.mocked(createComposerPromptFile).mockRejectedValueOnce(error)
  else vi.mocked(removeComposerPromptFile).mockRejectedValueOnce(error)
  expect(await response(operation === 'create' ? 'POST' : 'DELETE', '/codex-api/prompts?path=demo.md')).toEqual({ status: operation === 'create' ? 500 : 400, body: { error: error.message } })
  expect(context.getErrorMessage).toHaveBeenCalledWith(error, operation === 'create' ? 'Failed to create prompt' : 'Failed to remove prompt')
})
it('lets listing failures reach the bridge error handler without writing a response', async () => {
  const error = new Error('list failure')
  vi.mocked(listComposerPrompts).mockRejectedValueOnce(error)
  const { result, res } = route('GET')
  await expect(result).rejects.toBe(error)
  expect(res.end).not.toHaveBeenCalled()
})
it('lets malformed JSON reach the bridge error handler before accessing storage', async () => {
  const error = new SyntaxError('invalid JSON')
  context.readJsonBody.mockRejectedValueOnce(error)
  const { result, res } = route('POST')
  await expect(result).rejects.toBe(error)
  expect(res.end).not.toHaveBeenCalled()
  expect(context.getPromptsDirectory).not.toHaveBeenCalled()
  expect(createComposerPromptFile).not.toHaveBeenCalled()
})

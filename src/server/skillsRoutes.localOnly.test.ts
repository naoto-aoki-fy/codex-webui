import { mkdtemp, mkdir, writeFile, readFile, lstat, readlink, symlink, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { handleSkillsRoutes } from './skillsRoutes'
import { createCodexBridgeMiddleware } from './codexAppServerBridge'

let home: string
const spawn = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', async (original) => ({ ...await original<object>(), spawn }))
let originalShared: unknown
const shared = globalThis as typeof globalThis & { __codexRemoteSharedBridge__?: unknown }
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'skills-local-only-'))
  vi.stubEnv('CODEX_HOME', home)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request') }))
  originalShared = shared.__codexRemoteSharedBridge__
  spawn.mockReset()
  spawn.mockImplementation(() => { throw new Error('Unexpected subprocess') })
})
afterEach(async () => {
  shared.__codexRemoteSharedBridge__ = originalShared
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
})

it.each(['file', 'symlink', 'missing'].flatMap((kind) => [false, true].map((authenticated) => ({ kind, authenticated }))))('startup preserves $kind AGENTS with authenticated=$authenticated and does not sync', async ({ kind, authenticated }) => {
  await mkdir(join(home, 'skills'))
  await writeFile(join(home, 'skills', 'AGENTS.md'), 'skills instructions')
  const agents = join(home, 'AGENTS.md')
  if (kind === 'file') await writeFile(agents, 'user instructions')
  if (kind === 'symlink') await symlink('skills/AGENTS.md', agents)
  const syncConfig = JSON.stringify(authenticated ? { githubToken: 'test-only', repoOwner: 'test', repoName: 'skills' } : {})
  await writeFile(join(home, 'skills-sync.json'), syncConfig)
  const rpc = vi.fn()
  shared.__codexRemoteSharedBridge__ = {
    version: 'external-websocket-files-v2', appServer: { rpc },
    methodCatalog: {},
  }
  createCodexBridgeMiddleware()
  createCodexBridgeMiddleware()
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(spawn).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  expect(rpc).not.toHaveBeenCalled()
  expect(await readFile(join(home, 'skills-sync.json'), 'utf8')).toBe(syncConfig)
  expect(await readFile(join(home, 'skills', 'AGENTS.md'), 'utf8')).toBe('skills instructions')
  expect(await readdir(join(home, 'skills'))).toEqual(['AGENTS.md'])
  if (kind === 'missing') await expect(lstat(agents)).rejects.toMatchObject({ code: 'ENOENT' })
  if (kind === 'file') {
    expect((await lstat(agents)).isFile()).toBe(true)
    expect(await readFile(agents, 'utf8')).toBe('user instructions')
  }
  if (kind === 'symlink') expect(await readlink(agents)).toBe('skills/AGENTS.md')
})

it.each([['GET', 'search?q=sample'], ['POST', 'install'], ['POST', 'uninstall']])('retires %s %s without touching local data or executing commands', async (method, suffix) => {
  const path = join(home, 'skills', 'sample', 'SKILL.md')
  await mkdir(join(home, 'skills', 'sample'), { recursive: true })
  await writeFile(path, 'Keep local instructions')
  const rpc = vi.fn()
  const readJsonBody = vi.fn()
  const res = { setHeader: vi.fn(), end: vi.fn() } as unknown as ServerResponse
  expect(await handleSkillsRoutes({ method } as IncomingMessage, res,
    new URL(`http://localhost/codex-api/skills-hub/${suffix}`),
    { appServer: { rpc }, readJsonBody })).toBe(false)
  expect(res.end).not.toHaveBeenCalled()
  expect(readJsonBody).not.toHaveBeenCalled()
  expect(rpc).not.toHaveBeenCalled()
  expect(spawn).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  expect(await readFile(path, 'utf8')).toBe('Keep local instructions')
})

it('reads installed remote SKILL.md despite different local content', async () => {
  const path = join(home, 'skills', 'sample', 'SKILL.md')
  const content = '---\nname: sample\ndescription: Local description\n---\nLocal instructions'
  await mkdir(join(home, 'skills', 'sample'), { recursive: true })
  await writeFile(path, content)
  const end = vi.fn()
  const res = { setHeader: vi.fn(), end } as unknown as ServerResponse
  expect(await handleSkillsRoutes({ method: 'GET' } as IncomingMessage, res,
    new URL('http://localhost/codex-api/skills-hub/readme?name=sample'),
    { appServer: { rpc: vi.fn(async method => method === 'skills/list' ? { data: [{ skills: [{ name: 'sample', path, description: 'Local description' }] }] } : { dataBase64: Buffer.from(content).toString('base64') }) }, readJsonBody: async () => ({}) })).toBe(true)
  expect(res.statusCode).toBe(200)
  expect(JSON.parse(end.mock.calls[0]![0])).toMatchObject({ content, description: 'Local description', source: 'local' })
  expect(fetch).not.toHaveBeenCalled()
  expect(spawn).not.toHaveBeenCalled()
})

it('returns only installed skill fields consumed by the UI', async () => {
  const path = join(home, 'skills', 'sample', 'SKILL.md')
  await mkdir(join(home, 'skills', 'sample'), { recursive: true })
  await writeFile(path, '---\ndescription: Local description\n---\nInstructions')
  const end = vi.fn()
  const res = { setHeader: vi.fn(), end } as unknown as ServerResponse
  await handleSkillsRoutes({ method: 'GET' } as IncomingMessage, res,
    new URL('http://localhost/codex-api/skills-hub'),
    { appServer: { rpc: async method => method === 'skills/list' ? { data: [{ skills: [{ name: 'sample', path, description: 'Local description' }] }] } : { dataBase64: Buffer.from('---\ndescription: Local description\n---\nInstructions').toString('base64') } }, readJsonBody: async () => ({}) })
  expect(res.statusCode).toBe(200)
  expect(JSON.parse(end.mock.calls[0]![0])).toEqual({ installed: [{
    name: 'sample', description: 'Local description', path, enabled: true,
  }] })
})

it.each(['/remote', 'C:/remote', 'C:\\remote', '//server/share', '\\\\server\\share'])('groups nested remote skills under %s without grouping siblings', async root => {
  const { projectPath } = await import('./appServerFileSystem')
  const rules = projectPath(root)
  const paths = [rules.join(root, 'skills', 'sample', 'SKILL.md'), rules.join(root, 'skills', 'sample', 'nested', 'SKILL.md'), rules.join(root, 'skills', 'sample-other', 'SKILL.md')]
  const end = vi.fn()
  const res = { setHeader: vi.fn(), end } as unknown as ServerResponse
  await handleSkillsRoutes({ method: 'GET' } as IncomingMessage, res, new URL('http://localhost/codex-api/skills-hub'), {
    appServer: { rpc: async () => ({ data: [{ skills: paths.map((path, i) => ({ path, name: ['sample', 'nested', 'sample-other'][i] })) }] }) },
    readJsonBody: async () => ({}),
  })
  expect(JSON.parse(end.mock.calls[0]![0]).installed.map((entry: { path: string }) => entry.path)).toEqual([paths[0], paths[2]])
})

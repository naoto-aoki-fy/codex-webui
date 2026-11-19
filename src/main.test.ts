import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

const source = readFileSync(new URL('./main.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)
let script = source
for (const node of [...ast.statements].reverse()) {
  if (ts.isImportDeclaration(node)) script = script.slice(0, node.getFullStart()) + script.slice(node.end)
}
const code = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

function start(fetch: typeof globalThis.fetch) {
  const setProfile = vi.fn()
  const root = { textContent: '' }
  const document = { querySelector: vi.fn(() => root) }
  const mount = vi.fn()
  const use = vi.fn(() => ({ mount }))
  new Function('createApp', 'App', 'router', 'fetch', 'document', 'console', 'setInitialConnectionProfile', code)(
    () => ({ use }), {}, {}, fetch, document, { log: vi.fn() }, setProfile,
  )
  return { mount, setProfile, root }
}

it('mounts only after resolving the backend App Server ID', async () => {
  const fetch = vi.fn(async () => Response.json({ connectionProfile: 'machine-a' }))
  const { mount, setProfile } = start(fetch)
  expect(mount).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(mount).toHaveBeenCalledExactlyOnceWith('#app'))
  expect(setProfile).toHaveBeenCalledExactlyOnceWith('machine-a')
  expect(setProfile.mock.invocationCallOrder[0]!).toBeLessThan(mount.mock.invocationCallOrder[0]!)
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/codex-api/connection-profile')
})

it('shows a startup error instead of mounting with an unknown profile', async () => {
  const { mount, setProfile, root } = start(vi.fn(async () => Response.json({})))
  await vi.waitFor(() => expect(root.textContent).toContain('Could not load the App Server ID'))
  expect(mount).not.toHaveBeenCalled()
  expect(setProfile).not.toHaveBeenCalled()
})

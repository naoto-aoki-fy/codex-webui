import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'
import * as vue from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import * as gateway from '../../api/codexGateway'
import type { ThreadComposerExposed } from './ThreadComposer.vue'

// Compile and mount the complete SFC (setup + real template) into Vue's host
// renderer. Dispatch the rendered form event, rather than extracting handlers.
const { parse, compileScript } = createRequire(import.meta.url)('vue/compiler-sfc') as typeof import('vue/compiler-sfc')
const filename = resolve('src/components/content/ThreadComposer.vue')
const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
const script = compileScript(descriptor, { id: 'composer-test', inlineTemplate: true })
const code = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const imports: Record<string, unknown> = {}
for (const node of ts.createSourceFile('composer.ts', script.content, ts.ScriptTarget.Latest, true).statements) {
  if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) continue
  const path = (node.moduleSpecifier as ts.StringLiteral).text
  if (path === 'vue' || path.endsWith('.vue') || path.includes('useMobile') || path.includes('useUiLanguage') || path.includes('codexGateway')) continue
  imports[path] = await import(/* @vite-ignore */ resolve('src/components/content', path))
}
type Node = { tag: string; props: Record<string, any>; children: Node[]; parent?: Node; text?: string }
const node = (tag: string): Node => ({ tag, props: {}, children: [], focus() {}, blur() {}, addEventListener() {}, removeEventListener() {}, getRootNode: () => ({ activeElement: null }), tagName: tag.toUpperCase(), style: {}, scrollHeight: 30, clientHeight: 30 } as Node)
const renderer = vue.createRenderer<Node, Node>({
  createElement: tag => node(tag), createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
  setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text },
  parentNode: n => n.parent!, nextSibling: () => null,
  insert(n, parent, anchor) { n.parent = parent; const i = anchor ? parent.children.indexOf(anchor) : -1; if (i < 0) parent.children.push(n); else parent.children.splice(i, 0, n) },
  remove(n) { if (n.parent) n.parent.children = n.parent.children.filter(child => child !== n) },
  patchProp: (n, key, _old, value) => { n.props[key] = value },
})
const cleanup: Array<() => void> = []
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.unstubAllGlobals() })
function mount() {
  const storage = new Map<string, string>()
  vi.stubGlobal('window', { localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) }, addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('Document', class {})
  vi.stubGlobal('ShadowRoot', class {})
  vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {} })
  const exports = { default: undefined as any }
  new Function('exports', 'require', code)(exports, (path: string) => {
    if (path === 'vue') return vue
    if (path.endsWith('.vue')) return { default: { render: () => null } }
    if (path.includes('useMobile')) return { useMobile: () => ({ isMobile: vue.ref(false) }) }
    if (path.includes('useUiLanguage')) return { useUiLanguage: () => ({ t: (s: string) => s }) }
    if (path.includes('codexGateway')) return gateway
    return imports[path]
  })
  const submitted = vi.fn()
  const root = node('root')
  const app = renderer.createApp(exports.default, { activeThreadId: 'child', models: [], selectedModel: '', selectedReasoningEffort: '', selectedSpeedMode: 'standard', collaborationModes: [], selectedCollaborationMode: 'default', onSubmit: submitted })
  const exposed = app.mount(root) as unknown as ThreadComposerExposed
  cleanup.push(() => app.unmount())
  function find(n: Node, tag: string): Node | undefined { return n.tag === tag ? n : n.children.map(child => find(child, tag)).find(Boolean) }
  return { storage, exposed, submitted, submit: () => find(root, 'form')!.props.onSubmit({ preventDefault() {} }) }
}
const payload = { text: 'follow-up', imageUrls: ['data:image/png;base64,abc'], fileAttachments: [{ label: 'file', path: '/file', fsPath: '/file' }], skills: [{ name: 'skill', path: '/skill' }] }
it('preserves text, images, files, skills and persisted draft when the app rejects a rendered submission', async () => {
  const c = mount()
  c.exposed.hydrateDraft(payload)
  await vue.nextTick()
  c.submit()
  expect(c.exposed.hasUnsavedDraft()).toBe(true)
  expect(JSON.parse(c.storage.get('codex-web-local.thread-draft.v1.child')!)).toEqual(payload)
  expect(c.submitted).toHaveBeenCalledTimes(1)
  expect(c.submitted.mock.calls[0]![0]).toEqual(payload)
  c.submitted.mock.calls[0]![1](false)
  await vue.nextTick()
  expect(c.exposed.hasUnsavedDraft()).toBe(true)
  expect(JSON.parse(c.storage.get('codex-web-local.thread-draft.v1.child')!)).toEqual(payload)
  c.submit()
  c.submitted.mock.calls[1]![1](true)
  await vue.nextTick()
  expect(c.exposed.hasUnsavedDraft()).toBe(false)
  expect(c.storage.has('codex-web-local.thread-draft.v1.child')).toBe(false)
})
it('does not clear newer edits when an earlier submission is accepted', async () => {
  const c = mount()
  c.exposed.hydrateDraft(payload)
  await vue.nextTick()
  c.submit()
  c.exposed.hydrateDraft({ ...payload, text: 'new edit' })
  c.submitted.mock.calls[0]![1](true)
  await vue.nextTick()
  expect(JSON.parse(c.storage.get('codex-web-local.thread-draft.v1.child')!).text).toBe('new edit')
})

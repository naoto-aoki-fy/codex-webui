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
  if (path === 'vue' || path.endsWith('.vue') || path.includes('useMobile') || path.includes('codexGateway')) continue
  imports[path] = await import(/* @vite-ignore */ resolve('src/components/content', path))
}
type Node = { tag: string; props: Record<string, any>; children: Node[]; parent?: Node; text?: string }
const node = (tag: string): Node => ({ tag, props: {}, children: [], focus() {}, blur() {}, addEventListener() {}, removeEventListener() {}, getRootNode: () => ({ activeElement: null }), tagName: tag.toUpperCase(), style: {}, scrollHeight: 30, clientHeight: 30 } as Node)
let teleportTarget = node('body')
const renderer = vue.createRenderer<Node, Node>({
  querySelector: selector => selector === 'body' ? teleportTarget : null,
  createElement: tag => node(tag), createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
  setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text },
  parentNode: n => n.parent!, nextSibling: () => null,
  insert(n, parent, anchor) { n.parent = parent; const i = anchor ? parent.children.indexOf(anchor) : -1; if (i < 0) parent.children.push(n); else parent.children.splice(i, 0, n) },
  remove(n) { if (n.parent) n.parent.children = n.parent.children.filter(child => child !== n) },
  patchProp: (n, key, _old, value) => { n.props[key] = value },
})
const cleanup: Array<() => void> = []
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.unstubAllGlobals() })
function mount(initial: Record<string, unknown> = {}) {
  const storage = new Map<string, string>()
  vi.stubGlobal('window', { localStorage: { get length() { return storage.size }, key: (i: number) => [...storage.keys()][i] ?? null, getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) }, addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('Document', class {})
  vi.stubGlobal('ShadowRoot', class {})
  vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {} })
  const exports = { default: undefined as any }
  new Function('exports', 'require', code)(exports, (path: string) => {
    if (path === 'vue') return vue
    if (path.endsWith('ComposerSearchDropdown.vue')) return { default: vue.defineComponent({ props: ['options', 'selectedValues', 'placeholder'], emits: ['toggle'], setup: (props, { emit }) => () => vue.h('skill-dropdown', { ...props, onToggle: (path: string, checked: boolean) => emit('toggle', path, checked) }) }) }
    if (path.endsWith('ComposerDropdown.vue')) return { default: vue.defineComponent({ props: ['options', 'modelValue', 'placeholder'], emits: ['update:modelValue'], setup: (props, { emit }) => () => vue.h('dropdown', { options: props.options, modelValue: props.modelValue, placeholder: props.placeholder, 'onUpdate:modelValue': (value: string) => emit('update:modelValue', value) }) }) }
    if (path.endsWith('.vue')) return { default: { render: () => null } }
    if (path.includes('useMobile')) return { useMobile: () => ({ isMobile: vue.ref(false) }) }
    if (path.includes('codexGateway')) return gateway
    return imports[path]
  })
  const submitted = vi.fn()
  const root = node('root')
  const body = teleportTarget = node('body')
  const selectedModels = vi.fn()
  const props = vue.reactive<Record<string, any>>({ activeThreadId: 'child', models: [], selectedModel: '', selectedReasoningEffort: '', selectedSpeedMode: 'standard', collaborationModes: [], selectedCollaborationMode: 'default', onSubmit: submitted,
    'onUpdate:selectedModel': (value: string) => { selectedModels(value); props.selectedModel = value }, ...initial })
  const component = vue.ref<ThreadComposerExposed>()
  const app = renderer.createApp({ setup: () => () => vue.h(exports.default, { ...props, ref: component }) })
  app.mount(root)
  const exposed = component.value!

  cleanup.push(() => app.unmount())
  function find(n: Node, tag: string): Node | undefined { return n.tag === tag ? n : n.children.map(child => find(child, tag)).find(Boolean) }
  function findModel(n: Node): Node | undefined { return n.tag === 'dropdown' && n.props.placeholder === 'Model' ? n : n.children.map(findModel).find(Boolean) }
  function all(n: Node): Node[] { return [n, ...n.children.flatMap(all)] }
  return { storage, exposed, submitted, props, selectedModels, nodes: () => [...all(root), ...all(body)], model: () => findModel(root)!, submit: () => find(root, 'form')!.props.onSubmit({ preventDefault() {} }) }
}
const payload = { text: 'follow-up', imageUrls: ['data:image/png;base64,abc'], fileAttachments: [{ label: 'file', path: '/file', fsPath: '/file' }], skills: [{ name: 'skill', path: '/skill' }] }
it('hides the skills selector by default and toggles it without losing selected chips or submission skills', async () => {
  const skill = { name: 'review', description: 'Review changes', path: '/skills/review' }
  const c = mount({ skills: [skill], reasoningEffortOptions: [{ value: 'high', label: 'High' }] })
  const dropdown = () => c.nodes().find(n => n.tag === 'skill-dropdown')
  const button = (label: string) => c.nodes().find(n => n.props['aria-label'] === label)!
  const toggle = async () => {
    button('Add attachments and settings').props.onClick()
    await vue.nextTick()
    const setting = button('Skills')
    expect(setting.props['aria-checked']).toBe(!!dropdown())
    setting.props.onClick()
    await vue.nextTick()
    expect(c.nodes().some(n => n.props.class === 'thread-composer-attach-menu')).toBe(false)
  }
  expect(dropdown()).toBeUndefined()
  expect(c.model()).toBeDefined()
  expect(c.nodes().some(n => n.tag === 'dropdown' && n.props.placeholder === 'Thinking')).toBe(true)
  await toggle()
  expect(dropdown()!.props.options).toEqual([expect.objectContaining({ value: skill.path, label: skill.name })])
  dropdown()!.props.onToggle(skill.path, true)
  await vue.nextTick()
  await toggle()
  expect(dropdown()).toBeUndefined()
  expect(button('Remove skill review')).toBeDefined()
  c.exposed.appendTextToDraft('Please review')
  await vue.nextTick()
  c.submit()
  expect(c.submitted.mock.calls[0]![0].skills).toEqual([{ name: skill.name, path: skill.path }])
  c.submitted.mock.calls[0]![1](false)
  await toggle()
  expect(dropdown()!.props.selectedValues).toEqual([skill.path])
  dropdown()!.props.onToggle(skill.path, false)
  await vue.nextTick()
  expect(button('Remove skill review')).toBeUndefined()
  dropdown()!.props.onToggle(skill.path, true)
  await vue.nextTick()
  await toggle()
  button('Remove skill review').props.onClick()
  await vue.nextTick()
  expect(button('Remove skill review')).toBeUndefined()
  expect(dropdown()).toBeUndefined()
})

it('keeps slash skill selection available while the selector is hidden', async () => {
  const c = mount({ skills: [{ name: 'review', description: 'Review changes', path: '/skills/review' }] })
  c.exposed.appendTextToDraft('/review')
  await vue.nextTick()
  const input = c.nodes().find(n => n.tag === 'textarea')!
  input.props.onInput()
  await vue.nextTick()
  const suggestion = c.nodes().find(n => n.props.class?.includes('thread-composer-file-mention-row'))!
  suggestion.props.onMousedown({ preventDefault() {} })
  await vue.nextTick()
  expect(c.nodes().some(n => n.props['aria-label'] === 'Remove skill review')).toBe(true)
  expect(c.nodes().some(n => n.tag === 'skill-dropdown')).toBe(false)
  c.exposed.appendTextToDraft('Please review')
  await vue.nextTick()
  c.submit()
  expect(c.submitted.mock.calls[0]![0].skills).toEqual([{ name: 'review', path: '/skills/review' }])
})
it('preserves text, images, files, skills and persisted draft when the app rejects a rendered submission', async () => {
  const c = mount()
  c.exposed.hydrateDraft(payload)
  await vue.nextTick()
  c.submit()
  expect(c.exposed.hasUnsavedDraft()).toBe(true)
  expect(JSON.parse([...c.storage.entries()].find(([key]) => key.startsWith('codex-web-local.thread-draft.v2.child.'))?.[1]!)).toEqual(payload)
  expect(c.submitted).toHaveBeenCalledTimes(1)
  expect(c.submitted.mock.calls[0]![0]).toEqual(payload)
  c.submitted.mock.calls[0]![1](false)
  await vue.nextTick()
  expect(c.exposed.hasUnsavedDraft()).toBe(true)
  expect(JSON.parse([...c.storage.entries()].find(([key]) => key.startsWith('codex-web-local.thread-draft.v2.child.'))?.[1]!)).toEqual(payload)
  c.submit()
  c.submitted.mock.calls[1]![1](true)
  await vue.nextTick()
  expect(c.exposed.hasUnsavedDraft()).toBe(false)
  expect(JSON.parse([...c.storage.entries()].find(([key]) => key.startsWith('codex-web-local.thread-draft.v2.child.'))![1]).text).toBe('')
})
it('does not clear newer edits when an earlier submission is accepted', async () => {
  const c = mount()
  c.exposed.hydrateDraft(payload)
  await vue.nextTick()
  c.submit()
  c.exposed.hydrateDraft({ ...payload, text: 'new edit' })
  c.submitted.mock.calls[0]![1](true)
  await vue.nextTick()
  expect(JSON.parse([...c.storage.entries()].find(([key]) => key.startsWith('codex-web-local.thread-draft.v2.child.'))?.[1]!).text).toBe('new edit')
})

it('reactively filters models by provider and replaces a previous provider selection', async () => {
  const key = (provider: string, model: string) => `provider-model:${JSON.stringify([provider, model])}`
  gateway.reasoningCatalog.value = [
    { id: 'shared', modelProvider: 'P', displayName: 'Source model' },
    { id: 'shared', modelProvider: 'Q', displayName: 'Alternate', priority: 9 },
    { id: 'default', modelProvider: 'Q', displayName: 'Destination model', isDefault: true },
  ]
  try {
    const c = mount({ modelProvider: 'P', selectedModel: key('P', 'shared'), models: [key('P', 'shared'), key('Q', 'shared'), key('Q', 'default')] })
    expect(c.model().props.options).toEqual([{ value: key('P', 'shared'), label: 'Source model' }])
    c.props.modelProvider = 'Q'
    await vue.nextTick()
    expect(c.model().props.options.map((option: any) => option.label)).toEqual(['Alternate', 'Destination model'])
    expect(c.props.selectedModel).toBe(key('Q', 'default'))
    expect(c.model().props.modelValue).toBe(key('Q', 'default'))
    expect(c.selectedModels).toHaveBeenCalledExactlyOnceWith(key('Q', 'default'))
  } finally { gateway.reasoningCatalog.value = [] }
})


it('offers discovered providers only for new threads and selects their default before filtering models', async () => {
  const key = (provider: string, model: string) => `provider-model:${JSON.stringify([provider, model])}`
  gateway.reasoningCatalog.value = [
    { id: 'first', modelProvider: 'cloud', providerDisplayName: 'Cloud display' },
    { id: 'recent', modelProvider: 'local', providerDisplayName: 'Local display' },
    { id: 'default', modelProvider: 'local', isDefault: true },
    { id: 'missing', modelProvider: 'unavailable' },
  ]
  try {
    const c = mount({ activeThreadId: '__new-thread__', selectedModel: key('cloud', 'first'),
      models: [key('local', 'recent'), key('cloud', 'first'), key('local', 'default')] })
    const provider = () => c.nodes().find(n => n.tag === 'dropdown' && n.props.placeholder === 'Model Provider')
    expect(provider()!.props.options).toEqual([
      { value: 'cloud', label: 'Cloud display' }, { value: 'local', label: 'Local display' },
    ])
    expect(c.nodes().indexOf(provider()!)).toBeLessThan(c.nodes().indexOf(c.model()))
    provider()!.props['onUpdate:modelValue']('local')
    await vue.nextTick()
    expect(c.props.selectedModel).toBe(key('local', 'default'))
    expect(provider()!.props.modelValue).toBe('local')
    expect(c.model().props.options.map((o: any) => o.value)).toEqual([key('local', 'recent'), key('local', 'default')])
    provider()!.props['onUpdate:modelValue']('unavailable')
    expect(c.selectedModels).toHaveBeenCalledTimes(1)
    c.props.activeThreadId = 'established'
    await vue.nextTick()
    expect(provider()).toBeUndefined()
  } finally { gateway.reasoningCatalog.value = [] }
})

it('keeps legacy catalogs usable without inventing a provider', () => {
  gateway.reasoningCatalog.value = [{ id: 'legacy' }]
  try {
    const c = mount({ activeThreadId: '__new-thread__', selectedModel: 'legacy', models: ['legacy'] })
    expect(c.nodes().some(n => n.props.placeholder === 'Model Provider')).toBe(false)
    expect(c.model().props.options).toEqual([{ value: 'legacy', label: 'legacy' }])
  } finally { gateway.reasoningCatalog.value = [] }
})

it('renders native Fast availability and updates it on provider/model switching', async () => {
  gateway.reasoningCatalog.value = [
    { id: 'same', modelProvider: 'one', serviceTiers: [{ id: 'fast' }] },
    { id: 'same', modelProvider: 'two', serviceTiers: [] },
    { id: 'unknown', modelProvider: 'two' },
  ]
  const c = mount({ selectedModel: 'provider-model:["one","same"]' })
  c.nodes().find(n => n.props['aria-label'] === 'Add attachments and settings')!.props.onClick()
  await vue.nextTick()
  const fast = () => c.nodes().find(n => n.props['aria-label'] === 'Fast mode disabled')!
  expect(fast().props.disabled).toBe(false)
  c.props.selectedModel = 'provider-model:["two","same"]'
  await vue.nextTick()
  expect(fast().props.disabled).toBe(true)
  expect(c.nodes().some(n => n.text === 'Fast mode is unavailable for this model')).toBe(true)
  c.props.selectedModel = 'provider-model:["two","unknown"]'
  await vue.nextTick()
  expect(fast().props.disabled).toBe(true)
  expect(c.nodes().some(n => n.text === 'Fast mode availability is unknown')).toBe(true)
  expect(c.props.selectedSpeedMode).toBe('standard')
})
it.each(['/prompts', '/presets', '/history', '/help', '/review', '/compact', '/diff', '/processes', '/goal', '/plan', '/goal an objective'])(
  'submits %s as ordinary text with the existing attachments and skills',
  async text => {
    const c = mount({ sendWithEnter: true })
    c.exposed.hydrateDraft({ ...payload, text })
    await vue.nextTick()
    const input = c.nodes().find(n => n.tag === 'textarea')!
    input.props.onInput()
    await vue.nextTick()
    expect(c.nodes().some(n => n.props.class?.includes('thread-composer-file-mention-row'))).toBe(false)
    input.props.onKeydown({ key: 'Enter', preventDefault() {} })
    expect(c.submitted.mock.calls[0]?.[0]).toEqual({ ...payload, text })
  },
)

it('preserves structured App references in drafts and submission and clears them on connection change',async()=>{
 const c=mount({connectionEpoch:0});const apps=[{id:'connector_demo',name:'Demo App'}]
 c.exposed.hydrateDraft({...payload,apps});await vue.nextTick();c.submit()
 expect(c.submitted.mock.calls[0]![0].apps).toEqual(apps)
 expect(JSON.parse([...c.storage.entries()].find(([key]) => key.startsWith('codex-web-local.thread-draft.v2.child.'))?.[1]!).apps).toEqual(apps)
 c.submitted.mock.calls[0]![1](false);c.props.connectionEpoch=1;await vue.nextTick();c.submit()
 expect(c.submitted.mock.calls[1]![0].apps).toBeUndefined()
})
it('selects send modes in the + menu without opening tools or changing submitted snapshots', async () => {
  const c = mount({ queueReady: true, isTurnInProgress: true })
  const choose = async (label: string) => {
    c.nodes().find(n => n.props['aria-label'] === 'Add attachments and settings')!.props.onClick()
    await vue.nextTick()
    const modes = c.nodes().filter(n => n.props.role === 'radio')
    expect(modes.find(n => n.children.some(child => child.text === label))).toBeDefined()
    modes.find(n => n.children.some(child => child.text === label))!.props.onClick()
    await vue.nextTick()
  }
  expect(c.nodes().some(n => n.props['aria-label'] === 'Send mode: Queue mode')).toBe(false)
  await choose('Queue mode')
  expect(c.nodes().some(n => n.props['aria-label'] === 'Send mode: Queue mode')).toBe(true)
  c.exposed.appendTextToDraft('queued while active')
  await vue.nextTick()
  c.submit()
  const first = c.submitted.mock.calls[0]![0]
  expect(first.queue).toBe(true)
  c.submitted.mock.calls[0]![1](true)
  await choose('Immediate mode')
  expect(first.queue).toBe(true)
  c.exposed.appendTextToDraft('steer')
  await vue.nextTick()
  c.submit()
  expect(c.submitted.mock.calls[1]![0].queue).toBeUndefined()
})

it('allows Queue selection before thread creation while sending the initial message normally', async () => {
  const c = mount({ activeThreadId: '__new-thread__' })
  c.nodes().find(n => n.props['aria-label'] === 'Add attachments and settings')!.props.onClick()
  await vue.nextTick()
  c.nodes().filter(n => n.props.role === 'radio')[1]!.props.onClick()
  await vue.nextTick()
  expect(c.nodes().some(n => n.props['aria-label'] === 'Queue prompt')).toBe(false)
  expect(c.nodes().some(n => n.props['aria-label'] === 'Send message')).toBe(true)
  c.exposed.appendTextToDraft('create conversation')
  await vue.nextTick()
  c.submit()
  expect(c.submitted).toHaveBeenCalledOnce()
  expect(c.submitted.mock.calls[0]![0].queue).toBeUndefined()
})

it('collapses empty and populated drafts independently of full-screen editing without losing selections', async () => {
  const c = mount({ models: ['model'], selectedModel: 'model', selectedReasoningEffort: 'high' })
  const button = (label: string) => c.nodes().find(n => n.props['aria-label'] === label)!
  const restore = () => c.nodes().find(n => n.tag === 'button' && n.props['aria-expanded'] === false && n.props['aria-controls'])
  const collapse = async () => { button('Minimize message input').props.onClick(); await vue.nextTick() }
  expect(restore()).toBeUndefined()
  expect(button('Expand composer')).toBeUndefined()
  await collapse()
  expect(restore()).toBeDefined()
  expect(c.exposed.hasUnsavedDraft()).toBe(false)
  restore()!.props.onClick()
  await vue.nextTick()
  const longPayload = { ...payload, text: 'long draft\n'.repeat(20), apps: [{ id: 'connector_demo', name: 'Demo' }] }
  c.exposed.hydrateDraft(longPayload)
  await vue.nextTick()
  const textarea = c.nodes().find(n => n.tag === 'textarea')
  button('Expand composer').props.onClick()
  await vue.nextTick()
  expect(button('Exit full screen composer')).toBeDefined()
  expect(button('Minimize message input')).toBeUndefined()
  button('Exit full screen composer').props.onClick()
  await vue.nextTick()
  await collapse()
  expect(c.nodes().find(n => n.tag === 'textarea')).toBe(textarea)
  expect(JSON.parse([...c.storage.entries()].find(([key]) => key.startsWith('codex-web-local.thread-draft.v2.child.'))?.[1]!)).toEqual(longPayload)
  restore()!.props.onClick()
  await vue.nextTick()
  expect(c.model().props.modelValue).toBe('model')
  expect(c.props.selectedReasoningEffort).toBe('high')
  c.submit()
  expect(c.submitted.mock.calls[0]![0]).toEqual({ ...longPayload, text: longPayload.text.trim() })
})

it('keeps Stop in the collapsed view with a draft and respects pending and disabled states', async () => {
  const interrupt = vi.fn()
  const c = mount({ isTurnInProgress: true, onInterrupt: interrupt })
  c.exposed.hydrateDraft(payload)
  await vue.nextTick()
  c.nodes().find(n => n.props['aria-label'] === 'Minimize message input')!.props.onClick()
  await vue.nextTick()
  const floating = () => c.nodes().find(n => n.props.class === 'thread-composer-floating-actions')!
  const stop = () => floating().children.find(n => n.props.class === 'thread-composer-stop')!
  expect(stop().props.disabled).toBeFalsy()
  expect(interrupt).not.toHaveBeenCalled()
  expect(c.submitted).not.toHaveBeenCalled()
  stop().props.onClick()
  expect(interrupt).toHaveBeenCalledTimes(1)
  c.props.isStopPending = true
  await vue.nextTick()
  expect(stop().props.disabled).toBe(true)
  expect(stop().props['aria-label']).toBe('Saving thread before stop is available')
  c.props.isStopPending = false
  c.props.isInterruptingTurn = true
  await vue.nextTick()
  expect(stop().props.disabled).toBe(true)
  c.props.isInterruptingTurn = false
  c.props.disabled = true
  await vue.nextTick()
  expect(stop().props.disabled).toBe(true)
  c.props.isTurnInProgress = false
  await vue.nextTick()
  expect(stop()).toBeUndefined()
  expect(c.exposed.hasUnsavedDraft()).toBe(true)
})

it('opens each thread inline and restores only that thread’s draft after collapsing', async () => {
  const c = mount()
  c.exposed.hydrateDraft(payload)
  await vue.nextTick()
  c.nodes().find(n => n.props['aria-label'] === 'Minimize message input')!.props.onClick()
  await vue.nextTick()
  c.props.activeThreadId = 'other'
  await vue.nextTick()
  expect(c.nodes().some(n => n.props['aria-expanded'] === false && n.props['aria-controls'])).toBe(false)
  expect(c.exposed.hasUnsavedDraft()).toBe(false)
  c.exposed.appendTextToDraft('other draft')
  await vue.nextTick()
  c.props.activeThreadId = 'child'
  await vue.nextTick()
  expect(JSON.parse([...c.storage.entries()].find(([key]) => key.startsWith('codex-web-local.thread-draft.v2.other.'))?.[1]!).text).toBe('other draft')
  c.submit()
  expect(c.submitted.mock.calls[0]![0]).toEqual(payload)
})

it('closes composer popovers for pending requests without losing skills or the collapsed state', async () => {
  const c = mount({ skills: [{ name: 'skill', description: 'Selected skill', path: '/skill' }] })
  const button = (label: string) => c.nodes().find(n => n.props['aria-label'] === label)!
  c.exposed.hydrateDraft(payload)
  await vue.nextTick()
  button('Add attachments and settings').props.onClick()
  await vue.nextTick()
  button('Skills').props.onClick()
  await vue.nextTick()
  expect(c.nodes().some(n => n.tag === 'skill-dropdown')).toBe(true)
  c.props.hasPendingRequest = true
  await vue.nextTick()
  expect(c.nodes().some(n => n.tag === 'skill-dropdown')).toBe(false)
  expect(button('Exit full screen composer')).toBeUndefined()
  c.props.hasPendingRequest = false
  await vue.nextTick()
  expect(c.nodes().find(n => n.tag === 'skill-dropdown')!.props.selectedValues).toEqual(['/skill'])
  button('Minimize message input').props.onClick()
  await vue.nextTick()
  c.props.hasPendingRequest = true
  await vue.nextTick()
  expect(c.nodes().some(n => n.props.class === 'thread-composer-floating-actions')).toBe(false)
  c.props.hasPendingRequest = false
  await vue.nextTick()
  expect(c.nodes().some(n => n.props['aria-expanded'] === false && n.props['aria-controls'])).toBe(true)
  c.nodes().find(n => n.props['aria-expanded'] === false && n.props['aria-controls'])!.props.onClick()
  await vue.nextTick()
  c.submit()
  expect(c.submitted.mock.calls[0]![0]).toEqual(payload)
})

it('notifies the parent layout on expansion and every exit path while keeping a disabled editor escapable', async () => {
  const expanded = vi.fn()
  const c = mount({ 'onUpdate:expanded': expanded })
  const button = (label: string) => c.nodes().find(n => n.props['aria-label'] === label)!
  const expand = async () => {
    c.exposed.hydrateDraft({ ...payload, text: 'long draft\n'.repeat(20) })
    await vue.nextTick()
    button('Expand composer').props.onClick()
    await vue.nextTick()
    expect(expanded).toHaveBeenLastCalledWith(true)
  }
  await expand()
  c.props.disabled = true
  await vue.nextTick()
  expect(button('Exit full screen composer').props.disabled).toBe(false)
  button('Exit full screen composer').props.onClick()
  await vue.nextTick()
  expect(expanded).toHaveBeenLastCalledWith(false)
  expect(c.exposed.hasUnsavedDraft()).toBe(true)
  button('Expand composer').props.onClick()
  await vue.nextTick()
  expect(expanded).toHaveBeenLastCalledWith(false)
  c.props.disabled = false
  await expand()
  c.props.hasPendingRequest = true
  await vue.nextTick()
  expect(expanded).toHaveBeenLastCalledWith(false)
  expect(c.exposed.hasUnsavedDraft()).toBe(true)
  c.props.hasPendingRequest = false
  await expand()
  c.submit()
  c.submitted.mock.calls[0]![1](true)
  await vue.nextTick()
  expect(expanded).toHaveBeenLastCalledWith(false)
  await expand()
  c.props.activeThreadId = 'other'
  await vue.nextTick()
  expect(expanded).toHaveBeenLastCalledWith(false)
  await expand()
  cleanup.pop()!()
  expect(expanded).toHaveBeenLastCalledWith(false)
})


it('recovers a copy through the exposed Settings action, archiving all current fields before replacing without sending or consuming the source', async () => {
  const c = mount()
  const current = { ...payload, apps: [{ id: 'current_app', name: 'Current App' }] }
  c.exposed.hydrateDraft(current)
  await vue.nextTick()
  const legacyKey = 'codex-web-local.thread-draft.v1.child'
  const source = { ...payload, text: 'Legacy recovery', apps: [{ id: 'source_app', name: 'Source App' }] }
  c.storage.set(legacyKey, JSON.stringify(source))
  const drafts = imports['../../utils/composerDraftStorage'] as typeof import('../../utils/composerDraftStorage')
  const entry = drafts.recoverableDrafts('child').find(row => row.key === legacyKey)!
  expect(entry.draft).toEqual(source)
  expect(c.nodes().some(n => n.text?.includes('Recover saved drafts') || n.props.class === 'draft-recovery')).toBe(false)
  expect(c.exposed.recoverDraft(entry.draft)).toBe(true)
  // Archival is synchronous: it must exist before the next reactive persistence flush.
  expect(JSON.parse([...c.storage.entries()].find(([key]) => key.includes('.archive-'))![1])).toEqual(current)
  await vue.nextTick()
  expect(JSON.parse([...c.storage.entries()].find(([key]) => key.startsWith('codex-web-local.thread-draft.v2.child.') && !key.includes('.archive-'))![1])).toEqual(source)
  expect(c.storage.get(legacyKey)).toBe(JSON.stringify(source))
  expect(drafts.recoverableDrafts('child').map(row => row.draft)).toEqual(expect.arrayContaining([source, current]))
  expect(c.submitted).not.toHaveBeenCalled()
})

it('leaves the live draft intact and does not submit if preserving it fails during Settings recovery', async () => {
  const c = mount()
  c.exposed.hydrateDraft(payload)
  await vue.nextTick()
  const before = new Map(c.storage)
  const write = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded') })
  try {
    expect(c.exposed.recoverDraft({ ...payload, text: 'Must not replace current draft' })).toBe(false)
    await vue.nextTick()
    expect(c.storage).toEqual(before)
    expect((c.nodes().find(n => n.tag === 'textarea') as unknown as { value: string }).value).toBe(payload.text)
    expect(c.nodes().some(n => n.props.role === 'alert' && n.text?.includes('Could not preserve the current draft'))).toBe(true)
    expect(c.submitted).not.toHaveBeenCalled()
  } finally { write.mockRestore() }
})

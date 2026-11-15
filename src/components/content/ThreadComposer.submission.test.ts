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
function mount(initial: Record<string, unknown> = {}) {
  const storage = new Map<string, string>()
  vi.stubGlobal('window', { localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) }, addEventListener() {}, removeEventListener() {} })
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
    if (path.includes('useUiLanguage')) return { useUiLanguage: () => ({ t: (s: string) => s }) }
    if (path.includes('codexGateway')) return gateway
    return imports[path]
  })
  const submitted = vi.fn()
  const root = node('root')
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
  return { storage, exposed, submitted, props, selectedModels, nodes: () => all(root), model: () => findModel(root)!, submit: () => find(root, 'form')!.props.onSubmit({ preventDefault() {} }) }
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
it('keeps unknown slash text as a normal submission and records only accepted prompt text', async()=>{
 const c=mount();c.exposed.appendTextToDraft('/unknown-command');await vue.nextTick();c.submit()
 expect(c.submitted.mock.calls[0]![0].text).toBe('/unknown-command')
 expect(c.storage.has('codex-web-local.prompt-library.v1')).toBe(false)
 c.submitted.mock.calls[0]![1](true)
 expect(JSON.parse(c.storage.get('codex-web-local.prompt-library.v1')!).history).toEqual(['/unknown-command'])
})
it('opens command discovery without submitting or losing attachments',async()=>{
 const c=mount();c.exposed.hydrateDraft({...payload,text:'/prompts'});await vue.nextTick();c.submit()
 expect(c.submitted).not.toHaveBeenCalled();expect(c.nodes().some(n=>n.props['aria-label']==='Remove image')).toBe(false)
 c.exposed.appendTextToDraft('after command');await vue.nextTick();c.submit()
 expect(c.submitted.mock.calls[0]![0].fileAttachments).toEqual(payload.fileAttachments)
 expect(c.submitted.mock.calls[0]![0].skills).toEqual(payload.skills)
})

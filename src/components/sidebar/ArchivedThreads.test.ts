import { readFileSync } from 'node:fs'
import { compileScript, parse } from 'vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as archives from '../../composables/archivedThreads'
import { getArchivedThreadGroupsPage } from '../../api/codexGateway'
import type { UiThread } from '../../types/codex'

vi.mock('../../api/codexGateway', () => ({ getArchivedThreadGroupsPage: vi.fn() }))

// Compile the real template so clicks and rendered states exercise the component
// together with its existing archive composable, without a browser dependency.
const { descriptor } = parse(readFileSync(new URL('./ArchivedThreads.vue', import.meta.url), 'utf8'))
const compiled = compileScript(descriptor, { id: 'archives-test', inlineTemplate: true })
const code = ts.transpileModule(compiled.content, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exports: Record<string, any> = {}
new Function('exports', 'require', code)(exports, (path: string) => {
  if (path === 'vue') return vue
  if (path === '../../composables/archivedThreads') return archives
  throw new Error(`Unexpected archive component import: ${path}`)
})

type Node = { tag: string; text: string; props: Record<string, any>; children: Node[]; parent?: Node }
const node = (tag: string, text = ''): Node => ({ tag, text, props: {}, children: [] })
const renderer = vue.createRenderer<Node, Node>({
  createElement: node, createText: text => node('#text', text), createComment: () => node('#comment'),
  setText: (n, text) => { n.text = text },
  setElementText(n, text) { n.text = text; n.children = [] },
  parentNode: n => n.parent!, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
  insert(n, parent, anchor) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
    n.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(n)
    else parent.children.splice(index, 0, n)
  },
  remove(n) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1) },
  patchProp: (n, key, _old, value) => { n.props[key] = value },
})
const cleanup: Array<() => void> = []
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.resetAllMocks() })
const read = vi.mocked(getArchivedThreadGroupsPage)
const page = (ids: string[], nextCursor: string | null = null) => ({
  groups: [{ projectName: 'native-project', threads: ids.map(id => ({ id, title: id, projectId: 'native-project' }) as UiThread) }], nextCursor,
})
const flush = async () => { await Promise.resolve(); await vue.nextTick() }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
function mount(active = false) {
  const props = vue.reactive({ active, epoch: 0, restore: vi.fn<(id: string) => Promise<void>>().mockResolvedValue() })
  const root = node('root')
  const app = renderer.createApp({ setup: () => () => vue.h(exports.default, props) })
  app.mount(root)
  cleanup.push(() => app.unmount())
  const all = (n: Node): Node[] => [n, ...n.children.flatMap(all)]
  const nodes = () => all(root)
  const button = (label: string) => nodes().find(n => n.tag === 'button' && (n.props['aria-label'] || n.text) === label)!
  return { props, nodes, button, text: () => nodes().map(n => n.text).join(' ') }
}

describe('Archived conversations settings panel', () => {
  it('loads on first activation, renders inline and retains pages across category/dialog visits', async () => {
    const pending = deferred<ReturnType<typeof page>>()
    read.mockReturnValueOnce(pending.promise)
    const c = mount()
    expect(read).not.toHaveBeenCalled()
    expect(c.nodes().some(n => n.tag === 'dialog')).toBe(false)
    expect(c.nodes().some(n => n.tag === 'section' && n.props['aria-label'] === 'Archived conversations')).toBe(true)
    c.props.active = true
    await vue.nextTick()
    expect(read).toHaveBeenCalledExactlyOnceWith(null)
    expect(c.text()).toContain('Loading…')
    expect(c.button('Refresh archived conversations').props.disabled).toBe(true)
    // Leave and return while the initial request is pending: no duplicate read.
    c.props.active = false; await vue.nextTick()
    c.props.active = true; await vue.nextTick()
    expect(read).toHaveBeenCalledTimes(1)
    pending.resolve(page(['original'], 'next'))
    await flush()
    expect(c.text()).toContain('original')
    expect(c.text()).not.toContain('Loading…')
    c.props.active = false; await vue.nextTick()
    c.props.active = true; await vue.nextTick()
    expect(read).toHaveBeenCalledTimes(1)
    expect(c.button('Load more archived conversations')).toBeDefined()
  })

  it('forwards pagination and refresh actions while preserving the cached list', async () => {
    read.mockResolvedValueOnce(page(['first'], 'next')).mockResolvedValueOnce(page(['first', 'second'])).mockResolvedValueOnce(page(['fresh']))
    const c = mount(true)
    await flush()
    await c.button('Load more archived conversations').props.onClick()
    await flush()
    expect(read.mock.calls).toEqual([[null], ['next']])
    expect(c.nodes().filter(n => n.tag === 'li')).toHaveLength(2)
    expect(c.button('Load more archived conversations')).toBeUndefined()
    c.props.active = false; await vue.nextTick()
    c.props.active = true; await vue.nextTick()
    expect(read).toHaveBeenCalledTimes(2)
    expect(c.text()).toContain('second')
    await c.button('Refresh archived conversations').props.onClick()
    await flush()
    expect(read.mock.calls).toEqual([[null], ['next'], [null]])
    expect(c.text()).toContain('fresh')
    expect(c.button('Restore first')).toBeUndefined()
  })

  it('delegates restores by original ID and removes a row only after acknowledgment', async () => {
    read.mockResolvedValue(page(['original']))
    const c = mount(true)
    await flush()
    c.props.restore.mockRejectedValueOnce(new Error('Restore rejected'))
    await c.button('Restore original').props.onClick()
    await flush()
    expect(c.nodes().find(n => n.props.role === 'alert')?.text).toBe('Restore rejected')
    expect(c.button('Restore original')).toBeDefined()
    const pending = deferred<void>()
    c.props.restore.mockReturnValueOnce(pending.promise)
    const restoring = c.button('Restore original').props.onClick()
    await vue.nextTick()
    expect(c.button('Restore original').props.disabled).toBe(true)
    expect(c.button('Refresh archived conversations').props.disabled).toBe(true)
    pending.resolve()
    await restoring; await flush()
    expect(c.props.restore.mock.calls).toEqual([['original'], ['original']])
    expect(c.button('Restore original')).toBeUndefined()
    expect(c.text()).toContain('No archived conversations.')
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('renders load errors and recovers to the empty state through Refresh', async () => {
    read.mockRejectedValueOnce(new Error('Archive unavailable')).mockResolvedValueOnce(page([]))
    const c = mount(true)
    await flush()
    expect(c.nodes().find(n => n.props.role === 'alert')?.text).toBe('Archive unavailable')
    expect(c.text()).not.toContain('No archived conversations.')
    await c.button('Refresh archived conversations').props.onClick()
    await flush()
    expect(c.text()).toContain('No archived conversations.')
    expect(c.nodes().some(n => n.props.role === 'alert')).toBe(false)
  })

  it('retains connection invalidation and ignores stale results after leaving the category', async () => {
    const pending = deferred<ReturnType<typeof page>>()
    read.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(page(['current']))
    const c = mount(true)
    c.props.active = false
    c.props.epoch++
    await vue.nextTick()
    pending.resolve(page(['stale']))
    await flush()
    expect(c.text()).not.toContain('stale')
    expect(c.text()).toContain('Connection changed. Refresh archived conversations.')
    c.props.active = true
    await flush()
    expect(read).toHaveBeenCalledTimes(2)
    expect(c.text()).toContain('current')
  })
})

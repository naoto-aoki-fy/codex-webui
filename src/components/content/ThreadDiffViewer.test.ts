import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from 'vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it, vi } from 'vitest'
import * as lines from '../../utils/diffViewerLines'
import type { UiFileChange } from '../../types/codex'

const source = readFileSync(resolve('src/components/content/ThreadDiffViewer.vue'), 'utf8')
const { descriptor } = parse(source)
const compiled = compileScript(descriptor, { id: 'diff-viewer-test', inlineTemplate: true })
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const exports: Record<string, any> = {}
new Function('exports', 'require', code)(exports, (path: string) => {
  if (path === 'vue') return vue
  if (path.endsWith('.vue')) return { render: () => vue.h('svg') }
  return lines
})
const Viewer = exports.default
const first: UiFileChange = { path: 'src/a.ts', operation: 'update', diff: '@@ -4,2 +4,2 @@\n keep\n-old\n+<new>', addedLineCount: 1, removedLineCount: 1 }
const second: UiFileChange = { ...first, path: 'src/b.ts', movedToPath: 'src/c.ts', diff: '' }
function props(overrides = {}) {
  return {
    activeDiffViewerChange: first, diffViewerChanges: [first, second], isMobile: false,
    isDiffViewerFileListOpen: false, language: 'typescript',
    displayFileChangePath: (path: string) => path,
    fileChangeOperationLabel: () => 'Edited', fileChangeOperationTone: () => 'update',
    formatFileChangeDelta: () => '+1 -1', formatFileChangeCountLabel: (count: number) => `${count} files changed`,
    ...overrides,
  }
}
const render = (overrides = {}) => renderToString(vue.createSSRApp(Viewer, props(overrides)))

describe('diff viewer presentation', () => {
  it('renders selected file, labels, escaped lines, markers and both line numbers', async () => {
    const html = await render()
    expect(html).toContain('diff-viewer-sidebar')
    expect(html).toContain('src/a.ts')
    expect(html).toContain('typescript')
    expect(html).toContain('&lt;new&gt;')
    for (const [kind, oldLine, newLine, marker] of [['context', '4', '4', ''], ['remove', '5', '', '-'], ['add', '', '5', '+']]) {
      expect(html).toContain(`data-kind="${kind}"><span class="diff-viewer-line-number">${oldLine}</span><span class="diff-viewer-line-number">${newLine}</span><span class="diff-viewer-line-marker">${marker}</span>`)
    }
  })
  it('renders empty and renamed file labels when selection changes', async () => {
    const html = await render({ activeDiffViewerChange: second })
    expect(html).toContain('No diff available')
    expect(html).toContain('src/b.ts')
    expect(html).toContain('src/c.ts')
    expect(html).not.toContain('diff-viewer-lines')
    expect(html).not.toContain('&lt;new&gt;')
  })
  it('preserves mobile file picker and sheet presentations', async () => {
    const closed = await render({ isMobile: true })
    expect(closed).not.toContain('class="diff-viewer-sidebar"')
    expect(closed).toContain('diff-viewer-mobile-files-button')
    expect(closed).not.toContain('diff-viewer-mobile-sheet-list')
    const open = await render({ isMobile: true, isDiffViewerFileListOpen: true })
    expect(open).toContain('diff-viewer-mobile-sheet-list')
    expect(open).toContain('src/c.ts')
  })
  it('emits close, file selection and sheet events without owning selection state', async () => {
    // A minimal Vue host exercises the compiled template's real event handlers.
    type Node = { type: string; props: Record<string, any>; children: Node[]; parent?: Node }
    const node = (type: string): Node => ({ type, props: {}, children: [] })
    const renderer = vue.createRenderer<Node, Node>({
      createElement: node, createText: node, createComment: node,
      setText() {}, setElementText() {},
      parentNode: el => el.parent!, nextSibling: () => null,
      insert(el, parent) { el.parent = parent; parent.children.push(el) },
      remove(el) { if (el.parent) el.parent.children = el.parent.children.filter(child => child !== el) },
      patchProp(el, key, _old, value) { el.props[key] = value },
    })
    const close = vi.fn(), select = vi.fn(), toggle = vi.fn()
    const root = node('root')
    const app = renderer.createApp(Viewer, props({ onClose: close, onSelect: select }))
    app.mount(root)
    const all = (el: Node): Node[] => [el, ...el.children.flatMap(all)]
    const find = (cls: string) => all(root).find(el => el.props.class?.split(' ').includes(cls))!
    find('diff-viewer-close').props.onClick()
    find('diff-viewer-backdrop').props.onClick()
    find('diff-viewer-file-button').props.onClick()
    expect(close).toHaveBeenCalledTimes(2)
    expect(select).toHaveBeenCalledWith(first)
    app.unmount()
    const mobile = renderer.createApp(Viewer, props({ isMobile: true, onToggleFileList: toggle }))
    mobile.mount(root)
    find('diff-viewer-mobile-files-button').props.onClick()
    expect(toggle).toHaveBeenCalledOnce()
    mobile.unmount()
  })
})

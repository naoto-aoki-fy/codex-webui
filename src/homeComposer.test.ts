import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { renderToString } from 'vue/server-renderer'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import ComposerDropdown from './components/content/ComposerDropdown.vue'

const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
const containers = [...source.matchAll(/<div class="composer-container"[^>]*>/g)]
const composers = [...source.matchAll(/<ThreadComposer\b[\s\S]*?\/>/g)]
// Compile the actual wrapper and component bindings, keeping unrelated app setup out of the test.
const disabled = composers[0]![0].match(/:disabled="[^"]*"/)?.[0] ?? ''
const template = containers[0]![0] + '<ThreadComposer ' + disabled + ' /></div>'
const { compile } = createRequire(import.meta.url)('vue/dist/vue.cjs.js') as typeof Vue
const render = compile(template)
const dropdown = compile(source.match(/<ComposerDropdown class="new-thread-folder-dropdown"[\s\S]*?\/>/)![0]
  .replace(/ @update:model-value="[^"]*"/, ''))
const composer = Vue.defineComponent({
  props: { disabled: Boolean },
  setup: (props) => () => Vue.h('textarea', { disabled: props.disabled }),
})
async function html(cwd: string) {
  const app = Vue.createSSRApp({ setup: () => ({ newThreadCwd: cwd }), render })
  app.component('ThreadComposer', composer)
  return renderToString(app)
}

describe('home composer folder guard', () => {
  it.each(['', ' ', '\n\t'])('keeps an empty folder composer visible and inert (%j)', async (cwd) => {
    const result = await html(cwd)
    expect(result).toContain('composer-container is-disabled')
    expect(result).toContain(' inert')
    expect(result).toContain('aria-disabled="true"')
    expect(result).toContain('<textarea disabled')
  })
  it('enables after selection and disables again after clearing', async () => {
    const selected = await html('/tmp/project')
    expect(selected).not.toContain(' inert')
    expect(selected).toContain('aria-disabled="false"')
    expect(selected).not.toContain('<textarea disabled')
    expect(await html('')).toContain('<textarea disabled')
  })
  it('leaves the existing conversation wrapper and disabled binding unchanged', () => {
    expect(containers[1]![0]).toBe('<div class="composer-container">')
    expect(composers[1]![0]).not.toContain('newThreadCwd')
  })
  it('displays a cwd-only route even when a native Project ID equals the path', async () => {
    const cwd = '/workspace/special folder'
    async function renderSelection(newThreadProjectId: string) {
      const app = Vue.createSSRApp({
        setup: () => ({
          newThreadCwd: cwd,
          newThreadProjectId,
          newThreadFolderOptions: [{ value: cwd, label: 'Native project' }],
        }),
        render: dropdown,
      })
      app.component('ComposerDropdown', ComposerDropdown)
      return renderToString(app)
    }
    expect(await renderSelection('')).toContain('aria-label="/workspace/special folder"')
    expect(await renderSelection(cwd)).toContain('aria-label="Native project"')
  })
})

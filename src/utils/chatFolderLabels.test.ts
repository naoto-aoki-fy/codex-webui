import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ContentHeader from '../components/content/ContentHeader.vue'
import { formatChatPageTitle, getChatFolderName, getThreadContextLabel } from './chatFolderLabels'
import { UNASSIGNED_PROJECT } from './desktopProjectGroups'

const projectNames = { [UNASSIGNED_PROJECT]: 'Unassigned', 'native-id': 'My Native Project' }

describe('chat folder labels', () => {
  it.each([
    ['/home/user/projects/my-app///', 'my-app'],
    ['C:\\Projects\\my-app\\', 'my-app'],
    ['C:/Projects/my-app/', 'my-app'],
    ['\\\\?\\UNC\\server\\share\\my-app\\', 'my-app'],
    ['/home/user/literal\\backslash/', 'literal\\backslash'],
    ['/', '/'],
    ['C:\\', 'C:'],
  ])('uses the folder name of %s', (cwd, expected) => {
    expect(getChatFolderName(cwd)).toBe(expected)
    expect(getThreadContextLabel({ projectId: null, cwd }, projectNames)).toBe(expected)
  })

  it.each(['', '   ', '.', UNASSIGNED_PROJECT])('uses a fallback for unavailable cwd %j', (cwd) => {
    expect(getChatFolderName(cwd)).toBe('')
    expect(getThreadContextLabel({ projectId: null, cwd }, projectNames)).toBe('No working directory')
  })

  it.each([
    { thread: { cwd: '/workspace/my-app' }, expected: 'my-app' },
    { thread: { projectId: null, cwd: '' }, expected: 'No working directory' },
    { thread: { projectId: 'native-id', cwd: '/workspace/my-app' }, expected: 'My Native Project' },
  ])('shows $expected in the header and tab title', async ({ thread, expected }) => {
    const label = getThreadContextLabel(thread, projectNames)
    const html = await renderToString(h(ContentHeader, { title: 'Test chat', projectName: label }))
    expect(html).toMatch(new RegExp(`class="content-project-name"[^>]*>${expected}<`))
    expect(formatChatPageTitle('Test chat', label)).toBe(`${expected} - Test chat`)
  })

  it('does not show a label before a thread is selected', () => {
    expect(getThreadContextLabel(null, projectNames)).toBe('')
    expect(formatChatPageTitle(undefined, '')).toBe('Codex WebUI')
  })
})

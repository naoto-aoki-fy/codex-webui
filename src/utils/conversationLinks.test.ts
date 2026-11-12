import { describe, expect, it } from 'vitest'
import { getBasename, normalizePathDots, parseFileReference, parseMarkdownLinkToken, readAsteriskLinkWrapper, resolveRelativePath, toBrowseUrl, toLocalThreadUrl, toRenderableImageUrl, trimLinkWrappers } from './conversationLinks'

describe('conversation link characterization', () => {
  it.each([
    ['/tmp/a.ts#L12C3', { path: '/tmp/a.ts', line: 12 }],
    // The existing greedy colon match consumes the first numeric suffix.
    ['/tmp/a.ts:12:3', { path: '/tmp/a.ts:12', line: 3 }],
    ['C:\\work\\a.ts:12', { path: 'C:\\work\\a.ts', line: 12 }],
    ['"/tmp/a (copy).ts"', { path: '/tmp/a (copy).ts', line: null }],
    ['[`/tmp/a.ts`]', { path: '/tmp/a.ts', line: null }],
    ['file:///C:/work/a%20(copy).ts', { path: 'C:/work/a (copy).ts', line: null }],
    ['file:///tmp/a%ZZ.ts', { path: '/tmp/a%ZZ.ts', line: null }],
    ['src/a.ts', { path: 'src/a.ts', line: null }],
    ['', null], ['/tmp/', null], ['https://example.com/a.ts', null],
    ['javascript:alert(1)', null], ['data:text/plain,a', null], ['ftp://host/a', null],
    ['just prose', null], ['/tmp/a\nb', null],
  ])('parses %s without changing existing rules', (input, expected) => {
    expect(parseFileReference(input)).toEqual(expected)
  })

  it('preserves explicit cwd, home inference, Windows paths, and URL escaping', () => {
    expect(resolveRelativePath('../a.ts', '/home/me/project')).toBe('/home/me/a.ts')
    expect(resolveRelativePath('~/a.ts', '/home/me/project')).toBe('/home/me/a.ts')
    expect(resolveRelativePath('./a.ts', 'C:\\work')).toBe('C:/work/a.ts')
    expect(normalizePathDots('/a/../b/./c')).toBe('/b/c')
    expect(toBrowseUrl('src/a (copy).ts#L4', '/home/me')).toBe('/codex-local-browse/home/me/src/a%20(copy).ts')
    expect(toBrowseUrl('/tmp/a#b?.ts', '')).toBe('/codex-local-browse/tmp/a#b?.ts')
    expect(toBrowseUrl('C:\\work\\a.ts', '')).toBe('/codex-local-browse/C:/work/a.ts')
    expect(toBrowseUrl('a.ts', '')).toBe('#')
    expect(toBrowseUrl('', '/tmp')).toBe('#')
    expect(getBasename('C:\\work\\a.ts')).toBe('a.ts')
  })

  it.each(['http://example.com/a?q=1&b=2', 'https://example.com/a%20b'])('keeps HTTP destinations and visible labels: %s', (url) => {
    expect(parseMarkdownLinkToken(`[\`visible label\`](${url})`)).toEqual({ label: 'visible label', target: url })
    expect(toRenderableImageUrl(url)).toBe(url)
  })

  it('preserves wrappers, parentheses, unsupported tokens, and incomplete Markdown', () => {
    expect(trimLinkWrappers('(["a.ts"])')).toEqual({ core: 'a.ts', leading: '(["', trailing: ')]"' })
    expect(parseMarkdownLinkToken('[name](</tmp/a (copy).ts>)')).toEqual({ label: 'name', target: '/tmp/a (copy).ts' })
    expect(parseMarkdownLinkToken('[label](javascript:alert(1))')).toEqual({ label: 'label', target: 'javascript:alert(1)' })
    for (const input of ['[](/a)', '[a](', '[a]()', '[a](b\nc)']) expect(parseMarkdownLinkToken(input)).toBeNull()
    expect(readAsteriskLinkWrapper('**https://x**', 2, 11, 0, 'https://x')).toEqual({ segmentStart: 0, segmentEnd: 13, tokenEndTrim: 0 })
    expect(readAsteriskLinkWrapper('abc', 0, 3, 0, 'abc')).toBeNull()
  })

  it('constructs thread URLs using explicit browser context or the SSR fallback', () => {
    expect(toLocalThreadUrl('codex://threads/abc-123')).toBe('/#/thread/abc-123')
    expect(toLocalThreadUrl(' codex://threads/abc ', { origin: 'https://host', pathname: '/app' })).toBe('https://host/app/#/thread/abc')
    for (const input of ['codex://threads/', 'codex://threads/a/b', 'https://host', 'javascript:alert(1)']) expect(toLocalThreadUrl(input)).toBeNull()
  })

  it('preserves local image encoding and existing scheme handling', () => {
    expect(toRenderableImageUrl('/tmp/a b.png')).toBe('/codex-local-image?path=%2Ftmp%2Fa%20b.png')
    expect(toRenderableImageUrl('file:///tmp/a.png')).toBe('/codex-local-image?path=file%3A%2F%2F%2Ftmp%2Fa.png')
    for (const input of ['', 'blob:abc', 'data:image/png,x', 'javascript:alert(1)', 'relative.png']) expect(toRenderableImageUrl(input)).toBe(input)
  })
})

it('preserves web-owned asset URLs without routing them to remote filesystem reads', () => {
  expect(toRenderableImageUrl('/codex-app-asset?id=generated-image.png')).toBe('/codex-app-asset?id=generated-image.png')
})

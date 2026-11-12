import { describe, expect, it } from 'vitest'
import { buildTurnInput, type FileAttachmentParam } from './turnInput'

const file = { label: 'notes', path: '/notes.txt', fsPath: '/notes.txt' }
const prompt = (text: string) => '# Files mentioned by the user:\n\n## notes: /notes.txt\n\n## My request for Codex:\n\n' + text + '\n'

describe('buildTurnInput', () => {
  it.each(['hello', '', '  '])('preserves text verbatim: %j', (text) => {
    expect(buildTurnInput(text)).toEqual({ input: [{ type: 'text', text }], attachments: [] })
  })

  it.each(['', '  ', 'read this'])('constructs file prompts including attachment-only input: %j', (text) => {
    expect(buildTurnInput(text, [], undefined, [file])).toEqual({
      input: [{ type: 'text', text: prompt(text.trim() ? text : '') }],
      attachments: [file],
    })
  })

  it('preserves image order, duplicates, aliases, and Skill order after text', () => {
    const local = '/codex-local-image?path=%20%2Ftmp%2Fimage.png%20'
    const result = buildTurnInput('look', [' https://example.com/a.png ', local, '', local], [
      { name: 'review', path: '/skills/review' },
      { name: 'review', path: '/skills/review' },
    ], [file])
    expect(result).toEqual({
      input: [
        { type: 'text', text: '# Files mentioned by the user:\n\n## notes: /notes.txt\n\n## image.png: /tmp/image.png\n\n## My request for Codex:\n\nlook\n' },
        { type: 'image', url: 'https://example.com/a.png', image_url: 'https://example.com/a.png' },
        { type: 'localImage', path: '/tmp/image.png' },
        { type: 'localImage', path: '/tmp/image.png' },
        { type: 'skill', name: 'review', path: '/skills/review' },
        { type: 'skill', name: 'review', path: '/skills/review' },
      ],
      attachments: [file, { label: 'image.png', path: '/tmp/image.png', fsPath: '/tmp/image.png' }],
    })
  })

  it('keeps the first file by fsPath, including before converted local images', () => {
    const first = { label: 'custom', path: 'display', fsPath: '/tmp/a.png' }
    const second = { label: 'second', path: 'second', fsPath: '/other' }
    expect(buildTurnInput('', ['/codex-local-image?path=/tmp/a.png'], undefined, [
      first, second, { ...first, label: 'duplicate' },
    ]).attachments).toEqual([first, second])
  })

  it.each([
    ['/codex-local-image?path=C%3A%5Ctmp%5Cpic.png', 'pic.png', 'C:\\tmp\\pic.png'],
    ['/codex-local-image?path=%2F', '/', '/'],
    ['https://host/codex-local-image?path=/a.png', 'a.png', '/a.png'],
  ])('preserves path and filename fallbacks for %s', (url, label, path) => {
    expect(buildTurnInput('', [url]).attachments).toEqual([{ label, path, fsPath: path }])
  })

  it.each(['/codex-local-image', '/codex-local-image?path=%20', 'http://[', 'not a URL', 'data:image/png;base64,a'])(
    'retains remote fallback without new validation: %s', (url) => {
      expect(buildTurnInput('', [url])).toEqual({
        input: [{ type: 'text', text: '' }, { type: 'image', url, image_url: url }],
        attachments: [],
      })
    },
  )

  it('preserves missing fields and undefined-fsPath deduplication', () => {
    const malformed = [{}, { label: 'ignored' }] as FileAttachmentParam[]
    expect(buildTurnInput('', [], [{ } as { name: string; path: string }], malformed)).toEqual({
      input: [
        { type: 'text', text: '# Files mentioned by the user:\n\n## undefined: undefined\n\n## My request for Codex:\n\n\n' },
        { type: 'skill', name: undefined, path: undefined },
      ],
      attachments: [{ label: undefined, path: undefined, fsPath: undefined }],
    })
  })

  it('preserves null/undefined behavior instead of introducing validation', () => {
    expect(buildTurnInput('', undefined, null as never, undefined)).toEqual(buildTurnInput(''))
    expect(buildTurnInput(null as never).input).toEqual([{ type: 'text', text: null }])
    expect(buildTurnInput(undefined as never).input).toEqual([{ type: 'text', text: undefined }])
    expect(() => buildTurnInput('', null as never)).toThrow(TypeError)
    expect(() => buildTurnInput('', [null as never])).toThrow(TypeError)
    expect(() => buildTurnInput('', [42 as never])).toThrow(TypeError)
    expect(() => buildTurnInput('', [], [null as never])).toThrow(TypeError)
    expect(() => buildTurnInput('', [], undefined, [null as never])).toThrow(TypeError)
    expect(() => buildTurnInput(null as never, [], undefined, [file])).toThrow(TypeError)
  })

  it('does not mutate inputs and allocates new arrays and output records on each call', () => {
    const files = Object.freeze([Object.freeze({ ...file })])
    const images = Object.freeze(['https://example.com/a'])
    const skills = Object.freeze([Object.freeze({ name: 'review', path: '/skill' })])
    const run = () => buildTurnInput('text', images as unknown as string[], skills as unknown as Array<{ name: string; path: string }>, files as unknown as FileAttachmentParam[])
    const a = run()
    const b = run()
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(a.input).not.toBe(b.input)
    expect(a.attachments).not.toBe(files)
    expect(a.attachments).not.toBe(b.attachments)
    expect(a.attachments[0]).not.toBe(files[0])
    a.input.forEach((entry, index) => expect(entry).not.toBe(b.input[index]))
    expect(buildTurnInput('').attachments).not.toBe(buildTurnInput('').attachments)
  })
})

it.each(['/remote/image.png', 'D:\\remote\\image.png', '\\\\server\\share\\image.png'])('submits raw remote image path %s as localImage on the server host', (path) => {
  const result = buildTurnInput('look', [path])
  expect(result.input).toContainEqual({ type: 'localImage', path })
})


it('converts remote file URLs to filesystem paths for localImage input', () => {
  expect(buildTurnInput('look', ['file:///D:/remote/image%20one.png']).input)
    .toContainEqual({ type: 'localImage', path: 'D:/remote/image one.png' })
  expect(buildTurnInput('look', ['file://server/share/image.png']).input)
    .toContainEqual({ type: 'localImage', path: '//server/share/image.png' })
})

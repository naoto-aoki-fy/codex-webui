import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  mergeSessionSkillInputsIntoTurns,
  sanitizeThreadTurnsInlinePayloads,
} from './codexAppServerBridge'

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
const pngDataUrl = `data:image/png;base64,${pngBase64}`
const gifBase64 = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
const jpegBase64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2w=='
const webpBase64 = 'UklGRiIAAABXRUJQVlA4IC4AAAAwAQCdASoBAAEAAQAcJaQAA3AA/vuUAAA='

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function localImagePathFromProxyUrl(value: string): string {
  const parsed = new URL(value, 'http://localhost')
  expect(parsed.pathname).toBe('/codex-local-image')
  const imagePath = parsed.searchParams.get('path')
  expect(imagePath).toBeTruthy()
  return imagePath ?? ''
}

describe('thread inline media sanitization', () => {
  it('externalizes inline image data from common thread payload fields', async () => {
    const result = await sanitizeThreadTurnsInlinePayloads('thread/read', {
      thread: {
        turns: [
          {
            id: 'turn-1',
            items: [
              {
                id: 'user-1',
                type: 'userMessage',
                content: [{ type: 'image', url: pngDataUrl }],
                images: [pngDataUrl],
              },
              {
                id: 'generated-1',
                type: 'imageGeneration',
                result: pngBase64,
              },
              {
                id: 'tool-output-1',
                type: 'functionCallOutput',
                result: pngBase64,
              },
            ],
          },
        ],
      },
    }) as {
      thread: {
        turns: Array<{
          items: Array<Record<string, unknown>>
        }>
      }
    }

    const [userMessage, generatedImage, toolOutput] = result.thread.turns[0].items
    const content = userMessage.content as Array<Record<string, unknown>>
    const images = userMessage.images as string[]

    expect(content[0].url).toMatch(/^\/codex-local-image\?path=/)
    expect(images[0]).toMatch(/^\/codex-local-image\?path=/)
    expect(generatedImage.type).toBe('imageView')
    expect(generatedImage.path).toEqual(expect.any(String))
    expect(toolOutput.result).toMatch(/^\/codex-local-image\?path=/)

    expect(existsSync(localImagePathFromProxyUrl(content[0].url as string))).toBe(true)
    expect(existsSync(localImagePathFromProxyUrl(images[0]))).toBe(true)
    expect(existsSync(generatedImage.path as string)).toBe(true)
    expect(existsSync(localImagePathFromProxyUrl(toolOutput.result as string))).toBe(true)
  })

  it('leaves non-image result strings untouched', async () => {
    const textResult = 'a'.repeat(128)
    const result = await sanitizeThreadTurnsInlinePayloads('thread/read', {
      thread: {
        turns: [
          {
            id: 'turn-1',
            items: [
              {
                id: 'tool-output-1',
                type: 'functionCallOutput',
                result: textResult,
              },
            ],
          },
        ],
      },
    }) as {
      thread: {
        turns: Array<{
          items: Array<{ result: string }>
        }>
      }
    }

    expect(result.thread.turns[0].items[0].result).toBe(textResult)
  })

  it('leaves non-image data URLs untouched in image-like fields', async () => {
    const dataUrl = 'data:text/plain;base64,aGVsbG8='
    const result = await sanitizeThreadTurnsInlinePayloads('thread/read', {
      thread: {
        turns: [
          {
            id: 'turn-1',
            items: [
              {
                id: 'tool-output-1',
                type: 'functionCallOutput',
                result: dataUrl,
              },
            ],
          },
        ],
      },
    }) as {
      thread: {
        turns: Array<{
          items: Array<{ result: string }>
        }>
      }
    }

    expect(result.thread.turns[0].items[0].result).toBe(dataUrl)
  })

  it('externalizes supported bare base64 image signatures with matching extensions', async () => {
    const result = await sanitizeThreadTurnsInlinePayloads('thread/read', {
      thread: {
        turns: [
          {
            id: 'turn-1',
            items: [
              {
                id: 'tool-output-1',
                type: 'functionCallOutput',
                images: [jpegBase64, webpBase64, gifBase64],
              },
            ],
          },
        ],
      },
    }) as {
      thread: {
        turns: Array<{
          items: Array<{ images: string[] }>
        }>
      }
    }

    const images = result.thread.turns[0].items[0].images
    expect(images).toHaveLength(3)
    expect(images.every((image) => image.startsWith('/codex-local-image?path='))).toBe(true)

    const [jpegPath, webpPath, gifPath] = images.map(localImagePathFromProxyUrl)
    expect(jpegPath.endsWith('.jpg')).toBe(true)
    expect(webpPath.endsWith('.webp')).toBe(true)
    expect(gifPath.endsWith('.gif')).toBe(true)
    expect(existsSync(jpegPath)).toBe(true)
    expect(existsSync(webpPath)).toBe(true)
    expect(existsSync(gifPath)).toBe(true)
  })

  it('externalizes nested replacement history image URLs', async () => {
    const result = await sanitizeThreadTurnsInlinePayloads('thread/read', {
      thread: {
        turns: [
          {
            id: 'turn-1',
            items: [
              {
                id: 'message-1',
                type: 'message',
                replacement_history: [
                  {
                    content: [
                      {
                        type: 'image',
                        image_url: pngDataUrl,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    }) as {
      thread: {
        turns: Array<{
          items: Array<{
            replacement_history: Array<{
              content: Array<{ image_url: string }>
            }>
          }>
        }>
      }
    }

    const imageUrl = result.thread.turns[0].items[0].replacement_history[0].content[0].image_url
    expect(imageUrl).toMatch(/^\/codex-local-image\?path=/)
    expect(existsSync(localImagePathFromProxyUrl(imageUrl))).toBe(true)
  })

  it('does not sanitize inline images for methods without thread turns', async () => {
    const payload = {
      thread: {
        turns: [
          {
            id: 'turn-1',
            items: [
              {
                id: 'tool-output-1',
                type: 'functionCallOutput',
                result: pngBase64,
              },
            ],
          },
        ],
      },
    }

    const result = await sanitizeThreadTurnsInlinePayloads('thread/list', payload)

    expect(result).toBe(payload)
  })
})

describe('thread session skill recovery', () => {
  it('adds selected skill inputs from session JSONL to matching user messages', () => {
    const turns = [{
      id: 'turn-1',
      items: [{
        id: 'item-1',
        type: 'userMessage',
        content: [{ type: 'text', text: 'use a skill', text_elements: [] }],
      }],
    }]
    const sessionLog = [
      JSON.stringify({ type: 'turn_context', payload: { turn_id: 'turn-1' } }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'use a skill' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: '<skill>\n<name>browser-use:browser</name>\n<path>/Users/igor/.codex/plugins/browser/SKILL.md</path>\n---\n# Browser\n</skill>',
          }],
        },
      }),
    ].join('\n')

    const merged = mergeSessionSkillInputsIntoTurns(turns, sessionLog) as typeof turns
    expect(merged[0].items[0].content).toEqual([
      { type: 'text', text: 'use a skill', text_elements: [] },
      { type: 'skill', name: 'browser-use:browser', path: '/Users/igor/.codex/plugins/browser/SKILL.md' },
    ])
  })

  it('does not duplicate skill inputs that are already present', () => {
    const turns = [{
      id: 'turn-1',
      items: [{
        id: 'item-1',
        type: 'userMessage',
        content: [
          { type: 'text', text: 'use a skill', text_elements: [] },
          { type: 'skill', name: 'browser-use:browser', path: '/Users/igor/.codex/plugins/browser/SKILL.md' },
        ],
      }],
    }]
    const sessionLog = [
      JSON.stringify({ type: 'turn_context', payload: { turn_id: 'turn-1' } }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: '<skill>\n<name>browser-use:browser</name>\n<path>/Users/igor/.codex/plugins/browser/SKILL.md</path>\n</skill>',
          }],
        },
      }),
    ].join('\n')

    expect(mergeSessionSkillInputsIntoTurns(turns, sessionLog)).toBe(turns)
  })

  it('adds selected skill inputs to the last user message in a multi-message turn', () => {
    const turns = [{
      id: 'turn-1',
      items: [
        {
          id: 'item-1',
          type: 'userMessage',
          content: [{ type: 'text', text: 'first message', text_elements: [] }],
        },
        {
          id: 'item-2',
          type: 'agentMessage',
          content: [{ type: 'text', text: 'assistant reply', text_elements: [] }],
        },
        {
          id: 'item-3',
          type: 'userMessage',
          content: [{ type: 'text', text: 'second message', text_elements: [] }],
        },
      ],
    }]
    const sessionLog = [
      JSON.stringify({ type: 'turn_context', payload: { turn_id: 'turn-1' } }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: '<skill>\n<name>browser-use:browser</name>\n<path>/Users/igor/.codex/plugins/browser/SKILL.md</path>\n</skill>',
          }],
        },
      }),
    ].join('\n')

    const merged = mergeSessionSkillInputsIntoTurns(turns, sessionLog) as typeof turns
    expect(merged[0].items[0].content).toEqual([{ type: 'text', text: 'first message', text_elements: [] }])
    expect(merged[0].items[2].content).toEqual([
      { type: 'text', text: 'second message', text_elements: [] },
      { type: 'skill', name: 'browser-use:browser', path: '/Users/igor/.codex/plugins/browser/SKILL.md' },
    ])
  })
})


describe('inline payload compatibility contracts', () => {
  const payload = (item: Record<string, unknown>) => ({ thread: { turns: [{ id: 'contract-turn', items: [item] }] } })
  const sanitize = async (input: ReturnType<typeof payload>, method = 'thread/read') =>
    await sanitizeThreadTurnsInlinePayloads(method, input) as typeof input

  it.each(['thread/read', 'thread/resume', 'thread/fork', 'thread/rollback'])('sanitizes %s without mutating input and reuses persisted bytes', async method => {
    const untouched = { text: pngBase64 }
    const item = { id: 'contract-item', nested: { images: [[pngBase64]] }, untouched }
    const input = payload(item)
    const before = structuredClone(input)
    const result = await sanitize(input, method)
    const changed = result.thread.turns[0].items[0] as typeof item
    const hash = createHash('sha1').update(Buffer.from(pngBase64, 'base64')).digest('hex')
    const path = join(tmpdir(), 'codex-web-inline-media', `inline-image-contract-turn-contract-item-images-0-${hash}.png`)
    expect(changed.nested.images[0][0]).toBe(`/codex-local-image?path=${encodeURIComponent(path)}`)
    expect(await readFile(path)).toEqual(Buffer.from(pngBase64, 'base64'))
    const firstStat = await stat(path)
    expect(await sanitize(input, method)).toEqual(result)
    expect((await stat(path)).mtimeMs).toBe(firstStat.mtimeMs)
    expect(input).toEqual(before)
    expect(changed.untouched).toBe(untouched)
    expect(changed).not.toBe(item)
  })

  it.each(['thread/start', 'thread/list', 'turn/start', 'unknown'])('preserves excluded %s payload identity', async method => {
    const input = payload({ images: [pngDataUrl] })
    expect(await sanitize(input, method)).toBe(input)
  })

  it.each([null, undefined, [], {}, { thread: null }, { thread: { turns: [] } }, { thread: { turns: [null, {}, { items: null }] } }])('preserves unexpected thread shape %#', async input => {
    expect(await sanitizeThreadTurnsInlinePayloads('thread/read', input)).toBe(input)
  })

  it('preserves malformed fields and non-image nested payloads by identity', async () => {
    const input = payload({ images: ['', null, 42, {}, '%%%bad', 'data:text/plain;base64,aGVsbG8='], result: 'short', content: [null, { type: 'image', url: '' }, { type: 'text', text: pngDataUrl }] })
    expect(await sanitize(input)).toBe(input)
  })

  it.each([
    ['image/*', '.png'], ['application/octet-stream', '.png'], [' IMAGE/JPEG ', '.jpg'], ['image/unknown', ''],
  ])('preserves generated-image MIME handling for %s', async (mime, ext) => {
    const result = await sanitize(payload({ id: 'generated-contract', type: 'image_generation', result: pngBase64, mime_type: mime }))
    const item = result.thread.turns[0].items[0]
    const hash = createHash('sha1').update(Buffer.from(pngBase64, 'base64')).digest('hex')
    expect(item.type).toBe('imageView')
    expect(item.path).toBe(join(tmpdir(), 'codex-web-inline-media', `generated-image-contract-turn-generated-contract-${hash}${ext}`))
    expect(item.result).toBe(pngBase64)
  })

  it('preserves empty and malformed URL attachment fallbacks', async () => {
    const result = await sanitize(payload({ content: [
      { type: 'image', url: 'data:image/png;base64,', filename: 'empty.png' },
      { type: 'image', url: 'data:image/png,%ZZ', path: '/tmp/bad.png' },
    ] }))
    expect(result.thread.turns[0].items[0].content).toEqual([
      { type: 'text', text: 'Image attachment: attachment://empty.png' },
      { type: 'text', text: 'Image attachment: file:///tmp/bad.png' },
    ])
  })
})

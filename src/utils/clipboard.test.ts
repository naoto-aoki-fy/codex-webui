import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyTextToClipboard } from './clipboard'

afterEach(() => vi.unstubAllGlobals())

function selectionFixture(result: boolean | Error = true) {
  const textarea = {
    value: '', style: {}, setAttribute: vi.fn(), focus: vi.fn(),
    select: vi.fn(), setSelectionRange: vi.fn(),
  }
  const execCommand = vi.fn(() => {
    if (result instanceof Error) throw result
    return result
  })
  const body = { appendChild: vi.fn(), removeChild: vi.fn() }
  vi.stubGlobal('document', { createElement: vi.fn(() => textarea), body, execCommand })
  return { textarea, execCommand, body }
}

const text = '  # Title\n\n```ts\nconst value = "日本語"\n```\nhttps://example.com/a?q=1\n'

describe('copyTextToClipboard', () => {
  it('prefers the native API and preserves the exact text', async () => {
    const { execCommand, body } = selectionFixture()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await copyTextToClipboard(text)
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text)
    expect(execCommand).not.toHaveBeenCalled()
    expect(body.appendChild).not.toHaveBeenCalled()
  })

  it.each(['absent', 'missing writeText', 'rejected'] as const)('falls back when the API is %s', async mode => {
    const { textarea, execCommand, body } = selectionFixture()
    const writeText = vi.fn().mockRejectedValue(new Error('Permission denied'))
    vi.stubGlobal('navigator', mode === 'absent' ? {} : { clipboard: mode === 'rejected' ? { writeText } : {} })
    const pending = copyTextToClipboard(text)
    if (mode === 'absent') expect(execCommand).toHaveBeenCalledExactlyOnceWith('copy')
    await expect(pending).resolves.toBeUndefined()
    expect(writeText).toHaveBeenCalledTimes(mode === 'rejected' ? 1 : 0)
    if (mode === 'rejected') expect(writeText).toHaveBeenCalledWith(text)
    expect(execCommand).toHaveBeenCalledExactlyOnceWith('copy')
    expect(textarea.value).toBe(text)
    expect(textarea.select).toHaveBeenCalledOnce()
    expect(textarea.setSelectionRange).toHaveBeenCalledExactlyOnceWith(0, text.length)
    expect(body.appendChild).toHaveBeenCalledExactlyOnceWith(textarea)
    expect(body.removeChild).toHaveBeenCalledExactlyOnceWith(textarea)
  })

  it.each([false, new Error('Copy blocked')])('rejects and cleans up when fallback fails with %s', async failure => {
    const { execCommand, body, textarea } = selectionFixture(failure)
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } })
    await expect(copyTextToClipboard(text)).rejects.toThrow('Copy failed')
    expect(execCommand).toHaveBeenCalledExactlyOnceWith('copy')
    expect(body.removeChild).toHaveBeenCalledExactlyOnceWith(textarea)
  })

  it('rejects when neither browser copy method exists', async () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('document', undefined)
    await expect(copyTextToClipboard(text)).rejects.toThrow('Copy failed')
  })
})

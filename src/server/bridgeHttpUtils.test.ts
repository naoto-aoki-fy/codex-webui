import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { asRecord, getErrorMessage, isEmptyThreadReadError, isThreadMaterializationPendingError, isThreadNotFoundError, isUnauthenticatedRateLimitError, readJsonBody, readRawBody, setJson } from './bridgeHttpUtils'

const request = (chunks: Array<string | Buffer>) => Readable.from(chunks) as unknown as IncomingMessage

describe('bridge body readers', () => {
  it('parses chunked UTF-8 JSON and preserves primitive values', async () => {
    const bytes = Buffer.from('{"text":"日本語"}')
    expect(await readJsonBody(request([bytes.subarray(0, 12), bytes.subarray(12)]))).toEqual({ text: '日本語' })
    for (const value of ['false', '42', 'null', '[]', '"text"']) {
      expect(await readJsonBody(request([value]))).toEqual(JSON.parse(value))
    }
  })
  it.each([{ chunks: [] }, { chunks: [''] }, { chunks: [' \n\t '] }])('returns null for empty/whitespace chunks %j', async ({ chunks }) => {
    expect(await readJsonBody(request(chunks))).toBeNull()
  })
  it('rejects malformed JSON without replacing the parse error', async () => {
    await expect(readJsonBody(request(['{broken']))).rejects.toBeInstanceOf(SyntaxError)
  })
  it('preserves the absence of an application-level body-size limit', async () => {
    const text = 'x'.repeat(2 * 1024 * 1024)
    expect(await readJsonBody(request([JSON.stringify({ text })]))).toEqual({ text })
  })
  it('concatenates raw string and buffer chunks without trimming', async () => {
    expect(await readRawBody(request([' a', Buffer.from('b ')]))).toEqual(Buffer.from(' ab '))
  })
  it.each([readRawBody, readJsonBody])('propagates stream errors and aborted requests (%s)', async reader => {
    for (const code of ['EIO', 'ECONNRESET']) {
      const error = Object.assign(new Error(code === 'ECONNRESET' ? 'aborted' : 'stream failure'), { code })
      const stream = new Readable({ read() { this.push('{'); this.destroy(error) } })
      await expect(reader(stream as IncomingMessage)).rejects.toBe(error)
    }
  })
})

describe('bridge error extraction', () => {
  it.each([
    [new Error(' message '), ' message '], [new Error('   '), '   '],
    [{ message: 'top', error: { message: 'nested' } }, 'top'],
    [{ message: '', error: 'string' }, 'string'], [{ error: { message: 'nested' } }, 'nested'],
    [{ message: ' ' }, ' '], [{ error: { error: { message: 'too deep' } } }, 'fallback'],
    [null, 'fallback'], [undefined, 'fallback'], ['message', 'fallback'],
    [[], 'fallback'], [{ message: 42, error: [] }, 'fallback'], [{ error: '' }, 'fallback'],
  ])('preserves message precedence for %j', (payload, expected) => {
    expect(getErrorMessage(payload, 'fallback')).toBe(expected)
  })
  it('returns the same record and rejects arrays', () => {
    expect(asRecord([])).toBeNull()
    const value = { code: 42 }
    expect(asRecord(value)).toBe(value)
  })
  it.each([
    [isUnauthenticatedRateLimitError, 'AUTHENTICATION REQUIRED to read RATE LIMITS', 'authentication required'],
    [isEmptyThreadReadError, 'FAILED TO READ THREAD: rollout abc IS EMPTY', 'rollout is empty'],
    [isThreadMaterializationPendingError, 'NOT MATERIALIZED YET: includeTurns is unavailable before first user message', 'not materialized yet'],
    [isThreadNotFoundError, 'THREAD NOT FOUND: abc', 'thread read failed'],
    [isThreadNotFoundError, 'NO ROLLOUT FOUND FOR THREAD ID abc', 'network error'],
  ])('classifies nested errors with %s', (classify, matching, other) => {
    expect(classify({ error: { message: matching } })).toBe(true)
    for (const error of [null, {}, { message: 42 }, matching, new Error(other)]) expect(classify(error)).toBe(false)
  })
})

it.each([200, 400, 404, 502])('serializes the exact JSON envelope with status %s', status => {
  const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() }
  setJson(res as unknown as ServerResponse, status, { error: 'message', code: 'CODE', omitted: undefined })
  expect(res.statusCode).toBe(status)
  expect(res.setHeader).toHaveBeenCalledExactlyOnceWith('Content-Type', 'application/json; charset=utf-8')
  expect(res.end).toHaveBeenCalledExactlyOnceWith('{"error":"message","code":"CODE"}')
})

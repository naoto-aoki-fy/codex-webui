import { describe, expect, it } from 'vitest'
import type { UiFileChange } from '../types/codex'
import { buildDiffViewerLines, fileChangeKey } from './diffViewerLines'

function change(overrides: Partial<UiFileChange> = {}): UiFileChange {
  return { path: 'src/example.ts', operation: 'update', diff: '', addedLineCount: 0, removedLineCount: 0, ...overrides }
}

describe('buildDiffViewerLines', () => {
  it('keeps headers and metadata separate from numbered lines across hunks', () => {
    const input = change({ diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -2,2 +4,2 @@\n same\n-old\n+new\n\\ No newline at end of file\n@@ -20 +30 @@ label\n-next\n+last\n' })
    const rows = buildDiffViewerLines(input)
    expect(rows.map(({ kind, oldLine, newLine, text }) => [kind, oldLine, newLine, text])).toEqual([
      ['meta', null, null, 'diff --git a/x b/x'],
      ['meta', null, null, '--- a/x'],
      ['meta', null, null, '+++ b/x'],
      ['hunk', null, null, '@@ -2,2 +4,2 @@'],
      ['context', 2, 4, 'same'],
      ['remove', 3, null, 'old'],
      ['add', null, 5, 'new'],
      ['meta', null, null, '\\ No newline at end of file'],
      ['hunk', null, null, '@@ -20 +30 @@ label'],
      ['remove', 20, null, 'next'],
      ['add', null, 30, 'last'],
    ])
    expect(rows[4]?.key).toBe(`${fileChangeKey(input)}:context:4`)
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
  })

  it.each(['add', 'delete', 'update'] as const)('preserves synthetic %s numbering and blank lines', (operation) => {
    const input = change({ operation, diff: 'first\r\n\r\nlast\r\n' })
    expect(buildDiffViewerLines(input)).toEqual(['first', '', 'last'].map((text, index) => ({
      key: `${fileChangeKey(input)}:synthetic:${index}`,
      kind: operation === 'delete' ? 'remove' : 'add',
      oldLine: operation === 'delete' ? index + 1 : null,
      newLine: operation === 'delete' ? null : index + 1,
      text,
    })))
  })

  it('treats added and deleted file contents as raw text even with diff-like prefixes', () => {
    for (const operation of ['add', 'delete'] as const) {
      expect(buildDiffViewerLines(change({ operation, diff: '@@ -1 +1 @@\n+literal\n-literal' })).map((row) => row.text))
        .toEqual(['@@ -1 +1 @@', '+literal', '-literal'])
    }
  })

  it('retains move metadata, CRLF normalization, and zero-count hunk starts', () => {
    const input = change({ movedToPath: 'src/moved.ts', diff: '*** Move to: src/moved.ts\r\n@@ -0,0 +1 @@\r\n+new\r\n*** End of File\r\n' })
    const before = { ...input }
    const rows = buildDiffViewerLines(input)
    expect(rows.map((row) => row.kind)).toEqual(['meta', 'hunk', 'add', 'meta'])
    expect(rows[2]).toEqual({ key: 'src/example.ts\u0000src/moved.ts:add:2', kind: 'add', oldLine: null, newLine: 1, text: 'new' })
    expect(input).toEqual(before)
    expect(buildDiffViewerLines(input)).toEqual(rows)
  })

  it('returns no rows for missing or whitespace-only diffs', () => {
    expect(buildDiffViewerLines(null)).toEqual([])
    expect(buildDiffViewerLines(change())).toEqual([])
    expect(buildDiffViewerLines(change({ diff: ' \r\n\t' }))).toEqual([])
  })
})

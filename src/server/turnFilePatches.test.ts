import { expect, it } from 'vitest'
import { applyV4aDiff, parseApplyPatchInput, reverseV4aDiff } from './turnFilePatches'

it('parses ordered operations, moves, spaces, CRLF and existing whitespace trimming', () => {
  expect(parseApplyPatchInput([
    '*** Begin Patch', '*** Add File:  dir/a b.txt ', '+hello  ', '+',
    '*** Delete File: old.txt', '*** Update File: from.txt', '*** Move to: dir/to file.txt ',
    '@@ -1 +1 @@', '-old', '+new', '*** End Patch',
  ].join('\r\n'))).toEqual([
    { path: 'dir/a b.txt', operation: 'add', movedToPath: null, diff: 'hello', addedLineCount: 1, removedLineCount: 0 },
    { path: 'old.txt', operation: 'delete', movedToPath: null, diff: '', addedLineCount: 0, removedLineCount: 0 },
    { path: 'from.txt', operation: 'update', movedToPath: 'dir/to file.txt', diff: '@@ -1 +1 @@\n-old\n+new', addedLineCount: 1, removedLineCount: 1 },
  ])
})

it.each(['', 'garbage', '*** Add File:', '*** Update File: ', '*** Delete File: '])('ignores empty or invalid headers: %j', input => {
  expect(parseApplyPatchInput(input)).toEqual([])
})

it('accepts incomplete wrappers, raw addition lines and empty move destinations', () => {
  expect(parseApplyPatchInput('*** Add File: ../a\nraw')[0]).toMatchObject({ path: '../a', diff: 'raw', addedLineCount: 1 })
  expect(parseApplyPatchInput('*** Update File: a\n*** Move to: \n+++header\n---header\n+x\n-y')[0])
    .toMatchObject({ movedToPath: null, addedLineCount: 1, removedLineCount: 1 })
})

it.each(['', '\n', 'ignored body'])('leaves content unchanged without hunks: %j', diff => {
  expect(applyV4aDiff('old\n', diff)).toBe('old\n')
  expect(reverseV4aDiff('old\n', diff)).toBe('old\n')
})

it.each(['', '\n'])('round trips multiple hunks with EOF %j', eof => {
  const diff = '@@ -1 +1 @@\n-a\n+A\n@@ -3 +3 @@\n-c\n+C\n\n'
  const before = 'a\nb\nc' + eof
  const after = 'A\nb\nC' + eof
  expect(applyV4aDiff(before, diff)).toBe(after)
  expect(reverseV4aDiff(after, diff)).toBe(before)
})

it('returns null for missing context and treats malformed body lines as context', () => {
  expect(applyV4aDiff('other', '@@ -1 +1 @@\n-old\n+new')).toBeNull()
  expect(reverseV4aDiff('other', '@@\n-old\n+new')).toBeNull()
  expect(applyV4aDiff('raw\nold', '@@ -1 +1 @@\nraw\n-old\n+new')).toBe('raw\nnew')
  expect(applyV4aDiff('old', '@@\n-old\n+new')).toBe('old')
  expect(reverseV4aDiff('new', '@@\n-old\n+new')).toBe('old')
})

it('preserves insertion/deletion asymmetry and literal EOF markers', () => {
  expect(applyV4aDiff('', '@@ -0,0 +1 @@\n+x')).toBe('x')
  expect(reverseV4aDiff('x', '@@ -0,0 +1 @@\n+x')).toBe('')
  expect(applyV4aDiff('x', '@@ -1 +0,0 @@\n-x')).toBe('')
  expect(reverseV4aDiff('', '@@ -1 +0,0 @@\n-x')).toBe('')
  expect(applyV4aDiff('x', '@@ -1 +1 @@\n-x\n+y\n*** End of File')).toBeNull()
  expect(applyV4aDiff('x', '@@ -1 +1 @@\n-x\n+y\n\\ No newline at end of file')).toBeNull()
})

it('uses preferred forward positions and refuses ambiguous reverse matches', () => {
  const diff = '@@ -1 +1 @@\n-a\n+b'
  expect(applyV4aDiff('a\na', diff)).toBe('b\na')
  expect(reverseV4aDiff('b\nb', diff)).toBeNull()
})

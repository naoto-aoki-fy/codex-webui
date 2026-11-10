export type SessionRecoveredFileChange = {
  path: string
  operation: 'add' | 'delete' | 'update'
  movedToPath: string | null
  diff: string
  addedLineCount: number
  removedLineCount: number
}

function countRecoveredContentLines(value: string): number {
  if (!value) return 0
  const normalized = value.replace(/\r\n/g, '\n')
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  if (!trimmed) return 0
  return trimmed.split('\n').length
}

function countRecoveredPatchLines(value: string): { addedLineCount: number; removedLineCount: number } {
  let addedLineCount = 0
  let removedLineCount = 0

  for (const line of value.replace(/\r\n/g, '\n').split('\n')) {
    if (!line) continue
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue
    if (line.startsWith('+')) {
      addedLineCount += 1
      continue
    }
    if (line.startsWith('-')) {
      removedLineCount += 1
    }
  }

  return { addedLineCount, removedLineCount }
}

function isApplyPatchSectionBoundary(value: string): boolean {
  return value.startsWith('*** Update File: ')
    || value.startsWith('*** Add File: ')
    || value.startsWith('*** Delete File: ')
    || value === '*** End Patch'
}

export function parseApplyPatchInput(input: string): SessionRecoveredFileChange[] {
  const normalized = input.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const changes: SessionRecoveredFileChange[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''

    if (line.startsWith('*** Add File: ')) {
      const path = line.slice('*** Add File: '.length).trim()
      const contentLines: string[] = []
      for (index += 1; index < lines.length; index += 1) {
        const nextLine = lines[index] ?? ''
        if (isApplyPatchSectionBoundary(nextLine)) {
          index -= 1
          break
        }
        contentLines.push(nextLine.startsWith('+') ? nextLine.slice(1) : nextLine)
      }
      const diff = contentLines.join('\n').trimEnd()
      if (path) {
        changes.push({
          path,
          operation: 'add',
          movedToPath: null,
          diff,
          addedLineCount: countRecoveredContentLines(diff),
          removedLineCount: 0,
        })
      }
      continue
    }

    if (line.startsWith('*** Delete File: ')) {
      const path = line.slice('*** Delete File: '.length).trim()
      if (path) {
        changes.push({
          path,
          operation: 'delete',
          movedToPath: null,
          diff: '',
          addedLineCount: 0,
          removedLineCount: 0,
        })
      }
      continue
    }

    if (line.startsWith('*** Update File: ')) {
      const path = line.slice('*** Update File: '.length).trim()
      let movedToPath: string | null = null
      const diffLines: string[] = []

      for (index += 1; index < lines.length; index += 1) {
        const nextLine = lines[index] ?? ''
        if (nextLine.startsWith('*** Move to: ')) {
          const moved = nextLine.slice('*** Move to: '.length).trim()
          movedToPath = moved || null
          continue
        }
        if (isApplyPatchSectionBoundary(nextLine)) {
          index -= 1
          break
        }
        diffLines.push(nextLine)
      }

      const diff = diffLines.join('\n').trimEnd()
      const counts = countRecoveredPatchLines(diff)
      if (path) {
        changes.push({
          path,
          operation: 'update',
          movedToPath,
          diff,
          ...counts,
        })
      }
    }
  }

  return changes
}

export function reverseV4aDiff(fileContent: string, diffText: string): string | null {
  const fileLines = fileContent.split('\n')
  const rawDiffLines = diffText.split('\n')
  while (rawDiffLines.length > 0 && rawDiffLines[rawDiffLines.length - 1]?.trim() === '') rawDiffLines.pop()
  const diffLines = rawDiffLines
  const result = [...fileLines]

  type DiffEntry = { type: 'context' | 'add' | 'remove'; text: string }
  const hunks: DiffEntry[][] = []
  let currentHunk: DiffEntry[] | null = null

  for (const dl of diffLines) {
    if (dl.startsWith('@@')) {
      if (currentHunk) hunks.push(currentHunk)
      currentHunk = []
      continue
    }
    if (!currentHunk) continue
    if (dl.startsWith('+')) {
      currentHunk.push({ type: 'add', text: dl.slice(1) })
    } else if (dl.startsWith('-')) {
      currentHunk.push({ type: 'remove', text: dl.slice(1) })
    } else if (dl.startsWith(' ')) {
      currentHunk.push({ type: 'context', text: dl.slice(1) })
    } else {
      currentHunk.push({ type: 'context', text: dl })
    }
  }
  if (currentHunk) hunks.push(currentHunk)

  for (let hi = hunks.length - 1; hi >= 0; hi--) {
    const hunk = hunks[hi]!
    const expectedSequence = hunk
      .filter((e) => e.type === 'context' || e.type === 'add')
      .map((e) => e.text)

    if (expectedSequence.length === 0) continue

    let seqStart = -1
    outer: for (let ri = result.length - expectedSequence.length; ri >= 0; ri--) {
      for (let si = 0; si < expectedSequence.length; si++) {
        if (result[ri + si] !== expectedSequence[si]) continue outer
      }
      seqStart = ri
      break
    }

    if (seqStart < 0) return null

    const newLines: string[] = []
    let seqIdx = 0
    for (const entry of hunk) {
      if (entry.type === 'context') {
        newLines.push(result[seqStart + seqIdx]!)
        seqIdx++
      } else if (entry.type === 'add') {
        seqIdx++
      } else if (entry.type === 'remove') {
        newLines.push(entry.text)
      }
    }

    result.splice(seqStart, expectedSequence.length, ...newLines)
  }

  return result.join('\n')
}

export function applyV4aDiff(fileContent: string, diffText: string): string | null {
  const fileLines = fileContent === '' ? [] : fileContent.split('\n')
  const rawDiffLines = diffText.split('\n')
  while (rawDiffLines.length > 0 && rawDiffLines[rawDiffLines.length - 1]?.trim() === '') rawDiffLines.pop()
  const result = [...fileLines]

  type DiffEntry = { type: 'context' | 'add' | 'remove'; text: string }
  type DiffHunk = { oldStart: number; entries: DiffEntry[] }
  const hunks: DiffHunk[] = []
  let currentHunk: DiffHunk | null = null

  for (const dl of rawDiffLines) {
    const hunkMatch = dl.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/u)
    if (hunkMatch) {
      if (currentHunk) hunks.push(currentHunk)
      currentHunk = { oldStart: Math.max(Number(hunkMatch[1] ?? '1') - 1, 0), entries: [] }
      continue
    }
    if (!currentHunk) continue
    if (dl.startsWith('+')) {
      currentHunk.entries.push({ type: 'add', text: dl.slice(1) })
    } else if (dl.startsWith('-')) {
      currentHunk.entries.push({ type: 'remove', text: dl.slice(1) })
    } else if (dl.startsWith(' ')) {
      currentHunk.entries.push({ type: 'context', text: dl.slice(1) })
    } else {
      currentHunk.entries.push({ type: 'context', text: dl })
    }
  }
  if (currentHunk) hunks.push(currentHunk)

  for (const hunk of hunks) {
    const expectedSequence = hunk.entries
      .filter((e) => e.type === 'context' || e.type === 'remove')
      .map((e) => e.text)

    let seqStart = -1
    if (expectedSequence.length === 0) {
      seqStart = Math.min(hunk.oldStart, result.length)
    } else {
      const maxStart = result.length - expectedSequence.length
      if (maxStart < 0) return null
      const preferredStart = Math.min(hunk.oldStart, Math.max(maxStart, 0))
      const candidateStarts = [
        ...Array.from({ length: maxStart + 1 }, (_, index) => preferredStart + index).filter((value) => value <= maxStart),
        ...Array.from({ length: preferredStart }, (_, index) => preferredStart - index - 1),
      ]
      outer: for (const ri of candidateStarts) {
        for (let si = 0; si < expectedSequence.length; si++) {
          if (result[ri + si] !== expectedSequence[si]) continue outer
        }
        seqStart = ri
        break
      }
    }

    if (seqStart < 0) return null

    const newLines: string[] = []
    let seqIdx = 0
    for (const entry of hunk.entries) {
      if (entry.type === 'context') {
        newLines.push(result[seqStart + seqIdx]!)
        seqIdx++
      } else if (entry.type === 'remove') {
        seqIdx++
      } else if (entry.type === 'add') {
        newLines.push(entry.text)
      }
    }

    result.splice(seqStart, expectedSequence.length, ...newLines)
  }

  return result.join('\n')
}


import { expect, it, vi } from 'vitest'
import { ForkFirstTurn } from './forkFirstTurn'

it('waits for an explicit matching outcome and ignores stale or duplicate events', () => {
  const finish = vi.fn()
  const turn = new ForkFirstTurn(finish)
  turn.accepted('new')
  expect(finish).not.toHaveBeenCalled()
  turn.complete('old', true)
  expect(finish).not.toHaveBeenCalled()
  turn.complete('new', true)
  turn.complete('new', false, 'late')
  expect(finish).toHaveBeenCalledExactlyOnceWith(true, '')
})

it.each([true, false])('handles a terminal notification before the start acknowledgment (%s)', success => {
  const finish = vi.fn()
  const turn = new ForkFirstTurn(finish)
  turn.complete('old', true)
  turn.complete('new', success, 'schema')
  expect(finish).not.toHaveBeenCalled()
  turn.accepted('new')
  expect(finish).toHaveBeenCalledExactlyOnceWith(success, 'schema')
})

it('does not infer success or replay when a turn ID is unavailable', () => {
  const finish = vi.fn()
  const turn = new ForkFirstTurn(finish)
  turn.complete('', false)
  turn.accepted('')
  expect(finish).not.toHaveBeenCalled()
})

it('keeps a definitive early error even if a contradictory completion follows before acknowledgment', () => {
  const finish = vi.fn()
  const turn = new ForkFirstTurn(finish)
  turn.complete('new', false, 'schema rejected')
  turn.complete('new', true)
  turn.accepted('new')
  expect(finish).toHaveBeenCalledExactlyOnceWith(false, 'schema rejected')
})

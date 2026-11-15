import { expect, it } from 'vitest'
import { generationMetadataLabel, type TurnGenerationMetadata } from './turnGenerationMetadata'

it.each<{ metadata?: TurnGenerationMetadata; label: string }>([
  { label: 'Model unknown · reasoning: unknown' },
  { metadata: { model: null, effort: null }, label: 'Model unspecified · reasoning: unspecified' },
  { metadata: { model: 'historical-A', effort: 'high', modelSource: 'execution', effortSource: 'execution' }, label: 'historical-A · reasoning: high' },
  { metadata: { model: 'historical-B', effort: 'none', modelSource: 'execution', effortSource: 'execution' }, label: 'historical-B · reasoning: none' },
  { metadata: { model: 'requested', effort: 'low', modelSource: 'submitted', effortSource: 'submitted' }, label: 'requested (sent setting) · reasoning: low (sent setting)' },
])('displays per-turn metadata as $label', ({ metadata, label }) => {
  expect(generationMetadataLabel(metadata)).toBe(label)
})

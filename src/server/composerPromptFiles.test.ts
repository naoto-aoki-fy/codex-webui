import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createComposerPromptFile, listComposerPrompts, removeComposerPromptFile } from './composerPromptFiles.js'

let root: string
let directory: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'composer-prompts-'))
  directory = join(root, 'prompts')
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('composer prompt files', () => {
  it('returns an empty list for a missing directory', async () => {
    expect(await listComposerPrompts(directory)).toEqual([])
  })

  it('sanitizes names, trims content and allocates suffixes without overwriting', async () => {
    const first = await createComposerPromptFile(directory, ' demo/plan.MD ', ' \n# Plan\ntext  ')
    const second = await createComposerPromptFile(directory, 'demo/plan.md', 'second')
    expect(first).toEqual({ name: 'demo plan', path: join(directory, 'demo plan.md'), content: '# Plan\ntext\n', description: '# Plan' })
    expect(second.path).toBe(join(directory, 'demo plan-2.md'))
    expect(await readFile(first.path, 'utf8')).toBe(first.content)
  })

  it('lists only markdown files, sorted by name, with bounded descriptions', async () => {
    await mkdir(directory)
    await writeFile(join(directory, 'z.MD'), '\n  ' + 'x'.repeat(140) + '\n')
    await writeFile(join(directory, 'a.md'), 'alpha')
    await writeFile(join(directory, 'ignored.txt'), 'ignored')
    await mkdir(join(directory, 'nested.md'))
    const prompts = await listComposerPrompts(directory)
    expect(prompts.map((prompt) => prompt.name)).toEqual(['a', 'z'])
    expect(prompts[1]?.description).toBe('x'.repeat(120))
  })

  it('rejects empty names and content', async () => {
    await expect(createComposerPromptFile(directory, ' ', 'text')).rejects.toThrow('Prompt name is required')
    await expect(createComposerPromptFile(directory, 'name', ' ')).rejects.toThrow('Prompt content is required')
  })

  it('removes a prompt and returns false when already missing', async () => {
    const prompt = await createComposerPromptFile(directory, 'demo', 'text')
    expect(await removeComposerPromptFile(directory, prompt.path)).toBe(true)
    expect(await removeComposerPromptFile(directory, prompt.path)).toBe(false)
  })

  it('preserves deletion path restrictions and leaves outside files intact', async () => {
    const outside = join(root, 'outside.md')
    await writeFile(outside, 'keep')
    for (const path of [outside, join(root, 'prompts-other', 'file.md'), join(directory, 'file.txt'), directory, join(directory, '..', 'outside.md')]) {
      await expect(removeComposerPromptFile(directory, path)).rejects.toThrow('Invalid prompt path')
    }
    expect(await readFile(outside, 'utf8')).toBe('keep')
  })

  it('propagates filesystem failures other than missing files', async () => {
    await writeFile(directory, 'not a directory')
    await expect(listComposerPrompts(directory)).rejects.toMatchObject({ code: 'ENOTDIR' })
    await expect(createComposerPromptFile(directory, 'demo', 'text')).rejects.toMatchObject({ code: 'EEXIST' })
  })
})

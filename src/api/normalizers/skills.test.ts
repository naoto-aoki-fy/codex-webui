import { describe, expect, it } from 'vitest'
import { deriveGroupedSkillRoot, normalizeSkillMarkdownPath, normalizeSkillsList, type SkillsListResponseEntry } from './skills'

type Skill = SkillsListResponseEntry['skills'][number]
const skill = (path: string, overrides: Partial<Skill> = {}): Skill => ({ name: 'skill', description: 'description', path, scope: 'user', enabled: true, ...overrides })
const entries = (...skills: Skill[]): SkillsListResponseEntry[] => [{ cwd: '/project', skills, errors: [] }]

describe('Skills path normalization', () => {
  it.each([
    ['', ''], ['relative', 'relative/SKILL.md'], ['/absolute/SKILL.md', '/absolute/SKILL.md'],
    ['/trailing/', '/trailing//SKILL.md'], ['SKILL.md', 'SKILL.md/SKILL.md'],
    ['C:\\skills\\one', 'C:\\skills\\one/SKILL.md'],
  ])('preserves literal path semantics for %j', (input, expected) => {
    expect(normalizeSkillMarkdownPath(input)).toBe(expected)
  })

  it('derives nested roots without requiring their existence and preserves relative-root quirks', () => {
    expect(deriveGroupedSkillRoot('/a/skills/root/child', new Set())).toEqual({ rootPath: '/a/skills/root/SKILL.md', rootName: 'root', isNested: true })
    expect(deriveGroupedSkillRoot('skills/root', new Set())).toEqual({ rootPath: '/skills/root/SKILL.md', rootName: 'root', isNested: true })
    for (const path of ['', '/', '/skills', '/ordinary']) expect(deriveGroupedSkillRoot(path, new Set())).toBeNull()
  })

  it('prefers a known plugin root over the first skills directory', () => {
    const root = '/skills/cache/plugin/1/skills/plugin/SKILL.md'
    const path = '/skills/cache/plugin/1/skills/child'
    expect(deriveGroupedSkillRoot(path, new Set([root]))).toEqual({ rootPath: root, rootName: 'plugin', isNested: true })
    expect(deriveGroupedSkillRoot(path, new Set())?.rootName).toBe('cache')
  })
})

describe('Skills presentation normalization', () => {
  it('returns fresh empty lists', () => {
    expect(normalizeSkillsList([])).toEqual([])
    expect(normalizeSkillsList(entries())).toEqual([])
    expect(normalizeSkillsList([])).not.toBe(normalizeSkillsList([]))
  })

  it('copies only public fields and preserves optional undefined values and fallback descriptions', () => {
    const input = skill('/a', { shortDescription: 'short' })
    Object.assign(input, { extra: 'ignored', displayName: 'ignored' })
    const output = normalizeSkillsList(entries(input, skill('/b', { shortDescription: '', description: '' })))
    expect(output).toEqual([
      { name: 'skill', displayName: undefined, description: 'short', path: '/a/SKILL.md', scope: 'user', enabled: true },
      { name: 'skill', displayName: undefined, description: '', path: '/b/SKILL.md', scope: 'user', enabled: true },
    ])
    expect(output[0]).toHaveProperty('displayName', undefined)
    expect(output[0]).not.toBe(input)
  })

  it('skips missing names, defaults missing descriptions, and preserves missing metadata', () => {
    const malformed = { path: '', enabled: undefined } as unknown as Skill
    expect(normalizeSkillsList(entries(malformed))).toEqual([])
    const [result] = normalizeSkillsList(entries({ ...malformed, name: 'named' }))
    expect(result).toEqual({ name: 'named', displayName: undefined, description: '', path: '', scope: undefined, enabled: undefined })
  })

  it('keeps encounter ordering rather than sorting names, groups, or entries', () => {
    const result = normalizeSkillsList([
      ...entries(skill('/skills/z', { name: 'z' }), skill('/skills/z/child'), skill('/skills/a/child', { name: 'b' })),
      ...entries(skill('/skills/a', { name: 'a' }), skill('/relative', { name: 'c' })),
    ])
    expect(result.map(s => s.name)).toEqual(['z', 'a', 'c'])
    expect(result.map(s => s.displayName)).toEqual(['z', 'a', undefined])
  })

  it('retains nested paths when roots are absent, including relative paths', () => {
    expect(normalizeSkillsList(entries(skill('/skills/a/child'), skill('skills/a'))).map(s => [s.path, s.displayName])).toEqual([
      ['/skills/a/child/SKILL.md', undefined], ['skills/a/SKILL.md', undefined],
    ])
  })

  it('collapses plugin children into the known plugin root', () => {
    const root = '/cache/plugin/1/skills/plugin'
    const result = normalizeSkillsList(entries(skill('/cache/plugin/1/skills/child'), skill(root, { name: 'root' })))
    expect(result).toEqual([{ name: 'root', displayName: 'plugin', description: 'description', path: `${root}/SKILL.md`, scope: 'user', enabled: true }])
  })

  it('keeps first duplicate metadata, fills empty descriptions, and ORs enabled values', () => {
    const result = normalizeSkillsList(entries(
      skill('/same', { name: 'first', description: '', enabled: false }),
      skill('/same/SKILL.md', { name: 'second', shortDescription: 'filled', scope: 'system' }),
      skill('/same', { description: 'conflict', enabled: false }),
    ))
    expect(result).toEqual([{ name: 'first', displayName: undefined, description: 'filled', path: '/same/SKILL.md', scope: 'user', enabled: true }])
  })

  it('replaces a child with a later root, even losing the accumulated enabled value', () => {
    const child = skill('/skills/root/child', { enabled: true })
    const root = skill('/skills/root', { name: 'root', description: 'root description', enabled: false, scope: 'system' })
    const [laterRoot] = normalizeSkillsList(entries(child, root))
    expect(laterRoot).toMatchObject({ name: 'root', description: 'root description', enabled: false, scope: 'system' })
    expect(normalizeSkillsList(entries(root, child))[0]?.enabled).toBe(true)
  })

  it('does not mutate frozen input and allocates fresh arrays and records per call', () => {
    const input = entries(skill('/skills/root/child'), skill('/skills/root'))
    input.forEach(entry => { entry.skills.forEach(Object.freeze); Object.freeze(entry.skills); Object.freeze(entry.errors); Object.freeze(entry) })
    Object.freeze(input)
    const first = normalizeSkillsList(input)
    const second = normalizeSkillsList(input)
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(second[0]).not.toBe(first[0])
    expect(first[0]).not.toBe(input[0]!.skills[1])
  })

  it.each([undefined, null, false])('preserves falsy malformed paths %j as empty keys', (path) => {
    expect(normalizeSkillsList(entries(skill(path as unknown as string)))[0]?.path).toBe('')
  })

  it('uses even unnamed entries when detecting known roots', () => {
    expect(normalizeSkillsList(entries(skill('/skills/root', { name: '' }), skill('/skills/root/child')))[0]).toMatchObject({ path: '/skills/root/SKILL.md', displayName: 'root' })
  })

  it('leaves invalid truthy paths as errors rather than silently repairing them', () => {
    expect(() => normalizeSkillsList(entries(skill(42 as unknown as string)))).toThrow(TypeError)
  })
})

it('keeps remote drive and UNC skill file paths and groups Windows nested skills', () => {
  const root = 'D:\\Users\\remote\\.codex\\skills\\sample\\SKILL.md'
  expect(normalizeSkillMarkdownPath(root)).toBe(root)
  const unc = '\\\\server\\share\\skills\\sample\\SKILL.md'
  expect(normalizeSkillMarkdownPath(unc)).toBe(unc)
  expect(normalizeSkillsList(entries(skill(root), skill('D:\\Users\\remote\\.codex\\skills\\sample\\child')))).toHaveLength(1)
})

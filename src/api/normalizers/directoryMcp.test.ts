import { describe, expect, it } from 'vitest'
import { normalizeDirectoryMcpServer } from './directoryMcp'

const empty = (name = 'server') => ({ name, authStatus: 'unsupported', tools: [], resources: [], resourceTemplates: [] })

describe('directory MCP normalization', () => {
  it.each([null, undefined, false, true, 42, 'server', [], {}, { name: '' }, { name: 42 }, { serverName: 'alias' }])('rejects missing/invalid names in %j', (value) => {
    expect(normalizeDirectoryMcpServer(value)).toBeNull()
  })

  it('preserves whitespace and all supported metadata without mutating input', () => {
    const tool = Object.freeze({ name: ' tool ', title: 'Title', description: 'Description' })
    const resource = Object.freeze({ name: 'resource', title: 'Resource', uri: 'test://resource', description: 'Details' })
    const template = Object.freeze({ name: 'template', title: 'Template', uriTemplate: 'test://{id}', description: 'Pattern' })
    const input = Object.freeze({ name: ' server ', authStatus: ' loggedIn ', tools: Object.freeze({ fallback: tool }), resources: Object.freeze([resource]), resourceTemplates: Object.freeze([template]) })
    expect(normalizeDirectoryMcpServer(input)).toEqual({ name: ' server ', authStatus: ' loggedIn ', tools: [tool], resources: [resource], resourceTemplates: [template] })
    expect(normalizeDirectoryMcpServer({ name: ' ' })).toEqual(empty(' '))
    expect(input.tools.fallback).toBe(tool)
    expect(input.resources[0]).toBe(resource)
    expect(input.resourceTemplates[0]).toBe(template)
  })

  it('supports snake-case aliases and nullish camel-case fallback', () => {
    expect(normalizeDirectoryMcpServer({ name: 'server', authStatus: null, auth_status: 'notLoggedIn', resourceTemplates: null, resource_templates: [{ uriTemplate: null, uri_template: 'test://{id}' }] })).toEqual({ ...empty(), authStatus: 'notLoggedIn', resourceTemplates: [{ name: '', title: '', uriTemplate: 'test://{id}', description: '' }] })
    expect(normalizeDirectoryMcpServer({ name: 'server', authStatus: '', auth_status: 'ignored', resourceTemplates: [], resource_templates: [{ name: 'ignored' }] })).toEqual(empty())
    expect(normalizeDirectoryMcpServer({ name: 'server', resourceTemplates: [{ name: 'kept', uriTemplate: '', uri_template: 'ignored' }] })?.resourceTemplates[0]?.uriTemplate).toBe('')
  })

  it.each([undefined, null, '', 42, false, {}, []])('uses default authentication for %j and ignores unrelated status fields', (authStatus) => {
    expect(normalizeDirectoryMcpServer({ name: 'server', authStatus, status: 'ready', authentication: { status: 'loggedIn' } })).toEqual(empty())
  })

  it('keeps tool entry order, duplicate names and key fallbacks', () => {
    expect(normalizeDirectoryMcpServer({ name: 'server', tools: { z: { name: 'same', title: ' ' }, a: { name: 'same' }, blank: { name: '', title: 1, description: false }, null: null, primitive: 7, array: [], space: { name: ' ' } } })?.tools).toEqual([
      { name: 'same', title: ' ', description: '' }, { name: 'same', title: '', description: '' },
      ...['blank', 'null', 'primitive', 'array', ' '].map((name) => ({ name, title: '', description: '' })),
    ])
  })

  it.each([undefined, null, [], '', 42, false, {}])('normalizes empty/malformed collections in %j', (value) => {
    expect(normalizeDirectoryMcpServer({ name: 'server', tools: value, resources: value, resourceTemplates: value })).toEqual(empty())
  })

  it('filters resources/templates only by name or URI and preserves duplicates and order', () => {
    const resource = { name: '', title: '', uri: 'uri', description: '' }
    const template = { name: '', title: '', uriTemplate: 'pattern', description: '' }
    const malformed = [null, 7, false, [], {}, { title: 'only' }, { name: 1, uri: 2, uriTemplate: 3 }]
    expect(normalizeDirectoryMcpServer({ name: 'server', resources: [...malformed, resource, { name: 'named', title: 1 }, resource], resource_templates: [...malformed, template, { name: 'named', description: false }, template] })).toEqual({
      ...empty(), resources: [resource, { name: 'named', title: '', uri: '', description: '' }, resource],
      resourceTemplates: [template, { name: 'named', title: '', uriTemplate: '', description: '' }, template],
    })
  })
})

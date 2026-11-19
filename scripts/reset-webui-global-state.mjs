const transferKey = 'conversation-transfers-v1'

export function readGlobalStateReset(raw, path) {
  let state
  try { state = JSON.parse(raw) } catch { throw new Error(`Invalid global JSON. Preserving ${path}`) }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error(`Invalid global JSON object. Preserving ${path}`)
  }

  // Keep retained members byte-for-byte, including large numbers, key spelling,
  // and whitespace within values. JSON.parse alone can round native numbers.
  const members = []
  const seen = new Set()
  let depth = 0
  let start
  let end
  let key
  for (const token of raw.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\],]/gsu)) {
    const [value] = token
    if (depth === 1 && (value === ',' || value === '}')) {
      if (key !== undefined) members.push({ key, raw: raw.slice(start, token.index) })
      key = undefined
      start = token.index + 1
    } else if (depth === 1 && key === undefined && value.startsWith('"')) {
      key = JSON.parse(value)
      if (seen.has(key)) throw new Error(`Duplicate global JSON key. Preserving ${path}`)
      seen.add(key)
    }
    if (value === '{' || value === '[') {
      if (depth === 0) start = token.index + 1
      depth++
    }
    if (value === '}' || value === ']') {
      depth--
      if (depth === 0) end = token.index
    }
  }
  function select(additionalKeys = []) {
    const removed = new Set([transferKey, ...additionalKeys])
    const keys = members.filter(member => removed.has(member.key)).map(member => member.key)
    const preserved = members.filter(member => !removed.has(member.key))
    return {
      keys,
      preserved: preserved.map(member => member.key),
      replacement: raw.slice(0, raw.indexOf('{') + 1) + preserved.map(member => member.raw).join(',') + raw.slice(end),
    }
  }
  return {
    // Expose only keys outside the standard policy to historical validators.
    get historicalState() { return Object.fromEntries(Object.entries(state).filter(([name]) => name !== transferKey)) },
    select,
  }
}

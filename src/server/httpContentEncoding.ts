export function encodingPreferences<Encoding extends string>(
  header: string | undefined,
  encodings: readonly (Encoding | 'identity')[],
): (Encoding | 'identity')[][] {
  if (!header?.trim()) return [['identity']]
  const values = new Map<string, number>()
  for (const item of header.split(',')) {
    const [name, ...params] = item.toLowerCase().split(';').map(part => part.trim())
    if (!name) continue
    let q = 1
    for (const param of params) {
      const match = /^q\s*=\s*(.*)$/.exec(param)
      if (!match) continue
      const raw = match[1]
      q = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(raw) ? Math.min(q, Number(raw)) : 0
    }
    values.set(name, Math.min(values.get(name) ?? 1, q))
  }

  const wildcard = values.get('*')
  const groups = new Map<number, (Encoding | 'identity')[]>()
  for (const encoding of encodings) {
    const q = values.get(encoding) ?? (encoding === 'identity' ? 0 : wildcard ?? 0)
    if (q === 0) continue
    const group = groups.get(q)
    if (group) group.push(encoding)
    else groups.set(q, [encoding])
  }
  const preferences = [...groups].sort(([a], [b]) => b - a).map(([, group]) => group)
  // With no explicit identity weight, use it only as an acceptable fallback.
  if (!values.has('identity') && wildcard !== 0) preferences.push(['identity'])
  return preferences
}

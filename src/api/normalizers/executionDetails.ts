import type { UiMessage } from '../../types/codex'

const LIMIT = 12_000
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
export function executionText(value: unknown): string {
  let remaining = LIMIT, nodes = 0
  function clean(value: unknown, depth: number): unknown {
    if (++nodes > 200 || remaining <= 0 || depth > 5) return '[details bounded]'
    if (typeof value === 'string') {
      const text = value.slice(0, remaining)
        .replace(/\b(?:authorization|cookie|bearer|basic)\s*[:= ]\s*[^\r\n]+/gi, '[credential omitted]')
        .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[credentials omitted]@')
        .replace(/\bsk-[\w-]+/g, '[key omitted]')
        .replace(/\b([\w-]*(?:token|secret|password|api[_-]?key|credential)[\w-]*)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[redacted]')
      remaining -= text.length
      return text
    }
    if (Array.isArray(value)) return value.slice(0, 40).map(v => clean(v, depth + 1))
    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {}
      let keys = 0
      for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value,key)) continue
        if (++keys > 40) break
        if (/meta|instruction|credential|secret|password|token|api.?key|authorization|cookie/i.test(key)) continue
        result[key.slice(0, 100)] = clean((value as Record<string, unknown>)[key], depth + 1)
      }
      return result
    }
    return value
  }
  const safe = clean(value, 0)
  return (typeof safe === 'string' ? safe : JSON.stringify(safe, null, 2) ?? 'Unavailable').slice(0, LIMIT)
}
export function normalizeExecutionItem(value: unknown, phase?: 'started' | 'completed'): UiMessage | null {
  const item = record(value)
  if (typeof item.id !== 'string' || !item.id) return null
  const type = item.type
  if (type === 'enteredReviewMode' || type === 'exitedReviewMode') return {id:item.id, role:type==='exitedReviewMode'?'assistant':'system', messageType:type, executionLabel:type==='enteredReviewMode'?'Native review started':'Native review results', text:executionText(item.review ?? 'Review details unavailable')}
  if (type !== 'mcpToolCall' && type !== 'webSearch') return null
  const status = type === 'mcpToolCall' && ['inProgress', 'completed', 'failed'].includes(String(item.status))
    ? String(item.status) : phase === 'started' ? 'inProgress' : phase === 'completed' ? 'completed' : 'unavailable'
  const label = type === 'mcpToolCall' ? `MCP · ${executionText(item.server || 'unknown server')} · ${executionText(item.tool || 'unknown tool')}` : 'Web search'
  const details: string[] = []
  if (type === 'mcpToolCall') {
    details.push(`Arguments: ${item.arguments == null ? 'Unavailable' : executionText(item.arguments)}`)
    const result = record(item.result)
    // Render only public text blocks. Never expose _meta, UI resources or opaque diagnostics.
    const content = Array.isArray(result.content) ? result.content.slice(0, 40) : null
    details.push(`Results: ${!content ? 'Unavailable' : content.length === 0 ? 'Empty result' : content.map(block => {
      const row = record(block)
      return row.type === 'text' && typeof row.text === 'string' ? executionText(row.text) : '[non-text content omitted]'
    }).join('\n')}`)
    if (item.error != null) details.push(`Error: ${executionText(record(item.error).message ?? 'Unavailable')}`)
  } else {
    const action = record(item.action)
    details.push(`Query: ${typeof item.query === 'string' ? executionText(item.query) : 'Unavailable'}`)
    details.push(`Action: ${executionText({ type: action.type, query: action.query, queries: action.queries, url: action.url, pattern: action.pattern })}`)
    details.push(`Results: ${!Array.isArray(item.results) ? 'Unavailable' : item.results.length === 0 ? 'Empty result' : executionText(item.results.slice(0, 40).map(value => {
      const row = record(value)
      return { title: row.title, url: row.url, snippet: row.snippet, text: row.text }
    }))}`)
  }
  return { id: item.id, role: 'system', messageType: String(type), text: `${label}\nStatus: ${status}\n${details.join('\n')}`.slice(0, LIMIT), executionLabel: label.slice(0, 200) }
}

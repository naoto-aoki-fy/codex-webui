/** Turn a synthetic thread snapshot into native pagination replies for adapter
 * tests. This is fixture transport data, never a production history fallback. */
export function nativeHistoryResponse(method: string, params: any, snapshot: any): any {
  if (method !== 'thread/turns/list') return snapshot
  const turns = snapshot.thread.turns
  const sorted = params.sortDirection === 'desc' ? [...turns].reverse() : turns
  const offset = Number(params.cursor ?? 0)
  const end = offset + params.limit
  return {
    data: sorted.slice(offset, end).map((turn: any) => params.itemsView === 'notLoaded' ? { ...turn, items: [] } : turn),
    nextCursor: end < turns.length ? String(end) : null,
  }
}

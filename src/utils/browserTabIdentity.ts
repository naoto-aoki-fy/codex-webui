import { clientMessageId } from './clientMessageId'

// A duplicated tab inherits sessionStorage. A document writer never does: even
// identical session IDs/pointers cannot give two live documents the same key.
let identity: { tabId: string; writerId: string } | undefined
export function browserTabIdentity() {
  if (identity) return identity
  let tabId = ''
  try { tabId = window.sessionStorage.getItem('codex-web-local.tab-id.v1') || '' } catch { /* Private mode. */ }
  if (!/^[\w-]{1,100}$/.test(tabId)) tabId = clientMessageId()
  identity = { tabId, writerId: clientMessageId() }
  try { window.sessionStorage.setItem('codex-web-local.tab-id.v1', tabId) } catch { /* Unique writer still isolates drafts. */ }
  return identity
}

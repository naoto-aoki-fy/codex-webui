/** Native client message IDs are correlation identifiers, not authentication tokens. */
export function clientMessageId():string {
 if(typeof globalThis.crypto?.randomUUID==='function')return globalThis.crypto.randomUUID()
 // getRandomValues is available on supported HTTP LAN origins where randomUUID is not.
 if(typeof globalThis.crypto?.getRandomValues!=='function')throw new Error('Random client identifiers are unavailable in this browser; no prompt was queued')
 const bytes=globalThis.crypto.getRandomValues(new Uint8Array(16))
 bytes[6]=(bytes[6]!&15)|64;bytes[8]=(bytes[8]!&63)|128
 const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('')
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}

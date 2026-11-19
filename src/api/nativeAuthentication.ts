import { rpcCall } from './codexRpcClient'

export type LoginMethod = 'chatgpt' | 'chatgptDeviceCode'
export type NativeLogin = { id: string; url: string; code: string | null }

export async function verifyIdleForLogin(isCurrent: () => boolean): Promise<void> {
  const inventory = await rpcCall<{ data?: unknown[]; nextCursor?: unknown }>('thread/loaded/list', { limit: 21 })
  const ids = inventory?.data
  if (!Array.isArray(ids) || ids.length > 20 || inventory.nextCursor !== null
    || ids.some(id => typeof id !== 'string' || !id || id.length > 2000) || new Set(ids).size !== ids.length) {
    throw new Error('Check loaded conversations on the App Server before signing in. WebUI could not verify idle activity.')
  }

  for (let start = 0; start < ids.length; start += 4) {
    if (!isCurrent()) throw new Error('Connection or activity changed before sign-in.')
    await Promise.all(ids.slice(start, start + 4).map(async threadId => {
      const { thread } = await rpcCall<{ thread?: { id: string; status?: { type: string } } }>('thread/read', {
        threadId, includeTurns: false,
      })
      if (thread?.id !== threadId || thread?.status?.type !== 'idle') {
        throw new Error('Finish active conversations before signing in.')
      }
    }))
  }
}

function loginUrl(value:unknown){
 if(typeof value!=='string'||value.length>8000)throw new Error('Native login URL unavailable')
 let url:URL;try{url=new URL(value)}catch{throw new Error('Native login URL is invalid')}
 if(url.username||url.password||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Native login URL scheme/credentials are unsafe to open')
 return value
}
export function nativeLogin(value:unknown,method:LoginMethod):NativeLogin{
 const row=value as Record<string,unknown>
 if(!row||row.type!==method||typeof row.loginId!=='string'||!row.loginId||row.loginId.length>2000)throw new Error('Native login identity/method unavailable; outcome may be unknown')
 const code=method==='chatgptDeviceCode'?row.userCode:null
 if(code!==null&&(typeof code!=='string'||!code||code.length>200||/[\x00-\x1f\x7f]/.test(code)))throw new Error('Native device code unavailable')
 return {id:row.loginId,url:loginUrl(method==='chatgpt'?row.authUrl:row.verificationUrl),code:code as string|null}
}

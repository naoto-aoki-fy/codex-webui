import {rpcCall} from './codexRpcClient'
import {accountInspection,loginMethodsInspection} from './authInspection'
export type AuthRequest=(method:string,params:unknown)=>Promise<unknown>
export type NativeAccount=ReturnType<typeof accountInspection>
export type AuthPreparation={account:NativeAccount;methods:string[];loadedCount:number;checkedAt:string}
export type LoginMethod='chatgpt'|'chatgptDeviceCode'
export type NativeLogin={id:string;url:string;code:string|null}
export async function readAuthenticationAccount(request:AuthRequest=rpcCall){return accountInspection(await request('account/read',{refreshToken:false}))}
export async function prepareAuthentication(request:AuthRequest=rpcCall):Promise<AuthPreparation>{
 const [account,rawPolicy]=await Promise.all([readAuthenticationAccount(request),request('configRequirements/read',{})])
 const methods=loginMethodsInspection(rawPolicy)
 if(account.type!=='signedOut')throw new Error('This sign-in workflow requires a signed-out native default provider. Existing account switching remains external or uses the separate Logout action.')
 if(!account.requiresAuth||!methods?.includes('chatgpt'))throw new Error('Native ChatGPT sign-in is unavailable or its effective login policy is unknown')
 const loaded=await request('thread/loaded/list',{limit:21}) as {data?:unknown[];nextCursor?:unknown}
 if(!Array.isArray(loaded?.data)||loaded.data.length>20||loaded.nextCursor!==null)throw new Error('A complete inventory of at most 20 loaded threads is required here. Inspect authentication externally when this bound is exceeded.')
 const ids=loaded.data
 if(ids.some(id=>typeof id!=='string'||!id||id.length>2000)||new Set(ids).size!==ids.length)throw new Error('Native loaded-thread identities unavailable')
 let index=0,aborted=false
 await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{
  try{while(!aborted&&index<ids.length){const id=ids[index++] as string,result=await request('thread/read',{threadId:id,includeTurns:false}) as {thread?:{id?:unknown;status?:{type?:unknown}}}
    if(result?.thread?.id!==id||result.thread.status?.type!=='idle')throw new Error('A loaded thread is active or its activity is unknown. Finish work before changing native authentication')
   }}catch(e){aborted=true;throw e}
 }))
 return {account,methods,loadedCount:ids.length,checkedAt:new Date().toISOString()}
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

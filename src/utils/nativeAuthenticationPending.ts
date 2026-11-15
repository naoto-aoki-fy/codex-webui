import {profileStorageKey} from './browserConnectionProfile'
const key=()=>profileStorageKey('codex-web-local.native-authentication-pending.v1')
// A recovery barrier only. Never store account identity, codes, URLs or tokens.
export function hasPendingNativeAuthentication(){
 try{return typeof window!=='undefined'&&window.localStorage.getItem(key())==='1'}catch{return false}
}
export function persistNativeAuthenticationPending(pending:boolean){
 if(typeof window==='undefined')return
 if(pending)window.localStorage.setItem(key(),'1')
 else window.localStorage.removeItem(key())
}

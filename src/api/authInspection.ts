import {rpcCall} from './codexRpcClient'
import {executionText} from './normalizers/executionDetails'
export function accountInspection(value:unknown){
 const result=value as Record<string,unknown>
 if(!result||!Object.prototype.hasOwnProperty.call(result,'account')||typeof result.requiresOpenaiAuth!=='boolean')throw new Error('Native account state unavailable')
 if(result.account===null)return {type:'signedOut',email:null,plan:null,workspace:null,requiresAuth:result.requiresOpenaiAuth}
 const account=result.account as Record<string,unknown>
 if(!account||typeof account.type!=='string')throw new Error('Incompatible native account identity')
 const text=(v:unknown)=>typeof v==='string'?executionText(v.slice(0,300)):null
 return {type:account.type.slice(0,100),email:text(account.email),plan:text(account.planType),workspace:text(account.workspaceName),requiresAuth:result.requiresOpenaiAuth}
}
export function loginMethodsInspection(value:unknown){const result=value as {requirements?:{allowed_login_methods?:unknown}|null}
 const methods=result?.requirements?.allowed_login_methods
 if(!Array.isArray(methods))return null
 if(methods.length>20||methods.some(v=>typeof v!=='string'||v.length>100))throw new Error('Incompatible native login-method restrictions')
 return methods as string[]
}
export async function readNativeAccount(){return accountInspection(await rpcCall('account/read',{refreshToken:false}))}
export async function readLoginMethods(){return loginMethodsInspection(await rpcCall('configRequirements/read',{}))}

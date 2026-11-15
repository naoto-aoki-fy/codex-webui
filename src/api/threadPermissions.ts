import {rpcCall} from './codexRpcClient'
import {requirementsInspection} from './configInspection'
export type PermissionChoices={approvals:string[];sandboxes:string[]}
export function permissionChoices(value:unknown):PermissionChoices|null{
 const result=value as {requirements?:Record<string,unknown>|null}
 if(!result||!Object.prototype.hasOwnProperty.call(result,'requirements'))return null
 if(result.requirements===null)return {approvals:['on-request','never'],sandboxes:['readOnly','workspaceWrite','dangerFullAccess']}
 const r=result.requirements
 if(!r||!['allowed_approval_policies','allowed_sandbox_modes','allowed_permission_profiles'].every(k=>Object.prototype.hasOwnProperty.call(r,k)))return null
 if(r.allowed_approval_policies!=null&&!Array.isArray(r.allowed_approval_policies)||r.allowed_sandbox_modes!=null&&!Array.isArray(r.allowed_sandbox_modes))return null
 const nativeNames:Record<string,string>={readOnly:'read-only',workspaceWrite:'workspace-write',dangerFullAccess:'danger-full-access'}
 return {approvals:['on-request','never'].filter(v=>r.allowed_approval_policies===null||(r.allowed_approval_policies as unknown[]).includes(v)),sandboxes:r.allowed_permission_profiles!=null?[]:Object.keys(nativeNames).filter(v=>r.allowed_sandbox_modes===null||(r.allowed_sandbox_modes as unknown[]).includes(nativeNames[v]))}
}
export async function readPermissionConfiguration(){const value=await rpcCall('configRequirements/read',{});return {choices:permissionChoices(value),display:requirementsInspection(value)}}
export function permissionPatch(approval:string,sandbox:string){
 const patch:Record<string,unknown>={}
 if(approval){if(!['on-request','never'].includes(approval))throw new Error('Unsupported approval choice');patch.approvalPolicy=approval}
 if(sandbox){if(!['readOnly','workspaceWrite','dangerFullAccess'].includes(sandbox))throw new Error('Unsupported sandbox choice');patch.sandboxPolicy=sandbox==='dangerFullAccess'?{type:sandbox}:sandbox==='readOnly'?{type:sandbox,networkAccess:false}:{type:sandbox,writableRoots:[],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true}}
 if(!Object.keys(patch).length)throw new Error('Select a permission change')
 return patch
}

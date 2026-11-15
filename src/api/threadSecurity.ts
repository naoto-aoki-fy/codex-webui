import {executionText} from './normalizers/executionDetails'
export type ThreadSecurity={cwd:string;approval:string;reviewer:string;sandbox:string;profile:string;observed:string;approvalMode:string|null;sandboxChoice:string|null}
export function threadSecurity(value:unknown):ThreadSecurity|null {
 const row=value as Record<string,unknown>
 if(!row||typeof row!=='object'||!('approvalPolicy' in row)&&!('sandbox' in row)&&!('sandboxPolicy' in row)&&!('activePermissionProfile' in row))return null
 const sandbox=(row.sandboxPolicy??row.sandbox) as Record<string,unknown>|undefined
 const choice=sandbox?.type==='dangerFullAccess'?'dangerFullAccess':sandbox?.type==='readOnly'&&sandbox.networkAccess===false?'readOnly':sandbox?.type==='workspaceWrite'&&sandbox.networkAccess===false&&Array.isArray(sandbox.writableRoots)&&sandbox.writableRoots.length===0&&sandbox.excludeTmpdirEnvVar===true&&sandbox.excludeSlashTmp===true?'workspaceWrite':null
 return {cwd:executionText(row.cwd??'Unavailable').slice(0,2000),approval:executionText(row.approvalPolicy??'Unknown'),reviewer:executionText(row.approvalsReviewer??'Unknown'),sandbox:executionText(row.sandboxPolicy??row.sandbox??'Unknown'),profile:executionText(row.activePermissionProfile??'Unknown'),observed:new Date().toISOString(),approvalMode:typeof row.approvalPolicy==='string'?row.approvalPolicy:null,sandboxChoice:choice}
}

import {readBrowserRecord,updateBrowserRecord} from './browserTransactionalRecords'
import {profileStorageKey} from './browserConnectionProfile'
export type TextPreset={id:string;name:string;text:string}
export type PromptLibrary={presets:TextPreset[];history:string[]}
export const PROMPT_TEXT_LIMIT=8000
const key=()=>profileStorageKey('codex-web-local.prompt-library.v1')
function loadLegacyPromptLibrary():PromptLibrary {
 const raw=window.localStorage.getItem(key())
 if(!raw)return {presets:[],history:[]}
 if(raw.length>450_000)throw new Error('Prompt storage exceeds its safety limit. Clear it explicitly.')
 return normalizeLibrary(JSON.parse(raw))
}
function normalizeLibrary(value:any):PromptLibrary {
 if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(value).length>450_000)throw new Error('Invalid prompt storage')
 return {presets:Array.isArray(value.presets)?value.presets.slice(0,20).filter((p:TextPreset)=>p&&typeof p.id==='string'&&p.id.length<=100&&typeof p.name==='string'&&p.name.length<=80&&typeof p.text==='string'&&p.text.length<=PROMPT_TEXT_LIMIT):[],history:Array.isArray(value.history)?value.history.slice(0,30).filter((text:unknown)=>typeof text==='string'&&text.length<=PROMPT_TEXT_LIMIT):[]}
}
export async function loadPromptLibrary():Promise<PromptLibrary>{return normalizeLibrary(await readBrowserRecord(key(),loadLegacyPromptLibrary))}
const historyKey=()=>profileStorageKey('codex-web-local.prompt-history-enabled.v1')
export function promptHistoryEnabled():boolean {return window.localStorage.getItem(historyKey())==='1'}
export function setPromptHistoryEnabled(enabled:boolean):void {window.localStorage.setItem(historyKey(),enabled?'1':'0')}

async function updateLibrary(change:(current:PromptLibrary)=>PromptLibrary):Promise<PromptLibrary>{
 return updateBrowserRecord(key(),loadLegacyPromptLibrary,current=>{
  const next=change(normalizeLibrary(current))
  if(next.presets.length>20)throw new Error('Limit: 20 presets. Delete one first.')
  return next
 },true)
}

/** Apply only this editor's changes, inside the transaction, to the latest library. */
export async function savePromptLibrary(value:PromptLibrary,previous?:PromptLibrary):Promise<PromptLibrary>{
 previous ??= await loadPromptLibrary()
 const beforeValue=previous
 return updateLibrary(current=>{
  const presets=new Map(current.presets.map(p=>[p.id,p]))
  const before=new Map(beforeValue.presets.map(p=>[p.id,p]))
  const after=new Map(value.presets.map(p=>[p.id,p]))
  for(const id of before.keys())if(!after.has(id))presets.delete(id)
  for(const [id,preset]of after)if(JSON.stringify(preset)!==JSON.stringify(before.get(id))){
   if(containsCredential(preset.text)||preset.text.length>PROMPT_TEXT_LIMIT||preset.name.length>80||preset.id.length>100)throw new Error('Invalid preset text or identity')
   presets.set(id,preset)
  }
  const removed=new Set(beforeValue.history.filter(text=>!value.history.includes(text)))
  const added=value.history.filter(text=>!beforeValue.history.includes(text)&&!containsCredential(text)&&text.length<=PROMPT_TEXT_LIMIT)
  return {presets:[...presets.values()],history:[...added,...current.history.filter(text=>!removed.has(text)&&!added.includes(text))].slice(0,30)}
 })
}
export async function clearPromptHistory():Promise<PromptLibrary>{const result=await updateLibrary(current=>({...current,history:[]}));try{window.localStorage.removeItem(key())}catch{/* Canonical clearing succeeded; legacy cleanup can be retried. */}return result}
export async function clearAllPrompts():Promise<PromptLibrary>{const result=await updateBrowserRecord(key(),()=>({presets:[],history:[]}),()=>({presets:[],history:[]}),true);try{window.localStorage.removeItem(key())}catch{/* Canonical clearing succeeded. */}return result}
export function containsCredential(text:string):boolean { return /\b(?:sk-[\w-]{8,}|(?:authorization|password|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*\S+|bearer\s+\S+)/i.test(text) }
export async function recordSubmittedPrompt(text:string):Promise<string> {
 try{
  if(!promptHistoryEnabled())return ''
  if(containsCredential(text))return 'Prompt submitted without saving credential-like text to recent history.'
  if(!text.trim()||text.length>PROMPT_TEXT_LIMIT)return 'Prompt exceeds recent-history limit; submitted normally without saving it.'
  await updateLibrary(current=>promptHistoryEnabled()?({...current,history:[text,...current.history.filter(old=>old!==text)].slice(0,30)}):current)
  return ''
 }catch{return 'Prompt submitted; recent history could not be saved in browser storage.'}
}

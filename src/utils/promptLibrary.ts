import {withBrowserStorageLock} from './browserStorageLock'
import {profileStorageKey} from './browserConnectionProfile'
export type TextPreset={id:string;name:string;text:string}
export type PromptLibrary={presets:TextPreset[];history:string[]}
export const PROMPT_TEXT_LIMIT=8000
const key=()=>profileStorageKey('codex-web-local.prompt-library.v1')
export function loadPromptLibrary():PromptLibrary {
 const raw=window.localStorage.getItem(key())
 if(!raw)return {presets:[],history:[]}
 if(raw.length>450_000)throw new Error('Prompt storage exceeds its safety limit. Clear it explicitly.')
 const value=JSON.parse(raw)
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid prompt storage')
 return {presets:Array.isArray(value.presets)?value.presets.slice(0,20).filter((p:TextPreset)=>p&&typeof p.id==='string'&&p.id.length<=100&&typeof p.name==='string'&&p.name.length<=80&&typeof p.text==='string'&&p.text.length<=PROMPT_TEXT_LIMIT):[],history:Array.isArray(value.history)?value.history.slice(0,30).filter((text:unknown)=>typeof text==='string'&&text.length<=PROMPT_TEXT_LIMIT):[]}
}
const historyKey=()=>profileStorageKey('codex-web-local.prompt-history-enabled.v1')
export function promptHistoryEnabled():boolean {return window.localStorage.getItem(historyKey())==='1'}
export function setPromptHistoryEnabled(enabled:boolean):void {window.localStorage.setItem(historyKey(),enabled?'1':'0')}

async function updateLibrary(change:(current:PromptLibrary)=>PromptLibrary):Promise<PromptLibrary>{
 return withBrowserStorageLock(key(),()=>{
  const next=change(loadPromptLibrary())
  if(next.presets.length>20)throw new Error('Limit: 20 presets. Delete one first.')
  window.localStorage.setItem(key(),JSON.stringify({presets:next.presets,history:next.history.slice(0,30)}))
  return next
 })
}

/** Apply only this editor's changes, under the lock, to the latest library. */
export function savePromptLibrary(value:PromptLibrary,previous:PromptLibrary=loadPromptLibrary()):Promise<PromptLibrary>{
 return updateLibrary(current=>{
  const presets=new Map(current.presets.map(p=>[p.id,p]))
  const before=new Map(previous.presets.map(p=>[p.id,p]))
  const after=new Map(value.presets.map(p=>[p.id,p]))
  for(const id of before.keys())if(!after.has(id))presets.delete(id)
  for(const [id,preset]of after)if(JSON.stringify(preset)!==JSON.stringify(before.get(id))){
   if(containsCredential(preset.text)||preset.text.length>PROMPT_TEXT_LIMIT||preset.name.length>80||preset.id.length>100)throw new Error('Invalid preset text or identity')
   presets.set(id,preset)
  }
  const removed=new Set(previous.history.filter(text=>!value.history.includes(text)))
  const added=value.history.filter(text=>!previous.history.includes(text)&&!containsCredential(text)&&text.length<=PROMPT_TEXT_LIMIT)
  return {presets:[...presets.values()],history:[...added,...current.history.filter(text=>!removed.has(text)&&!added.includes(text))].slice(0,30)}
 })
}
export function clearPromptHistory():Promise<PromptLibrary>{return updateLibrary(current=>({...current,history:[]}))}
export function clearAllPrompts():Promise<PromptLibrary>{return withBrowserStorageLock(key(),()=>{const empty={presets:[],history:[]};window.localStorage.setItem(key(),JSON.stringify(empty));return empty})}
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

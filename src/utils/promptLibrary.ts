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
 return {presets:Array.isArray(value.presets)?value.presets.slice(0,20).filter((p:TextPreset)=>p&&typeof p.id==='string'&&p.id.length<=100&&typeof p.name==='string'&&p.name.length<=80&&typeof p.text==='string'&&p.text.length<=PROMPT_TEXT_LIMIT):[],history:Array.isArray(value.history)?value.history.slice(0,30).filter((text:unknown)=>typeof text==='string'&&text.length<=PROMPT_TEXT_LIMIT):[]}
}
export function savePromptLibrary(value:PromptLibrary){window.localStorage.setItem(key(),JSON.stringify({presets:value.presets.slice(0,20),history:value.history.slice(0,30)}))}
export function containsCredential(text:string):boolean { return /\b(?:sk-[\w-]{8,}|(?:authorization|password|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*\S+|bearer\s+\S+)/i.test(text) }
export function recordSubmittedPrompt(text:string):string {
 if(containsCredential(text))return 'Prompt submitted without saving credential-like text to recent history.'

 if(!text.trim()||text.length>PROMPT_TEXT_LIMIT)return 'Prompt exceeds recent-history limit; submitted normally without saving it.'
 try{const value=loadPromptLibrary();value.history=[text,...value.history.filter(old=>old!==text)].slice(0,30);savePromptLibrary(value);return ''}
 catch{return 'Prompt submitted; recent history could not be saved in browser storage.'}
}

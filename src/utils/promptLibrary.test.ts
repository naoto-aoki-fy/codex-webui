import {afterEach,expect,it,vi} from 'vitest'
import {loadPromptLibrary,savePromptLibrary,recordSubmittedPrompt,setPromptHistoryEnabled,promptHistoryEnabled,clearPromptHistory} from './promptLibrary'

// These controller tests mock the atomic-storage boundary; the browser fixture
// exercises actual IndexedDB serialization across independent documents.
vi.mock('./browserStorageLock', () => {
 let tail: Promise<unknown> = Promise.resolve()
 return { withBrowserStorageLock: (_name: string, action: () => unknown) => {
  const result = tail.then(action); tail = result.catch(() => {}); return result
 } }
})
afterEach(()=>vi.unstubAllGlobals())
function storage(){
 const values=new Map<string,string>();let tail:Promise<unknown>=Promise.resolve()
 vi.stubGlobal('navigator',{locks:{request:(_key:string,action:()=>unknown)=>{const result=tail.then(action);tail=result.catch(()=>{});return result}}})
 vi.stubGlobal('window',{localStorage:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)}});return values
}
it('retains bounded opt-in text, filters credentials, deduplicates and clears history independently',async()=>{
 const values=storage()
 expect(promptHistoryEnabled()).toBe(false)
 await recordSubmittedPrompt('not recorded');expect(values.size).toBe(0)
 setPromptHistoryEnabled(true)
 for(let i=0;i<45;i++)await recordSubmittedPrompt('prompt '+i)
 expect(loadPromptLibrary().history).toHaveLength(30)
 await recordSubmittedPrompt('prompt 44');expect(loadPromptLibrary().history[0]).toBe('prompt 44')
 expect(await recordSubmittedPrompt('authorization: secret')).toContain('without saving')
 expect(await recordSubmittedPrompt('x'.repeat(8001))).toContain('without saving')
 await savePromptLibrary({presets:[{id:'p',name:'Preset',text:'Keep me'}],history:loadPromptLibrary().history})
 await clearPromptHistory();expect(loadPromptLibrary()).toEqual({presets:[{id:'p',name:'Preset',text:'Keep me'}],history:[]})
})
it('preserves legacy presets/history without opting users in and merges concurrent edits from stale editors',async()=>{
 const values=storage(),legacy={presets:[{id:'old',name:'Existing',text:'User data'}],history:['Legacy history']}
 values.set('codex-web-local.prompt-library.v1',JSON.stringify(legacy))
 expect(loadPromptLibrary()).toEqual(legacy);expect(promptHistoryEnabled()).toBe(false)
 await recordSubmittedPrompt('private');expect(loadPromptLibrary()).toEqual(legacy)
 const a=loadPromptLibrary(),b=loadPromptLibrary()
 await Promise.all([
  savePromptLibrary({...a,presets:[...a.presets,{id:'a',name:'A',text:'a'}]},a),
  savePromptLibrary({...b,presets:[...b.presets,{id:'b',name:'B',text:'b'}]},b),
 ])
 expect(loadPromptLibrary().presets.map(p=>p.id)).toEqual(['old','a','b'])
 await expect(savePromptLibrary({presets:[{id:'secret',name:'bad',text:'api_key=secret'}],history:[]},loadPromptLibrary())).rejects.toThrow()
})
it('reports unavailable storage without blocking accepted submission',async()=>{
 vi.stubGlobal('window',{get localStorage(){throw new Error('Denied')}})
 expect(await recordSubmittedPrompt('accepted')).toContain('could not be saved')
 expect(()=>loadPromptLibrary()).toThrow()
})
it('does not replace malformed data with an empty library',async()=>{
 const values=storage();values.set('codex-web-local.prompt-library.v1','null')
 await expect(clearPromptHistory()).rejects.toThrow()
 expect(values.get('codex-web-local.prompt-library.v1')).toBe('null')
})

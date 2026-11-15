import {afterEach,expect,it,vi} from 'vitest'
import {loadPromptLibrary,savePromptLibrary,recordSubmittedPrompt} from './promptLibrary'
afterEach(()=>vi.unstubAllGlobals())
function storage(){const values=new Map<string,string>();vi.stubGlobal('window',{localStorage:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)}});return values}
it('retains bounded submitted text only, deduplicates and permits explicit clearing',()=>{
 const values=storage();for(let i=0;i<45;i++)recordSubmittedPrompt('prompt '+i)
 expect(loadPromptLibrary().history).toHaveLength(30)
 recordSubmittedPrompt('prompt 44');expect(loadPromptLibrary().history[0]).toBe('prompt 44');expect(loadPromptLibrary().history).toHaveLength(30)
 expect([...values.values()][0]).not.toContain('imageUrls')
 expect(recordSubmittedPrompt('authorization: secret')).toContain('without saving')
 expect(recordSubmittedPrompt('x'.repeat(8001))).toContain('without saving')
 savePromptLibrary({presets:[],history:[]});expect(loadPromptLibrary().history).toEqual([])
})
it('reports storage failure without blocking submission',()=>{
 vi.stubGlobal('window',{get localStorage(){throw new Error('Denied')}})
 expect(recordSubmittedPrompt('accepted')).toContain('could not be saved')
})

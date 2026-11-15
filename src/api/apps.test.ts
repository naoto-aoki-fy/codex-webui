import {expect,it} from 'vitest'
import {appPage,nativeAppInputs} from './apps'
it('preserves exact native identifiers and emits structured mention inputs',()=>{
 expect(nativeAppInputs([{id:'connector_demo-v1',name:'Demo App'}])).toEqual([{type:'mention',name:'Demo App',path:'app://connector_demo-v1'}])
 expect(appPage({data:[{id:'id',name:'App',isAccessible:true,isEnabled:false}]})).toEqual({data:[{id:'id',name:'App',accessible:true,enabled:false}],nextCursor:null})
 expect(()=>nativeAppInputs([{id:'bad\nidentity',name:'x'}])).toThrow('Invalid')
 expect(()=>appPage({data:[{name:'x'}]})).toThrow('Invalid')
})
it('rejects oversized selection instead of truncating native references',()=>{
 expect(()=>nativeAppInputs(Array.from({length:21},(_,i)=>({id:String(i),name:'App'})))).toThrow('20')
 expect(nativeAppInputs([{id:'id',name:'App'},{id:'id',name:'App'}])).toHaveLength(1)
})

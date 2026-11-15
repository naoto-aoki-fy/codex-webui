import {expect,it} from 'vitest'
import {createLiveItemOrder} from './liveItemOrder'
import type {UiMessage} from '../types/codex'
it('merges existing ordered buckets linearly and preserves first observation on replacement',()=>{
 const order=createLiveItemOrder(),a:UiMessage={id:'a',role:'system',text:'a'},b:UiMessage={id:'b',role:'system',text:'b'},c:UiMessage={id:'c',role:'assistant',text:'c'}
 order.remember([],a);order.remember([],b);order.remember([a],c)
 const replacement={...a,text:'complete'};order.remember([a,c],replacement)
 expect(order.merge([[b],[replacement,c]]).map(m=>m.id)).toEqual(['a','b','c'])
})

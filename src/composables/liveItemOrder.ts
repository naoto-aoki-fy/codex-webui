import {toRaw} from 'vue'
import type {UiMessage} from '../types/codex'
/** Transient first-observation order across the existing overlay buckets.
 * Weak keys retire with messages; no history/persistence or notification owner. */
export function createLiveItemOrder(){
 const order=new WeakMap<UiMessage,number>();let sequence=0
 function remember(previous:UiMessage[],next:UiMessage){const old=previous.find(message=>message.id===next.id);order.set(toRaw(next),(old&&order.get(toRaw(old)))??++sequence)}
 function merge(groups:UiMessage[][]){
  const positions=groups.map(()=>0),result:UiMessage[]=[]
  while(true){let chosen=-1,lowest=Infinity
   for(let i=0;i<groups.length;i++){const message=groups[i]![positions[i]!];if(!message)continue;const position=order.get(toRaw(message))??0;if(chosen===-1||position<lowest){chosen=i;lowest=position}}
   if(chosen===-1)return result
   result.push(groups[chosen]![positions[chosen]!]!);positions[chosen]!++
  }
 }
 return {remember,merge}
}

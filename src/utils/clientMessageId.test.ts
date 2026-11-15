import {afterEach,expect,it,vi} from 'vitest'
import {clientMessageId} from './clientMessageId'
afterEach(()=>vi.unstubAllGlobals())
it('supports HTTP browsers without randomUUID using strong random correlation IDs',()=>{
 const original=globalThis.crypto;vi.stubGlobal('crypto',{getRandomValues:original.getRandomValues.bind(original)})
 const ids=Array.from({length:100},()=>clientMessageId());expect(new Set(ids).size).toBe(100);expect(ids.every(id=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))).toBe(true)
})
it('rejects unsupported randomness rather than using a collision-prone queue identifier',()=>{vi.stubGlobal('crypto',undefined);expect(()=>clientMessageId()).toThrow('no prompt was queued')})

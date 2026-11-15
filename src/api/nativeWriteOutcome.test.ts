import {expect,it} from 'vitest'
import {nativeWriteError,nativeWriteRejected} from './nativeWriteOutcome'
it('never treats native internal/storage/transport failures as proof that nothing changed',()=>{
 for(const rpcCode of [-32600,-32601,-32602])expect(nativeWriteRejected({rpcCode})).toBe(true)
 for(const rpcCode of [-32603,-32000,-32001,undefined])expect(nativeWriteRejected({rpcCode})).toBe(false)
})
it('bounds and redacts operation-specific failure messages without changing generic errors',()=>{
 const error=new Error('api_key=PRIVATE <script>literal</script> '+ 'x'.repeat(1000000))
 const value=nativeWriteError(error);expect(value.length).toBeLessThanOrEqual(2000);expect(value).not.toContain('PRIVATE');expect(error.message).toContain('PRIVATE')
})

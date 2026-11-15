import {expect,it} from 'vitest'
import {daybreakPreference,accessProgramPage} from './daybreakStatus'
it('distinguishes native false, unset and unsupported metadata without inferring entitlement',()=>{
 expect(daybreakPreference({thread:{id:'t',daybreakEnabled:false}},'t')).toBe('disabled');expect(daybreakPreference({thread:{id:'t',daybreakEnabled:null}},'t')).toBe('unset');expect(daybreakPreference({thread:{id:'t'}},'t')).toBe('unavailable');expect(()=>daybreakPreference({thread:{id:'other'}},'t')).toThrow()
})
it('uses caller-advertised explicit programs rather than guessing from model names',()=>{
 const rows=accessProgramPage({data:[{id:'gpt-daybreak-name-only'},{id:'m',availableAccessPrograms:{cyber:[]}},{id:'supported',availableAccessPrograms:{cyber:['daybreakBlue','daybreakRed']}}]}).rows
 expect(rows[0]?.programs).toBe(null);expect(rows[1]?.programs).toEqual([]);expect(rows[2]?.programs).toEqual(['daybreakBlue','daybreakRed'])
})
it('rejects malformed/oversized catalog data',()=>{for(const value of [{data:Array(21).fill({id:'m'})},{data:[{id:'m',availableAccessPrograms:{cyber:'all'}}]},{data:[],nextCursor:1}])expect(()=>accessProgramPage(value)).toThrow()})

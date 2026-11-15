import {expect,it} from 'vitest'
import {accountInspection,loginMethodsInspection} from './authInspection'
it('distinguishes native signed out, unknown and actual provider account without tokens',()=>{
 expect(()=>accountInspection({account:null})).toThrow();expect(accountInspection({account:null,requiresOpenaiAuth:true}).type).toBe('signedOut')
 const account=accountInspection({account:{type:'chatgpt',email:'fixture@example.invalid',planType:'plus',accessToken:'SECRET'},requiresOpenaiAuth:true})
 expect(account.email).toBe('fixture@example.invalid');expect(JSON.stringify(account)).not.toContain('SECRET')
})
it('does not convert unknown methods or an empty policy into permission to login',()=>{
 expect(loginMethodsInspection({requirements:null})).toBe(null);expect(loginMethodsInspection({requirements:{}})).toBe(null)
 expect(loginMethodsInspection({requirements:{allowed_login_methods:[]}})).toEqual([]);expect(loginMethodsInspection({requirements:{allowed_login_methods:['chatgpt','api']}})).toEqual(['chatgpt','api'])
 expect(()=>loginMethodsInspection({requirements:{allowed_login_methods:[{}]}})).toThrow()
})

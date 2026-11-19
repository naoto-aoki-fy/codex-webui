// Credential-free intercepted native workflows; production accounts/resources are never used.
const {spawnSync}=require('node:child_process')
const {writeFileSync,mkdirSync}=require('node:fs')
const {resolve}=require('node:path')
const scripts=['subagents','hooks','config','import','permissions','denials','queue','queue-management','permission-changes','config-changes','hook-policies','daybreak','native-authentication','shell','deletion']
const results=[];mkdirSync('output/playwright',{recursive:true})
for(const name of scripts){
 const script=`scripts/test-risk-${name}.cjs`,result=spawnSync(process.execPath,[script],{encoding:'utf8',env:process.env,timeout:180_000})
 const row={script,exitCode:result.status,output:(result.stdout||'')+(result.stderr||''),error:result.error?.message};results.push(row);console.log(row.output)
 writeFileSync(resolve('output/playwright/risk-browser-matrix.json'),JSON.stringify(results,null,2))
 if(result.status!==0)process.exit(1)
}
console.log('PASS all risk-first browser suites')

const {spawnSync}=require('node:child_process')
const {writeFileSync,mkdirSync}=require('node:fs')
const {resolve}=require('node:path')
const scripts=['execution','panels','compaction','review','processes','prompts','apps','memory','mcp','plugins','remote','stale','uncertain','testchat']
const results=[];mkdirSync('output/playwright',{recursive:true})
for(const name of scripts){
 const script=`scripts/test-approved-${name}.cjs`,result=spawnSync(process.execPath,[script],{encoding:'utf8',env:process.env,timeout:180_000})
 const row={script,exitCode:result.status,output:(result.stdout||'')+(result.stderr||''),error:result.error?.message};results.push(row);console.log(row.output)
 writeFileSync(resolve('output/playwright/approved-browser-matrix.json'),JSON.stringify(results,null,2))
 if(result.status!==0)process.exit(1)
}
console.log('PASS all approved browser suites')

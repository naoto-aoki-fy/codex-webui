import {rpcCall} from './codexRpcClient'
import {executionText} from './normalizers/executionDetails'
export type CuratedPlugin={id:string;name:string;marketplace:string;version:string;localVersion:string;installed:boolean|null;enabled:boolean|null;source:string;description:string;developer:string}
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
export function curatedPlugins(value:unknown):{plugins:CuratedPlugin[];warnings:string[]}{const row=record(value)
 if(!Array.isArray(row.marketplaces)||row.marketplaces.length>32)throw new Error('Incompatible curated Marketplace response')
 const plugins:CuratedPlugin[]=[]
 for(const value of row.marketplaces){const market=record(value);if(typeof market.name!=='string'||!Array.isArray(market.plugins))throw new Error('Invalid Marketplace')
  for(const value of market.plugins){if(plugins.length>=400)throw new Error('Curated browser limited to 400 plugins. No partial catalog is shown.')
   const plugin=record(value),ui=record(plugin.interface);if(typeof plugin.id!=='string'||typeof plugin.name!=='string')throw new Error('Invalid plugin identity')
   const text=(v:unknown,n=300)=>typeof v==='string'?executionText(v).slice(0,n):'Unavailable'
   plugins.push({id:text(plugin.id),name:text(plugin.name),marketplace:text(market.name),version:text(plugin.version),localVersion:text(plugin.localVersion),installed:typeof plugin.installed==='boolean'?plugin.installed:null,enabled:typeof plugin.enabled==='boolean'?plugin.enabled:null,source:executionText(plugin.source).slice(0,1500),description:text(ui.longDescription??ui.shortDescription,2000),developer:text(ui.developerName)})
  }
 }
 return {plugins,warnings:Array.isArray(row.marketplaceLoadErrors)?row.marketplaceLoadErrors.slice(0,10).map(e=>executionText(record(e).message??'Marketplace load failed').slice(0,600)):[]}
}
export async function readCuratedPlugins(){
 // The floor implementation starts bundle synchronization for local/default lists.
 // Explicit vertical-only sources avoid those code paths; never force refresh.
 return curatedPlugins(await rpcCall('plugin/list',{marketplaceKinds:['vertical'],forceRefetch:false}))
}

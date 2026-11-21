import { expect, it } from 'vitest'
import { normalizeExecutionItem, executionText } from './executionDetails'
it('renders public MCP text with bounded redaction, no metadata or markup execution', () => {
 const message = normalizeExecutionItem({id:'m',type:'mcpToolCall',server:'s',tool:'t',status:'failed',arguments:{query:'hello',apiKey:'hidden',instructions:'hidden'},result:{content:[{type:'text',text:'<script>x</script> token=secret'}],_meta:{hidden:'secret'}},error:{message:'failed'}})!
 expect(message.text).toContain('<script>x</script>')
 expect(message.text).toContain('Status: failed')
 expect(message.text).not.toMatch(/hidden|token=secret/)
 expect(message.text).toContain('Error: failed')
 expect(executionText({text:'a'.repeat(1_000_000)}).length).toBeLessThanOrEqual(12_000)
})
it('distinguishes unavailable details from empty results and observed lifecycle', () => {
 const item={id:'w',type:'webSearch',query:'q'}
 expect(normalizeExecutionItem(item)?.text).toContain('Results: Unavailable')
 expect(normalizeExecutionItem({...item,results:[]},'completed')?.text).toContain('Results: Empty result')
 expect(normalizeExecutionItem(item,'started')?.text).toContain('Status: inProgress')
 expect(normalizeExecutionItem(item)?.text).toContain('Status: unavailable')
 expect(normalizeExecutionItem({type:'mcpToolCall'})).toBeNull()
})
it('omits URL userinfo credentials in public execution text',()=>{
 expect(executionText('https://user:password@example.test/path')).not.toContain('user:password')
})

it('uses the public query as a single-line search label with a fallback for empty queries', () => {
  const search = (query: string) => normalizeExecutionItem({ id: 'w', type: 'webSearch', query })
  expect(search('  test\n\tquery token=secret  ')?.executionLabel).toBe('test query token=[redacted]')
  expect(search('  \n')?.executionLabel).toBe('Web search')
})

it('renders public structured results without confusing absent text with an empty result',()=>{
 const message=normalizeExecutionItem({id:'s',type:'mcpToolCall',server:'s',tool:'t',status:'completed',result:{content:[],structuredContent:{answer:'public structured result',apiKey:'SECRET',debug:{hidden:'INTERNAL'}},_meta:{hidden:'INTERNAL'}}})!
 expect(message.text).toContain('public structured result');expect(message.text).not.toContain('Empty result');expect(message.text).not.toMatch(/SECRET|INTERNAL/)
})

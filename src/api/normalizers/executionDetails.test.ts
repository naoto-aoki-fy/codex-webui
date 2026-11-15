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

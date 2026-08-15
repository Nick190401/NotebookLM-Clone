import { strToU8, zipSync } from 'npm:fflate@0.8.2'
import { extractDocx, extractHtml } from '../../../supabase/functions/source-import/handler.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

Deno.test('HTML extraction keeps article text and removes executable or navigation content', () => {
  const result = extractHtml(
    `
    <html><head><meta content="Research &amp; Evidence" property="og:title"><script>steal()</script></head>
    <body><nav>Menu item</nav><main><h1>Finding</h1><p>Grounded &amp; useful.</p></main><footer>Footer</footer></body></html>
  `,
    'fallback.test',
  )
  assert(result.title === 'Research & Evidence', 'Open Graph title was not decoded')
  assert(result.content.includes('Finding') && result.content.includes('Grounded & useful.'), 'article content missing')
  assert(
    !result.content.includes('steal') && !result.content.includes('Menu item') && !result.content.includes('Footer'),
    'page chrome leaked into source text',
  )
})

Deno.test('DOCX extraction reads paragraph text without Node-only document libraries', () => {
  const archive = zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(
      `<?xml version="1.0"?><w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>First paragraph</w:t></w:r></w:p><w:p><w:r><w:t>Second &amp; grounded</w:t></w:r></w:p></w:body></w:document>`,
    ),
  })
  const text = extractDocx(archive)
  assert(text.includes('First paragraph') && text.includes('Second & grounded'), 'DOCX paragraph text missing')
})

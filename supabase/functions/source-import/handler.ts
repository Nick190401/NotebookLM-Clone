import { strFromU8, unzipSync } from 'npm:fflate@0.8.2'
import { extractText, getDocumentProxy } from 'npm:unpdf@1.8.1'
import { fetchTranscript } from 'npm:youtube-transcript@1.3.1'
import type { SourceKind } from '../_shared/domain.ts'
import { analyzeImage, transcribeAudio } from '../_shared/groq.ts'
import { authenticatedContext, errorResponse, HttpError, jsonResponse, optionsResponse } from '../_shared/http.ts'

interface ImportedSource {
  title: string
  kind: SourceKind
  origin: string
  content: string
}

const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const decoder = new TextDecoder()

function normalizeText(value: string) {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extension(filename: string) {
  const match = filename.toLowerCase().match(/\.[a-z0-9]+$/)
  return match?.[0] ?? ''
}

async function extractPdf(bytes: Uint8Array) {
  const document = await getDocumentProxy(bytes)
  const result = await extractText(document, { mergePages: true })
  return normalizeText(result.text)
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&', apos: "'", auml: 'ä', copy: '©', gt: '>', hellip: '…', lt: '<', mdash: '—',
  nbsp: ' ', ndash: '–', ouml: 'ö', quot: '"', szlig: 'ß', uuml: 'ü',
}

function decodeEntities(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith('#')) {
      const point = Number.parseInt(code.slice(code[1]?.toLowerCase() === 'x' ? 2 : 1), code[1]?.toLowerCase() === 'x' ? 16 : 10)
      return point <= 0x10ffff ? String.fromCodePoint(point) : entity
    }
    return HTML_ENTITIES[code.toLowerCase()] ?? entity
  })
}

export function extractDocx(bytes: Uint8Array) {
  let files: Record<string, Uint8Array>
  let uncompressedBytes = 0
  try {
    files = unzipSync(bytes, { filter: (file) => {
      const wanted = /^word\/(document|footnotes|endnotes|header\d+|footer\d+)\.xml$/i.test(file.name)
      if (wanted) {
        uncompressedBytes += file.originalSize
        if (uncompressedBytes > 20 * 1024 * 1024) throw new Error('DOCX content exceeds extraction limit')
      }
      return wanted
    } })
  } catch {
    throw new HttpError('The DOCX archive is damaged or invalid.', 'INVALID_DOCUMENT', 422)
  }
  const documentParts = Object.keys(files)
    .filter((name) => /^word\/(document|footnotes|endnotes|header\d+|footer\d+)\.xml$/i.test(name))
    .sort((left, right) => Number(!left.endsWith('/document.xml')) - Number(!right.endsWith('/document.xml')))
  const content = documentParts.map((name) => decodeEntities(strFromU8(files[name]))
    .replace(/<w:tab\b[^>]*\/>/gi, '\t')
    .replace(/<w:br\b[^>]*\/>/gi, '\n')
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .join('\n\n')
  return normalizeText(content)
}

function metaTitle(html: string) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    const property = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1]
    if (property?.toLowerCase() === 'og:title' && content) return decodeEntities(content)
  }
  return ''
}

export function extractHtml(html: string, fallbackTitle: string) {
  const title = normalizeText(metaTitle(html) || decodeEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || fallbackTitle).replace(/<[^>]+>/g, ''))
  const withoutChrome = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|footer|form|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|hr)\b[^>]*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|section|article|main|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return { title, content: normalizeText(decodeEntities(withoutChrome)) }
}

async function importFile(file: File): Promise<ImportedSource> {
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError('The upload exceeds 25 MB.', 'FILE_TOO_LARGE', 413)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = file.type.toLowerCase()
  const ext = extension(file.name)
  let kind: SourceKind = 'text'
  let content: string

  if (mime === 'application/pdf' || ext === '.pdf') {
    kind = 'pdf'
    content = await extractPdf(bytes)
  } else if (mime.includes('wordprocessingml') || ext === '.docx') {
    content = extractDocx(bytes)
  } else if (mime.startsWith('audio/') || ['.mp3', '.wav', '.m4a', '.ogg', '.webm', '.flac', '.mp4'].includes(ext)) {
    kind = 'audio'
    content = await transcribeAudio(bytes, file.name, mime || 'application/octet-stream')
  } else if (mime.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    kind = 'image'
    content = await analyzeImage(bytes, mime || 'image/jpeg')
  } else if (mime.startsWith('text/') || ['.txt', '.md', '.csv', '.json', '.html', '.htm'].includes(ext)) {
    content = normalizeText(decoder.decode(bytes))
  } else {
    throw new HttpError('Unsupported format. Use PDF, DOCX, text, image, or audio.', 'UNSUPPORTED_FILE', 415)
  }

  if (!content) throw new HttpError('No readable content could be extracted from this file.', 'EMPTY_SOURCE', 422)
  return {
    title: file.name.replace(/\.[^.]+$/, '') || 'Untitled source',
    kind,
    origin: file.name,
    content: content.slice(0, 300_000),
  }
}

function youtubeUrl(url: URL) {
  return url.hostname === 'youtu.be' || url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')
}

async function importYoutube(url: URL): Promise<ImportedSource> {
  try {
    const transcript = await fetchTranscript(url.toString())
    const content = normalizeText(transcript.map((part) => part.text).join(' '))
    let title = 'YouTube transcript'
    try {
      const metadata = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url.toString())}&format=json`, {
        signal: AbortSignal.timeout(8_000),
      })
      if (metadata.ok) title = String((await metadata.json() as { title?: string }).title || title)
    } catch {
      // The transcript remains useful when oEmbed metadata is unavailable.
    }
    if (!content) throw new Error('Empty transcript')
    return { title, kind: 'youtube', origin: url.toString(), content: content.slice(0, 300_000) }
  } catch {
    throw new HttpError('No public transcript is available for this YouTube video.', 'TRANSCRIPT_UNAVAILABLE', 422)
  }
}

function privateIpv4(address: string) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b, c] = parts
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
}

function privateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized.includes('.')) {
    const ipv4 = normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized
    return privateIpv4(ipv4)
  }
  if (!normalized.includes(':')) return false
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('2001:db8')) return true
  const first = Number.parseInt(normalized.split(':')[0] || '0', 16)
  return first < 0x2000 || first > 0x3fff
}

async function assertPublicUrl(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol)) throw new HttpError('Only public HTTP and HTTPS URLs are supported.', 'INVALID_URL', 400)
  if (url.username || url.password || url.hostname.toLowerCase() === 'localhost') throw new HttpError('Local or credentialed URLs are not allowed.', 'PRIVATE_URL', 400)

  const literal = url.hostname.replace(/^\[|\]$/g, '')
  if (/^[\d.]+$/.test(literal) || literal.includes(':')) {
    if (privateAddress(literal)) throw new HttpError('Private network targets are not allowed.', 'PRIVATE_URL', 400)
    return
  }

  const addresses: string[] = []
  for (const recordType of ['A', 'AAAA'] as const) {
    try {
      addresses.push(...await Deno.resolveDns(url.hostname, recordType))
    } catch {
      // A host does not need to expose both record families.
    }
  }
  if (!addresses.length) throw new HttpError('The URL could not be resolved.', 'URL_UNREACHABLE', 422)
  if (addresses.some(privateAddress)) throw new HttpError('Private network targets are not allowed.', 'PRIVATE_URL', 400)
}

function combine(parts: Uint8Array[], total: number) {
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return bytes
}

async function download(url: URL, redirects = 0): Promise<{ bytes: Uint8Array; contentType: string; finalUrl: URL }> {
  if (redirects > 5) throw new HttpError('The URL has too many redirects.', 'TOO_MANY_REDIRECTS', 422)
  await assertPublicUrl(url)
  let response: Response
  try {
    response = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': 'NotebookLM-Clone/2.0 (Supabase Edge Function)', accept: 'text/html,application/pdf,text/plain,*/*;q=0.5' },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new HttpError('The URL could not be reached.', 'URL_UNREACHABLE', 422)
  }
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location')
    if (!location) throw new HttpError('The URL returned an invalid redirect.', 'URL_UNREACHABLE', 422)
    return download(new URL(location, url), redirects + 1)
  }
  if (!response.ok) throw new HttpError(`The URL returned HTTP ${response.status}.`, 'URL_UNREACHABLE', 422)
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_DOWNLOAD_BYTES) throw new HttpError('The download exceeds 15 MB.', 'REMOTE_FILE_TOO_LARGE', 413)
  const reader = response.body?.getReader()
  if (!reader) throw new HttpError('The URL returned no content.', 'EMPTY_SOURCE', 422)

  const parts: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_DOWNLOAD_BYTES) {
      await reader.cancel()
      throw new HttpError('The download exceeds 15 MB.', 'REMOTE_FILE_TOO_LARGE', 413)
    }
    parts.push(value)
  }
  return { bytes: combine(parts, total), contentType: response.headers.get('content-type')?.toLowerCase() || '', finalUrl: url }
}

async function importUrl(rawUrl: string): Promise<ImportedSource> {
  const url = new URL(rawUrl)
  await assertPublicUrl(url)
  if (youtubeUrl(url)) return importYoutube(url)
  const result = await download(url)
  if (result.contentType.includes('application/pdf') || result.finalUrl.pathname.toLowerCase().endsWith('.pdf')) {
    const content = await extractPdf(result.bytes)
    if (!content) throw new HttpError('No text could be extracted from this PDF.', 'EMPTY_SOURCE', 422)
    return { title: result.finalUrl.pathname.split('/').pop()?.replace(/\.pdf$/i, '') || result.finalUrl.hostname, kind: 'pdf', origin: result.finalUrl.toString(), content: content.slice(0, 300_000) }
  }
  if (!result.contentType.includes('html')) {
    const content = normalizeText(decoder.decode(result.bytes))
    if (!content) throw new HttpError('The URL returned no readable text.', 'EMPTY_SOURCE', 422)
    return { title: result.finalUrl.pathname.split('/').pop() || result.finalUrl.hostname, kind: 'web', origin: result.finalUrl.toString(), content: content.slice(0, 300_000) }
  }

  const { title, content } = extractHtml(decoder.decode(result.bytes), result.finalUrl.hostname)
  if (content.length < 80) throw new HttpError('Not enough readable content was found on this page.', 'EMPTY_SOURCE', 422)
  return { title, kind: 'web', origin: result.finalUrl.toString(), content: content.slice(0, 300_000) }
}

export async function handleSourceImportRequest(request: Request) {
  if (request.method === 'OPTIONS') return optionsResponse()
  if (request.method !== 'POST') return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } }, 405)

  try {
    await authenticatedContext(request)
    const contentType = request.headers.get('content-type') || ''
    let imported: ImportedSource
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('file')
      if (!(file instanceof File)) throw new HttpError('A file field is required.', 'INVALID_REQUEST', 400)
      imported = await importFile(file)
    } else {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        throw new HttpError('A valid JSON or multipart body is required.', 'INVALID_REQUEST', 400)
      }
      const value = body as { action?: unknown; url?: unknown }
      if (value?.action !== 'url' || typeof value.url !== 'string' || value.url.length > 2_000) {
        throw new HttpError('A valid URL import request is required.', 'INVALID_REQUEST', 400)
      }
      let url: URL
      try {
        url = new URL(value.url)
      } catch {
        throw new HttpError('A valid URL is required.', 'INVALID_REQUEST', 400)
      }
      imported = await importUrl(url.toString())
    }
    return jsonResponse({ imported })
  } catch (error) {
    return errorResponse(error)
  }
}

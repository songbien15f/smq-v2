import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import sharp from 'sharp'

interface ImageEntry {
  index: number
  file: string
  mime: string
  width: number
  height: number
  alt: string
  bytes: number
}

interface ProjectRecord {
  img?: string
  [key: string]: unknown
}

const ROOT = process.cwd()
const SOURCE = path.join(ROOT, 'docs', 'Smart Solutions Australia Website.html')
const SEED_DIR = path.join(ROOT, 'public', 'images', 'seed')
const DOCS_DIR = path.join(ROOT, 'docs')
const STYLES_DIR = path.join(ROOT, 'src', 'styles')
const APP_DIR = path.join(ROOT, 'src', 'app')

const IMAGE_RE = /data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,([A-Za-z0-9+/=]+)/g
const VIEW_RE = /<div class="page-view" data-view="([^"]+)"[^>]*>/g
const MAX_SLUG_LENGTH = 40

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function pad(index: number): string {
  return String(index).padStart(2, '0')
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '')
}

function extensionFor(rawMime: string): string {
  if (rawMime === 'jpeg' || rawMime === 'jpg') return 'jpg'
  if (rawMime === 'svg+xml') return 'svg'
  return rawMime
}

function normalizeMime(rawMime: string): string {
  if (rawMime === 'jpg') return 'image/jpeg'
  if (rawMime === 'svg+xml') return 'image/svg+xml'
  return `image/${rawMime}`
}

/**
 * Returns the balanced `{...}` object literal starting at `start`.
 * Quote-aware so braces inside JS strings do not affect the depth count.
 */
function balancedObject(text: string, start: number): string {
  let depth = 0
  let quote: string | null = null
  let escaped = false

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }

  throw new Error('Unbalanced object literal in template')
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rarr: '→',
  larr: '←',
  uarr: '↑',
  darr: '↓',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  times: '×',
  deg: '°',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z][a-z0-9]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
}

function visibleText(raw: string): string {
  const decoded = decodeEntities(
    raw
      .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, '[image]')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<img\b[^>]*>/gi, ' [image] ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(
        /<\/(p|h[1-6]|li|div|section|article|figure|figcaption|blockquote|header|footer|nav|tr|td|th|dt|dd|title|pre)>/gi,
        '\n',
      )
      .replace(/<[^>]*>/g, ' '),
  )

  return decoded
    .split('\n')
    .map((line) =>
      line
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .trim(),
    )
    .filter(Boolean)
    .join('\n')
}

async function main(): Promise<void> {
  const html = fs.readFileSync(SOURCE, 'utf8')

  // 1. Stylesheet: the template has exactly one <style> block.
  const styleTagStart = html.indexOf('<style')
  if (styleTagStart === -1) throw new Error('No <style> block found in template')
  const styleStart = html.indexOf('>', styleTagStart) + 1
  const styleEnd = html.indexOf('</style>', styleStart)
  if (styleEnd === -1) throw new Error('Unterminated <style> block in template')
  const css = html.slice(styleStart, styleEnd)

  ensureDir(STYLES_DIR)
  fs.writeFileSync(path.join(STYLES_DIR, 'site.css'), css, 'utf8')

  // 2. Locate the PROJECTS literal so image filenames can be derived per project.
  const projectsMarker = html.indexOf('var PROJECTS')
  if (projectsMarker === -1) throw new Error('PROJECTS object not found in template')
  const projectsLiteralStart = html.indexOf('{', projectsMarker)
  const projectsLiteral = balancedObject(html, projectsLiteralStart)
  const projectsLiteralEnd = projectsLiteralStart + projectsLiteral.length

  // 3. Images, in document order.
  ensureDir(SEED_DIR)
  const images: ImageEntry[] = []
  const uriToFile = new Map<string, string>()
  const usedFiles = new Set<string>()
  let faviconBuffer: Buffer | null = null

  for (const match of html.matchAll(IMAGE_RE)) {
    const index = images.length + 1
    const rawMime = match[1]
    const base64 = match[2]
    const dataUri = match[0]
    const matchIndex = match.index ?? 0
    const matchEnd = matchIndex + dataUri.length
    const buffer = Buffer.from(base64, 'base64')

    const tagStart = html.lastIndexOf('<', matchIndex)
    const rawTagEnd = html.indexOf('>', matchEnd)
    const tagEnd = rawTagEnd === -1 ? matchEnd : rawTagEnd + 1
    const tag = tagStart !== -1 && matchIndex - tagStart < 500 ? html.slice(tagStart, tagEnd) : ''
    const isHtmlTag = /^<(img|link|source|image)\b/i.test(tag)
    const isFavicon = isHtmlTag && /^<link\b/i.test(tag) && /\brel="icon"/i.test(tag)

    // In this template every alt attribute follows the data URI, either in the
    // same HTML tag or as `alt: '...'` on the enclosing JS record.
    let alt = ''
    if (isHtmlTag) {
      const tagAlt = tag.match(/\balt="([^"]*)"/)
      if (tagAlt) alt = tagAlt[1].trim()
    }
    if (!alt) {
      const forward = html.slice(matchEnd, matchEnd + 600)
      const jsAlt = forward.match(/\balt\s*:\s*(['"])([\s\S]*?)\1/)
      if (jsAlt) alt = jsAlt[2].trim()
    }
    if (!alt) {
      const backward = html.slice(Math.max(0, matchIndex - 600), matchIndex)
      const previousAlts = [...backward.matchAll(/\balt="([^"]*)"/g)]
      if (previousAlts.length > 0) alt = previousAlts[previousAlts.length - 1][1].trim()
    }

    // Project images are named after their project key so later seeds can map them directly.
    let projectKey = ''
    if (matchIndex >= projectsLiteralStart && matchIndex < projectsLiteralEnd) {
      const beforeImage = html.slice(projectsLiteralStart, matchIndex)
      const keyMatches = [...beforeImage.matchAll(/['"]([a-z0-9][a-z0-9-]*)['"]\s*:\s*\{/gi)]
      if (keyMatches.length > 0) projectKey = keyMatches[keyMatches.length - 1][1]
    }

    let slug = ''
    if (projectKey) {
      slug = slugify(`project-${projectKey}`)
    } else if (isFavicon) {
      slug = 'favicon'
    } else if (alt) {
      slug = slugify(alt)
    }
    if (!slug) slug = `image-${pad(index)}`

    let file = `${pad(index)}-${slug}.${extensionFor(rawMime)}`
    if (usedFiles.has(file)) file = `${pad(index)}-${slug}-${index}.${extensionFor(rawMime)}`
    usedFiles.add(file)

    let width = 0
    let height = 0
    if (rawMime !== 'svg+xml') {
      const metadata = await sharp(buffer).metadata()
      width = metadata.width ?? 0
      height = metadata.height ?? 0
    }

    fs.writeFileSync(path.join(SEED_DIR, file), buffer)
    if (isFavicon) faviconBuffer = buffer
    uriToFile.set(dataUri, file)
    images.push({
      index,
      file,
      mime: normalizeMime(rawMime),
      width,
      height,
      alt,
      bytes: buffer.length,
    })
  }

  if (images.length !== 29) {
    throw new Error(`Expected 29 images, found ${images.length}`)
  }

  ensureDir(DOCS_DIR)
  fs.writeFileSync(
    path.join(DOCS_DIR, 'template-assets.json'),
    `${JSON.stringify({ images }, null, 2)}\n`,
    'utf8',
  )

  if (!faviconBuffer) throw new Error('Favicon image not found')
  ensureDir(APP_DIR)
  fs.writeFileSync(path.join(APP_DIR, 'icon.png'), faviconBuffer)

  // 4. Content: one section per .page-view, in DOM order.
  const views: { name: string; start: number }[] = []
  for (const match of html.matchAll(VIEW_RE)) {
    views.push({ name: match[1], start: (match.index ?? 0) + match[0].length })
  }
  if (views.length === 0) throw new Error('No page views found in template')

  const sections: string[] = []
  for (let i = 0; i < views.length; i += 1) {
    const view = views[i]
    let end: number
    if (i + 1 < views.length) {
      const nextMatchIndex = html.indexOf('<div class="page-view"', view.start)
      end = nextMatchIndex === -1 ? html.length : nextMatchIndex
    } else {
      const mainEnd = html.indexOf('</main>', view.start)
      end = mainEnd === -1 ? html.length : mainEnd
    }
    const body = visibleText(html.slice(view.start, end))
    sections.push(`## View: ${view.name}\n\n${body}\n`)
  }
  fs.writeFileSync(path.join(DOCS_DIR, 'template-content.md'), sections.join('\n'), 'utf8')

  // 5. Projects: evaluate the literal in a sandboxed context, then map images to files.
  const projects = vm.runInNewContext(`(${projectsLiteral})`, Object.create(null), {
    timeout: 1000,
  }) as Record<string, ProjectRecord>

  for (const record of Object.values(projects)) {
    if (typeof record.img === 'string' && record.img.startsWith('data:image/')) {
      const file = uriToFile.get(record.img)
      if (!file) {
        throw new Error(`Project image not found in asset manifest: ${record.img.slice(0, 40)}`)
      }
      record.img = file
    }
  }

  fs.writeFileSync(
    path.join(DOCS_DIR, 'template-projects.json'),
    `${JSON.stringify(projects, null, 2)}\n`,
    'utf8',
  )

  const cssBytes = Buffer.byteLength(css, 'utf8')
  const lowResolution = images.filter((image) => image.width > 0 && image.width < 1200)
  console.log(`Images extracted: ${images.length}`)
  console.log(`Stylesheet bytes: ${cssBytes}`)
  console.log(`Projects extracted: ${Object.keys(projects).length}`)
  console.log(
    lowResolution.length === 0
      ? 'Images narrower than 1200px: none'
      : `Images narrower than 1200px: ${lowResolution
          .map((image) => `${image.file} (${image.width}x${image.height})`)
          .join(', ')}`,
  )
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})

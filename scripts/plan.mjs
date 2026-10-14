// Builds one iptv-org `*.channels.xml` per grab job from iptv-org/epg's own
// site lists, keeping only channels mapped to an iptv-org id.
//
// A channel goes to every job whose site lists it, not just the first:
// sites fail per channel (Tata Play answered 429 to 609 requests even one at
// a time), and merge.mjs takes each channel's programmes from the first job,
// in this order, that actually returned some.
//
// usage: node scripts/plan.mjs <iptv-org/epg checkout> <out dir>
// prints `jobs=[...]` for $GITHUB_OUTPUT

import fs from 'node:fs'
import path from 'node:path'

const [epgDir, outDir] = process.argv.slice(2)
if (!epgDir || !outDir) {
  console.error('usage: plan.mjs <epg dir> <out dir>')
  process.exit(1)
}

// Order is priority. A country code list limits a site to those countries.
// `connections` and `delay` (ms) are per site: Tata Play answers 429 to ten
// requests at once — 1,231 of 1,292 came back empty on the first run — and
// still to a third of them one at a time 300 ms apart, so it gets a second.
const JOBS = [
  { key: 'tataplay', sites: ['tataplay.com'], connections: 1, delay: 1000 },
  { key: 'dishtv', sites: ['dishtv.in'] },
  { key: 'airtel', sites: ['airtelxstream.in'] },
  { key: 'sky', sites: ['sky.com'], countries: ['uk', 'in', 'pk', 'bd'] },
  { key: 'tvpassport', sites: ['tvpassport.com'], countries: ['us'] }
]

const CHANNEL = /<channel\s+([^>]*)>([\s\S]*?)<\/channel>/g
const ATTR = /(\w+)="([^"]*)"/g

function countryOf(id) {
  const base = id.split('@')[0]
  return base.slice(base.lastIndexOf('.') + 1).toLowerCase()
}

function readSite(site) {
  const dir = path.join(epgDir, 'sites', site)
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.channels.xml'))
  const entries = []
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8')
    for (const match of text.matchAll(CHANNEL)) {
      const attrs = Object.fromEntries([...match[1].matchAll(ATTR)].map(m => [m[1], m[2]]))
      entries.push({ attrs, name: match[2].trim() })
    }
  }
  return entries
}

function escapeAttr(value) {
  return value.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g, '&amp;').replace(/"/g, '&quot;')
}

fs.mkdirSync(outDir, { recursive: true })
const all = new Set()
const jobs = []

for (const job of JOBS) {
  const taken = new Set()
  const lines = []
  for (const site of job.sites) {
    for (const { attrs, name } of readSite(site)) {
      const id = attrs.xmltv_id
      if (!id || taken.has(id)) continue
      if (job.countries && !job.countries.includes(countryOf(id))) continue
      taken.add(id)
      all.add(id)
      const attrText = Object.entries(attrs)
        .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
        .join(' ')
      lines.push(`  <channel ${attrText}>${name}</channel>`)
    }
  }
  console.error(`${job.key}: ${lines.length} channels`)
  if (lines.length === 0) continue
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<channels>\n${lines.join('\n')}\n</channels>\n`
  fs.writeFileSync(path.join(outDir, `${job.key}.channels.xml`), xml)
  jobs.push({ key: job.key, connections: job.connections ?? 10, delay: job.delay ?? 0 })
}

console.error(`total: ${all.size} distinct channels in ${jobs.length} jobs`)
console.log(`jobs=${JSON.stringify(jobs)}`)

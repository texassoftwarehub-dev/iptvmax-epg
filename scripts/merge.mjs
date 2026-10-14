// Merges the grab jobs' XMLTV files into one gzipped guide per country plus
// `index.json`, which lists every channel with all its names so the app can
// match a provider's channel names without downloading a guide first.
//
// A channel can come from several jobs; its programmes are taken from the
// first job in priority order that has any, never mixed.
//
// usage: node scripts/merge.mjs <dir of guide-*.xml> <out dir> [job,job,…]

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const [inDir, outDir, priorityArg] = process.argv.slice(2)
const priority = (priorityArg ?? '').split(',').filter(Boolean)
if (!inDir || !outDir) {
  console.error('usage: merge.mjs <in dir> <out dir>')
  process.exit(1)
}

const API_CHANNELS = 'https://iptv-org.github.io/api/channels.json'

const CHANNEL = /<channel\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/g
const DISPLAY_NAME = /<display-name[^>]*>([\s\S]*?)<\/display-name>/g
const PROGRAMME = /<programme\b[^>]*>[\s\S]*?<\/programme>/g
const PROGRAMME_CHANNEL = /\bchannel="([^"]+)"/

function decode(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

function encode(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function countryOf(id) {
  const base = id.split('@')[0]
  const cc = base.slice(base.lastIndexOf('.') + 1).toLowerCase()
  return /^[a-z]{2}$/.test(cc) ? cc : 'xx'
}

// Alternative names from iptv-org's database: "STAR Plus", "Star Plus HD"…
let api = new Map()
try {
  const response = await fetch(API_CHANNELS)
  const list = await response.json()
  api = new Map(list.map(c => [c.id.toLowerCase(), [c.name, ...(c.alt_names ?? [])]]))
  console.error(`api: ${api.size} channels`)
} catch (error) {
  console.error(`api: unavailable (${error.message}), guide names only`)
}

const channels = new Map() // id -> { names:Set, xml }
const programmes = new Map() // id -> [xml]

const rank = file => {
  const index = priority.indexOf(file.replace(/^guide-/, '').replace(/\.xml$/, ''))
  return index === -1 ? priority.length : index
}
const files = (fs.existsSync(inDir) ? fs.readdirSync(inDir).filter(f => f.endsWith('.xml')) : [])
  .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))

for (const file of files) {
  const text = fs.readFileSync(path.join(inDir, file), 'utf8')
  for (const match of text.matchAll(CHANNEL)) {
    const id = match[1]
    const names = [...match[2].matchAll(DISPLAY_NAME)].map(m => decode(m[1])).filter(Boolean)
    if (!channels.has(id)) {
      const all = new Set(names)
      for (const name of api.get(id.split('@')[0].toLowerCase()) ?? []) if (name) all.add(name)
      channels.set(id, { names: all, body: match[2] })
    } else {
      for (const name of names) channels.get(id).names.add(name)
    }
  }
  const here = new Map()
  for (const match of text.matchAll(PROGRAMME)) {
    const id = match[0].match(PROGRAMME_CHANNEL)?.[1]
    if (!id || !channels.has(id)) continue
    if (!here.has(id)) here.set(id, [])
    here.get(id).push(match[0])
  }
  let taken = 0
  let filled = 0
  for (const [id, list] of here) {
    if (programmes.has(id)) continue
    programmes.set(id, list)
    taken += list.length
    filled++
  }
  console.error(`${file}: ${here.size} channels with programmes, ${filled} new (${taken} programmes)`)
}

const byCountry = new Map()
for (const [id, list] of programmes) {
  const cc = countryOf(id)
  if (!byCountry.has(cc)) byCountry.set(cc, [])
  byCountry.get(cc).push(id)
}

const total = [...programmes.values()].reduce((n, list) => n + list.length, 0)
if (total === 0) {
  console.error('no programmes at all: not publishing')
  process.exit(1)
}

fs.mkdirSync(outDir, { recursive: true })
const index = { generated: new Date().toISOString(), source: 'iptv-org/epg', files: {}, channels: [] }

for (const [cc, ids] of [...byCountry].sort()) {
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="iptvmax-epg">\n']
  let count = 0
  for (const id of ids.sort()) {
    const { names, body } = channels.get(id)
    const extra = [...names]
      .filter(name => !body.includes(`>${encode(name)}<`))
      .map(name => `<display-name>${encode(name)}</display-name>`)
      .join('')
    parts.push(`<channel id="${id}">${body}${extra}</channel>\n`)
  }
  for (const id of ids) {
    for (const xml of programmes.get(id)) {
      parts.push(xml, '\n')
      count++
    }
  }
  parts.push('</tv>\n')
  const gz = zlib.gzipSync(Buffer.from(parts.join(''), 'utf8'), { level: 9 })
  const name = `${cc}.xml.gz`
  fs.writeFileSync(path.join(outDir, name), gz)
  index.files[cc] = { path: name, channels: ids.length, programmes: count, bytes: gz.length }
  for (const id of ids) index.channels.push({ id, names: [...channels.get(id).names], file: cc })
  console.error(`${name}: ${ids.length} channels, ${count} programmes, ${gz.length} bytes`)
}

fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index))
fs.writeFileSync(
  path.join(outDir, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>IPTV Max guide data</title>
<p>TV guide data for the IPTV Max app, rebuilt twice a day from
<a href="https://github.com/iptv-org/epg">iptv-org/epg</a>. Generated ${index.generated}.</p>
<ul>${Object.entries(index.files)
    .map(([cc, f]) => `<li><a href="${f.path}">${f.path}</a> — ${f.channels} channels, ${f.programmes} programmes</li>`)
    .join('')}</ul>\n`
)
console.error(`index.json: ${index.channels.length} channels, ${total} programmes`)

import { readFileSync, writeFileSync } from 'node:fs'
import { VERSION_FILE, VERSION_REFERENCES } from './lib/release-candidate-files.mjs'

const root = new URL('../../', import.meta.url)
const version = readFileSync(new URL(VERSION_FILE, root), 'utf8').trim()
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid VERSION: ${version}`)

for (const { path, sync } of VERSION_REFERENCES) {
  const url = new URL(path, root)
  const before = readFileSync(url, 'utf8')
  const after = sync(before, version)
  if (after !== before) writeFileSync(url, after)
}

console.log(`Synchronized package metadata and current documentation to VERSION ${version}`)

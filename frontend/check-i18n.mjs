// Prove EN/ZH key parity for src/i18n.ts (flat string dicts only).
// Fails (exit 1) on any missing key in either locale, or on any JA/KO
// locale marker in the file. Run: npm run check-i18n
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('./src/i18n.ts', import.meta.url), 'utf-8')
if (/\b(ja|ko|jp|kr)\b\s*[:=]|locale\s*=\s*['"](ja|ko)/i.test(src) || /export const (ja|ko)\b/.test(src)) {
  console.error('FAIL: JA/KO locale content detected in i18n.ts')
  process.exit(1)
}
const splitAt = src.indexOf('export const zh')
if (splitAt < 0) { console.error('FAIL: zh dict not found'); process.exit(1) }
const keys = (block) => [...block.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((m) => m[1])
const enKeys = keys(src.slice(0, splitAt))
const zhKeys = keys(src.slice(splitAt))
const missingInZh = enKeys.filter((k) => !zhKeys.includes(k))
const missingInEn = zhKeys.filter((k) => !enKeys.includes(k))
console.log(`EN keys: ${enKeys.length}, ZH keys: ${zhKeys.length}`)
console.log(`Missing in ZH: ${missingInZh.length} ${missingInZh.join(', ') || '(none)'}`)
console.log(`Missing in EN: ${missingInEn.length} ${missingInEn.join(', ') || '(none)'}`)
if (missingInZh.length || missingInEn.length) process.exit(1)
console.log('OK: zero missing keys, EN/ZH only')

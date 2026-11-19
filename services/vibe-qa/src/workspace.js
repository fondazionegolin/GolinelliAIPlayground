'use strict'
// Per-run scratch project: files written under a temp dir that sees the image's node_modules.
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const NODE_MODULES = path.join(__dirname, '..', 'node_modules')

function safeRel(p) {
  const rel = path.posix.normalize(String(p || '').replace(/\\/g, '/')).replace(/^\/+/, '')
  if (!rel || rel.startsWith('..') || rel.includes('\0')) return null
  return rel
}

function createWorkspace(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-qa-' + crypto.randomBytes(3).toString('hex') + '-'))
  const written = []
  for (const file of files || []) {
    const rel = safeRel(file.path)
    if (!rel) continue
    const target = path.join(root, rel)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, String(file.content ?? ''))
    written.push(rel)
  }
  try { fs.symlinkSync(NODE_MODULES, path.join(root, 'node_modules'), 'dir') } catch (_) { /* already there */ }
  return { root, written, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

const CODE_EXT = /\.(tsx?|jsx?)$/i

function importedPackages(files) {
  const found = new Set()
  const re = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"]([^'"./][^'"]*)['"]/g
  for (const file of files || []) {
    if (!CODE_EXT.test(file.path || '')) continue
    let m
    while ((m = re.exec(String(file.content || '')))) {
      const spec = m[1]
      found.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])
    }
  }
  return [...found]
}

function installed(pkg) {
  return fs.existsSync(path.join(NODE_MODULES, pkg))
}

module.exports = { createWorkspace, importedPackages, installed, safeRel, CODE_EXT }

// PDF validation with veraPDF (https://verapdf.org), the reference validator for
// PDF/UA and PDF/A. Used in this order:
//   1. TEMPLAITOR_VERAPDF: path to the veraPDF executable
//   2. `verapdf` in the PATH
//   3. Docker with the official image (TEMPLAITOR_VERAPDF_IMAGE, default verapdf/cli:latest)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { run } from './pdf.js'

const IMAGE = () => process.env.TEMPLAITOR_VERAPDF_IMAGE || 'verapdf/cli:latest'

// Plain-language explanations of the most common PDF/UA-1 rules
const HINTS = {
  '7.1-3': 'Some content is neither tagged nor marked as an artifact (usually headers/footers or decoration the engine does not tag).',
  '7.1-8': 'The XMP metadata with the PDF/UA identifier (pdfuaid:part) is missing.',
  '7.1-9': 'The metadata does not include the document title (dc:title).',
  '7.1-10': 'The viewer does not display the document title (DisplayDocTitle).',
  '7.2-34': 'The language of some text is not declared.',
  '7.3-1': 'A figure has no text alternative.',
  '7.18.1-2': 'Some annotations (links) are outside the tag structure.',
  '7.18.5-1': 'Some links are not tagged as Link.',
  '7.18.5-2': 'Links have no alternate description (/Contents).',
  '7.21.4.1-1': 'Some fonts are not embedded.',
}

let cached = null

/** How to run veraPDF here: { kind: 'binary' | 'docker', cmd, label } or null */
export function verapdfRunner() {
  if (cached !== null) return cached || null
  const candidates = [process.env.TEMPLAITOR_VERAPDF, 'verapdf'].filter(Boolean)
  for (const cmd of candidates) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 30000 })
    if (r.status === 0) return (cached = { kind: 'binary', cmd, label: firstLine(r.stdout) })
  }
  const docker = spawnSync('docker', ['image', 'inspect', IMAGE(), '--format', '{{.Id}}'], { encoding: 'utf8', timeout: 15000 })
  if (docker.status === 0) return (cached = { kind: 'docker', cmd: 'docker', label: `veraPDF (docker ${IMAGE()})` })
  cached = false
  return null
}

export function resetVerapdfCache() { cached = null }

/**
 * Validates a PDF (Buffer) against PDF/UA-1 (`flavour: 'ua1'`) or another veraPDF profile (e.g. '2b', 'ua2').
 * Devuelve { validator, profile, compliant, passedRules, failedRules, failedChecks, rules: [...] }
 */
export async function validatePdf(pdf, { flavour = 'ua1' } = {}) {
  const runner = verapdfRunner()
  if (!runner) {
    const err = new Error('veraPDF is not available: install it (https://verapdf.org/software/) or use Docker (`make verapdf` pulls the verapdf/cli image)')
    err.status = 501
    throw err
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-verapdf-'))
  try {
    fs.writeFileSync(path.join(dir, 'document.pdf'), pdf)
    // the veraPDF container does not run as root: it must be able to read the directory
    fs.chmodSync(dir, 0o755)
    fs.chmodSync(path.join(dir, 'document.pdf'), 0o644)
    const args = runner.kind === 'docker'
      ? ['run', '--rm', '-v', `${dir}:/data:ro`, IMAGE(), '--flavour', flavour, '--format', 'json', '/data/document.pdf']
      : ['--flavour', flavour, '--format', 'json', path.join(dir, 'document.pdf')]
    const { stdout, stderr, code } = await run(runner.cmd, args, 180000)
    let report
    try {
      report = JSON.parse(stdout.slice(stdout.indexOf('{')))
    } catch {
      throw Object.assign(new Error(`veraPDF returned no report (${code}): ${stderr.split('\n').slice(-3).join(' ')}`), { status: 500 })
    }
    return summarize(report, runner)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function summarize(report, runner) {
  const job = report.report?.jobs?.[0] || {}
  const v = Array.isArray(job.validationResult) ? job.validationResult[0] : job.validationResult
  if (!v) throw Object.assign(new Error(`veraPDF could not process the PDF: ${JSON.stringify(job.taskException || job.itemDetails || {}).slice(0, 200)}`), { status: 500 })
  const d = v.details || {}
  const version = report.report?.buildInformation?.releaseDetails?.find?.(r => r.id === 'gui' || r.id === 'core')?.version
  return {
    validator: version ? `veraPDF ${version}` : runner.label,
    profile: v.profileName,
    compliant: !!v.compliant,
    passedRules: d.passedRules ?? 0,
    failedRules: d.failedRules ?? 0,
    failedChecks: d.failedChecks ?? 0,
    rules: (d.ruleSummaries || []).map(r => ({
      specification: r.specification,
      clause: r.clause,
      test: r.testNumber,
      id: `${r.clause}-${r.testNumber}`,
      checks: r.failedChecks,
      description: r.description,
      hint: HINTS[`${r.clause}-${r.testNumber}`] || null,
    })),
  }
}

const firstLine = (s) => String(s || '').trim().split('\n')[0]

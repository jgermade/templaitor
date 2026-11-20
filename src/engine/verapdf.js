// Validación de PDF con veraPDF (https://verapdf.org), el validador de referencia
// de PDF/UA y PDF/A. Se usa, por orden:
//   1. TEMPLAITOR_VERAPDF: ruta al ejecutable de veraPDF
//   2. `verapdf` en el PATH
//   3. Docker con la imagen oficial (TEMPLAITOR_VERAPDF_IMAGE, por defecto verapdf/cli:latest)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { run } from './pdf.js'

const IMAGE = () => process.env.TEMPLAITOR_VERAPDF_IMAGE || 'verapdf/cli:latest'

// Explicaciones (es) de las reglas PDF/UA-1 más habituales
const HINTS = {
  '7.1-3': 'Hay contenido sin etiquetar ni marcar como artefacto (suele venir de cabeceras/pies o decoración que el motor no etiqueta).',
  '7.1-8': 'Faltan los metadatos XMP con el identificador PDF/UA (pdfuaid:part).',
  '7.1-9': 'Los metadatos no incluyen el título del documento (dc:title).',
  '7.1-10': 'El visor no muestra el título del documento (DisplayDocTitle).',
  '7.2-34': 'El idioma de algún texto no está declarado.',
  '7.3-1': 'Una figura no tiene texto alternativo.',
  '7.18.1-2': 'Hay anotaciones (enlaces) fuera de la estructura etiquetada.',
  '7.18.5-1': 'Hay enlaces que no están etiquetados como Link.',
  '7.18.5-2': 'Los enlaces no tienen descripción alternativa (/Contents).',
  '7.21.4.1-1': 'Hay fuentes no incrustadas.',
}

let cached = null

/** Cómo ejecutar veraPDF en este entorno: { kind: 'binary' | 'docker', cmd, label } o null */
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
 * Valida un PDF (Buffer) contra PDF/UA-1 (`flavour: 'ua1'`) u otro perfil de veraPDF (p.ej. '2b', 'ua2').
 * Devuelve { validator, profile, compliant, passedRules, failedRules, failedChecks, rules: [...] }
 */
export async function validatePdf(pdf, { flavour = 'ua1' } = {}) {
  const runner = verapdfRunner()
  if (!runner) {
    const err = new Error('veraPDF no está disponible: instálalo (https://verapdf.org/software/) o usa Docker (`make verapdf` descarga la imagen verapdf/cli)')
    err.status = 501
    throw err
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-verapdf-'))
  try {
    fs.writeFileSync(path.join(dir, 'document.pdf'), pdf)
    // el contenedor de veraPDF no corre como root: necesita poder leer el directorio
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
      throw Object.assign(new Error(`veraPDF no devolvió un informe (${code}): ${stderr.split('\n').slice(-3).join(' ')}`), { status: 500 })
    }
    return summarize(report, runner)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function summarize(report, runner) {
  const job = report.report?.jobs?.[0] || {}
  const v = Array.isArray(job.validationResult) ? job.validationResult[0] : job.validationResult
  if (!v) throw Object.assign(new Error(`veraPDF no pudo procesar el PDF: ${JSON.stringify(job.taskException || job.itemDetails || {}).slice(0, 200)}`), { status: 500 })
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

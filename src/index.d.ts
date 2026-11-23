// Types of the public API (src/index.js). The data each template expects comes from its data contract:
// `TemplateData` (../templates.d.ts) is generated from the templates shipped in this package by
// `templaitor types`; for a project of your own, generate its types and pass them as the type parameter:
//
//   import type { TemplateData } from './emails/templates'   // npx templaitor types --cwd emails --out emails/templates.d.ts
//   const engine = createEngine<TemplateData>({ cwd: 'emails' })
import type { TemplateData as BundledTemplateData } from '../templates.js'

export type { BundledTemplateData }

/** A template pinned to a version: 3 · 'v3' · 'latest' · a git revision */
export type VersionSpec = number | string

export interface ContractError { path: string; message: string; template?: string }

/** Thrown with `status` 422 (data that does not match the contract), 400, 404… */
export interface TemplaitorError extends Error { status?: number; details?: ContractError[] }

export interface AttachmentInfo { type: 'template' | 'url'; filename: string; template?: string; locale?: string; url?: string; context?: string | null }
export interface AttachmentFile { filename: string; content: Buffer; contentType?: string }

export interface RenderedMessage {
  template: string
  format: 'email'
  locale: string
  lang: string
  subject: string
  html: string
  text: string
  version: { number: number | null; rev: string; short: string } | null
  attachments: AttachmentInfo[]
  warnings: string[]
}

export interface RenderOptions<D> {
  /** key (es), locale (es-ES) or a locale's language; default: the template's first language */
  lang?: string
  data?: D
  version?: VersionSpec
  /** false skips the data contract check (otherwise a 422 TemplaitorError lists what does not match) */
  validate?: boolean
}

export interface Version { id: string; rev: string; short: string; number: number | null; message: string; author: string; email?: string; date: string }

export interface Engine<T extends object = BundledTemplateData> {
  project: Record<string, unknown>
  templates(): { id: string; format: 'email' | 'pdf'; langs: string[] }[]
  components(): { id: string; params: Record<string, unknown> }[]
  layouts(): { id: string }[]
  /** An email for one recipient (its data checked against the template's contract) */
  render<K extends keyof T & string>(id: K, options?: RenderOptions<T[K]>): Promise<RenderedMessage>
  /** Files of a rendered email's attachments */
  attachments(message: RenderedMessage): Promise<AttachmentFile[]>
  /** A PDF template rendered with data */
  pdf<K extends keyof T & string>(id: K, options?: RenderOptions<T[K]> & { engine?: 'weasyprint' | 'prince' | 'chromium' }):
    Promise<{ pdf: Buffer; engine: string; locale: string; title: string; version: RenderedMessage['version'] }>
  /** The Jinja2 output of a template in one language, without data */
  compile(id: keyof T & string, options?: { lang?: string }):
    Promise<{ format: 'email' | 'pdf'; locale: string; subject: string; html: string; text: string; attachments: AttachmentInfo[]; warnings: string[] }>
  /** Writes the compiled output (and templates.d.ts) to outDir */
  build(options?: { id?: string; log?: ((line: string) => void) | null }): Promise<{ files: string[]; issues: { level: string; template: string; locale: string; message: string }[] }>
  /** JSON Schema (2020-12) of the template's data contract, or null when it declares none */
  schema(id: keyof T & string, options?: { version?: VersionSpec }): Promise<Record<string, unknown> | null>
  /** TypeScript declarations of every template's data */
  types(): string
  versions(id: string, options?: { kind?: 'template' | 'component' | 'layout'; limit?: number }): Promise<Version[]>
  version(id: string, rev: string, options?: { kind?: 'template' | 'component' | 'layout' }): Promise<Version & { mjml: string; yml?: string | null; data?: string | null }>
}

/** Folder of the templaitor project shipped with this package */
export const BUNDLED_PROJECT: string

/**
 * Engine for one templaitor project (default: the templates shipped in this package).
 * Pass the generated `TemplateData` of your own project as the type parameter.
 */
export function createEngine<T extends object = BundledTemplateData>(options?: {
  cwd?: string
  overrides?: Record<string, unknown>
  fetch?: typeof fetch
}): Engine<T>

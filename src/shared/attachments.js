// Email attachments declared in the template frontmatter (browser-safe: used by the editor too).
//
//   attachments:
//     - template: documents/invoice          # local PDF template, rendered in the email's language
//       filename: "$t('invoice_file')"       # optional ($ commands and Jinja2 allowed)
//       context: invoice                     # optional: email variable used as the document's context
//     - url: "https://example.com/terms-$lang.pdf"   # remote file ($ commands and Jinja2 allowed)
//       filename: terms.pdf
//
// Short forms: `- documents/invoice` (local) and `- https://…` (remote).

const REMOTE = /^https?:\/\//i

/** Normalizes the `attachments` frontmatter value to a list of { type, ref, filename, context } */
export function normalizeAttachments(value) {
  if (value == null || value === '') return []
  const list = Array.isArray(value) ? value : [value]
  return list.map((entry) => {
    if (typeof entry === 'string') {
      const ref = entry.trim()
      return { type: REMOTE.test(ref) ? 'url' : 'template', ref, filename: '', context: '' }
    }
    if (!entry || typeof entry !== 'object') return { type: 'invalid', ref: String(entry ?? ''), filename: '', context: '' }
    const type = entry.url != null ? 'url' : entry.template != null ? 'template' : 'invalid'
    return {
      type,
      ref: String(entry.url ?? entry.template ?? '').trim(),
      filename: entry.filename != null ? String(entry.filename) : '',
      context: entry.context != null ? String(entry.context).trim() : '',
    }
  })
}

/** Default file name of an attachment (before rendering) */
export function defaultFilename(att) {
  if (att.type === 'template') return `${att.ref.split('/').pop() || 'document'}.pdf`
  const path = att.ref.replace(/[?#].*$/, '').replace(/\/+$/, '')
  return decodeURIComponent(path.split('/').pop() || 'attachment')
}

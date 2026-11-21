// Service emails (sign-in codes, invitations) sent with the system SMTP of templaitor.server.yml.
// Without a system SMTP the email is printed to the console (development) and kept in `outbox`.

export function createMailer(config, { transportFactory, log = console.log } = {}) {
  const outbox = []
  let transport = null
  const getTransport = async () => {
    if (transport) return transport
    if (transportFactory) return (transport = transportFactory(config.smtp))
    const { default: nodemailer } = await import('nodemailer')
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      ...(config.smtp.user ? { auth: { user: config.smtp.user, pass: config.smtp.pass } } : {}),
    })
    return transport
  }

  async function send({ to, subject, text, html }) {
    outbox.push({ to, subject, text, html, at: Date.now() })
    if (outbox.length > 50) outbox.shift()
    if (!config.smtp && !transportFactory) {
      log?.(`\n✉ (no system SMTP configured) to: ${to}\n  ${subject}\n  ${text.replace(/\n/g, '\n  ')}\n`)
      return
    }
    const t = await getTransport()
    await t.sendMail({ from: config.smtp?.from || 'templaitor <no-reply@localhost>', to, subject, text, html })
  }

  return {
    outbox,
    send,
    sendCode: (to, code) => send({
      to,
      subject: `${code} is your ${config.appName} sign-in code`,
      text: `Your sign-in code is ${code}\n\nIt expires in 10 minutes. If you did not request it, ignore this email.\n\n${config.baseUrl}`,
      html: layout(config, `Your sign-in code`, `<p style="margin:0 0 16px">Your sign-in code is:</p>
        <p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px;font-family:monospace">${code}</p>
        <p style="margin:0;color:#4b5563">It expires in 10 minutes. If you did not request it, ignore this email.</p>`),
    }),
    sendInvitation: (to, { orgName, inviter }) => send({
      to,
      subject: `${inviter} invited you to ${orgName} on ${config.appName}`,
      text: `${inviter} invited you to the organization "${orgName}".\n\nSign in with this email address to join: ${config.baseUrl}`,
      html: layout(config, `Invitation to ${esc(orgName)}`, `<p style="margin:0 0 16px">${esc(inviter)} invited you to the organization <b>${esc(orgName)}</b>.</p>
        <p style="margin:0"><a href="${config.baseUrl}" style="color:#4338ca">Sign in with this email address</a> to join.</p>`),
    }),
  }
}

function layout(config, title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;padding:24px;background:#f4f4f5;font:16px/1.5 Helvetica,Arial,sans-serif;color:#111827">
<main style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;padding:24px">
<h1 style="margin:0 0 16px;font-size:20px">${title}</h1>${body}
</main></body></html>`
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

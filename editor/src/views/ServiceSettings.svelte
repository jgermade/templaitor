<script>
  import Checkbox from '../components/Checkbox.svelte'
  import Icon from '../components/Icon.svelte'
  // Hosted service settings: organization, members, SMTP, API keys, send log and account (passkeys).
  import { session, svc } from '../lib/service.svelte.js'
  import { confirmDialog, promptDialog } from '../lib/dialogs.svelte.js'
  import { store } from '../stores/editor.svelte.js'

  let { open = $bindable(false) } = $props()
  let dialog = $state()
  let tab = $state('org')
  let error = $state('')
  let busy = $state(false)

  const org = $derived(session.activeOrg)
  const base = $derived(`/orgs/${org?.id}`)
  const TABS = $derived([
    ['org', 'Organization'],
    ['members', 'Members'],
    ...(session.isAdmin ? [['smtp', 'SMTP'], ['keys', 'API keys']] : []),
    ['log', 'Send log'],
    ['account', 'Account'],
  ])

  let members = $state({ members: [], invitations: [] })
  let smtp = $state(null)
  let smtpPassword = $state('')
  let keys = $state([])
  let newKey = $state(null)
  let log = $state([])
  let logDetail = $state(null)
  let passkeys = $state([])
  let orgName = $state('')
  let userName = $state('')
  let inviteEmail = $state('')
  let inviteRole = $state('editor')

  $effect(() => {
    if (open) { dialog?.showModal(); load(tab) } else dialog?.close()
  })

  async function run(fn) {
    busy = true
    error = ''
    try { await fn() } catch (e) { error = e.message } finally { busy = false }
  }

  function load(t) {
    tab = t
    newKey = null
    logDetail = null
    return run(async () => {
      if (t === 'org') orgName = org.name
      if (t === 'members') members = await svc.get(`${base}/members`)
      if (t === 'smtp') { smtp = await svc.get(`${base}/smtp`); smtpPassword = '' }
      if (t === 'keys') keys = await svc.get(`${base}/keys`)
      if (t === 'log') log = await svc.get(`${base}/messages?limit=100`)
      if (t === 'account') { passkeys = await svc.get('/auth/passkeys'); userName = session.user.name }
    })
  }

  const saveOrg = () => run(async () => { await svc.patch(base, { name: orgName }); store.notify('Organization renamed', 'success'); session.activeOrg = { ...org, name: orgName } })
  const deleteOrg = () => run(async () => {
    const slug = await promptDialog({ title: `Delete ${org.name}`, message: 'This deletes its templates, members, API keys and send log.', label: `Type ${org.slug} to confirm`, okLabel: 'Delete' })
    if (slug == null) return
    await svc.del(base, { confirm: slug })
    location.hash = ''
    location.reload()
  })

  const invite = (e) => {
    e.preventDefault()
    run(async () => {
      await svc.post(`${base}/invitations`, { email: inviteEmail, role: inviteRole })
      store.notify(`Invitation sent to ${inviteEmail}`, 'success')
      inviteEmail = ''
      members = await svc.get(`${base}/members`)
    })
  }
  const setRole = (m, role) => run(async () => { await svc.patch(`${base}/members/${m.id}`, { role }); members = await svc.get(`${base}/members`) })
  const removeMember = (m) => run(async () => {
    const self = m.id === session.user.id
    if (!(await confirmDialog({ title: self ? 'Leave organization' : 'Remove member', message: self ? `You will lose access to ${org.name}.` : m.email, okLabel: self ? 'Leave' : 'Remove', danger: true }))) return
    await svc.del(`${base}/members/${m.id}`)
    if (self) { location.hash = ''; location.reload() } else members = await svc.get(`${base}/members`)
  })
  const cancelInvitation = (i) => run(async () => { await svc.del(`${base}/invitations/${i.id}`); members = await svc.get(`${base}/members`) })

  const saveSmtp = (e) => {
    e.preventDefault()
    run(async () => {
      smtp = await svc.put(`${base}/smtp`, { ...smtp, password: smtpPassword || undefined })
      smtpPassword = ''
      store.notify('SMTP saved', 'success')
    })
  }
  const testSmtp = () => run(async () => {
    const to = await promptDialog({ title: 'Send a test email', label: 'Recipient', value: session.user.email, inputType: 'email', okLabel: 'Send' })
    if (!to) return
    const m = await svc.post(`${base}/smtp/test`, { to })
    store.notify(`Test queued (${m.id.slice(0, 8)}) — see the send log`, 'success')
  })

  const createKey = () => run(async () => {
    const name = await promptDialog({ title: 'New API key', label: 'Name', placeholder: 'backend (production)', okLabel: 'Create' })
    if (!name) return
    newKey = await svc.post(`${base}/keys`, { name })
    keys = await svc.get(`${base}/keys`)
  })
  const revokeKey = (k) => run(async () => {
    if (!(await confirmDialog({ title: 'Revoke API key', message: `${k.name} (tpl_${k.prefix}_…) stops working immediately.`, okLabel: 'Revoke', danger: true }))) return
    await svc.del(`${base}/keys/${k.id}`)
    keys = await svc.get(`${base}/keys`)
  })
  const copy = (text) => navigator.clipboard?.writeText(text).then(() => store.notify('Copied', 'success'))

  const showMessage = (m) => run(async () => { logDetail = await svc.get(`${base}/messages/${m.id}`) })

  const saveName = () => run(async () => { await svc.patch('/auth/me', { name: userName }); session.user = { ...session.user, name: userName }; store.notify('Saved', 'success') })
  const addPasskey = () => run(async () => {
    const { startRegistration } = await import('@simplewebauthn/browser')
    const { options, challengeId } = await svc.post('/auth/passkeys/register/options')
    let response
    try { response = await startRegistration({ optionsJSON: options }) } catch (e) {
      throw new Error(e.name === 'NotAllowedError' ? 'Passkey creation was cancelled' : e.message)
    }
    await svc.post('/auth/passkeys/register', { challengeId, response, name: guessDevice() })
    passkeys = await svc.get('/auth/passkeys')
    store.notify('Passkey added', 'success')
  })
  const renamePasskey = (p) => run(async () => {
    const name = await promptDialog({ title: 'Rename passkey', label: 'Name', value: p.name, okLabel: 'Save' })
    if (!name) return
    await svc.patch(`/auth/passkeys/${p.id}`, { name })
    passkeys = await svc.get('/auth/passkeys')
  })
  const removePasskey = (p) => run(async () => {
    if (!(await confirmDialog({ title: 'Remove passkey', message: p.name, okLabel: 'Remove', danger: true }))) return
    await svc.del(`/auth/passkeys/${p.id}`)
    passkeys = await svc.get('/auth/passkeys')
  })

  function guessDevice() {
    const ua = navigator.userAgent
    return /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Passkey'
  }
  const when = (t) => (t ? new Date(t).toLocaleString() : '—')
  const curl = (key) => `curl ${location.origin}/v1/send \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"template": "${store.templates.find(t => t.format !== 'pdf')?.id ?? 'group/name'}", "lang": "${store.lang ?? 'en'}", "to": "someone@example.com", "data": {}}'`
</script>

<dialog bind:this={dialog} class="settings" aria-labelledby="settings-title" oncancel={(e) => { e.preventDefault(); open = false }}>
  <div class="dhead">
    <h2 id="settings-title">{org?.name} <span class="muted role">· {org?.role}</span></h2>
    <button class="ghost" aria-label="Close settings" onclick={() => (open = false)}><Icon name="x" size={16} /></button>
  </div>
  <div class="body">
    <nav aria-label="Settings sections">
      {#each TABS as [t, label]}
        <button class:active={tab === t} aria-current={tab === t ? 'page' : undefined} onclick={() => load(t)}>{label}</button>
      {/each}
    </nav>
    <section aria-live="polite">
      {#if error}<p class="error" role="alert">{error}</p>{/if}

      {#if tab === 'org'}
        <h3>Organization</h3>
        <label class="field"><span>Name</span>
          <div class="row"><input bind:value={orgName} disabled={!session.isAdmin} /><button onclick={saveOrg} disabled={!session.isAdmin || busy || !orgName.trim()}>Save</button></div>
        </label>
        <p class="muted">Slug <code>{org.slug}</code> · templates stored in <b>{org.storage === 'db' ? 'the database' : org.mapped ? 'a mapped folder' : 'a folder'}</b>.</p>
        <h3>Your organizations</h3>
        <ul class="list">
          {#each session.orgs as o}
            <li><span>{o.name} <span class="muted">· {o.role}</span></span>
              {#if o.id === org.id}<span class="muted">current</span>{:else}<button onclick={() => session.switchOrg(o.id)}>Switch</button>{/if}
            </li>
          {/each}
        </ul>
        <button onclick={() => run(async () => {
          const name = await promptDialog({ title: 'New organization', label: 'Name', okLabel: 'Create' })
          if (!name) return
          const o = await svc.post('/orgs', { name })
          await session.switchOrg(o.id)
        })}><Icon name="plus" size={13} /> New organization</button>
        {#if org.role === 'owner'}
          <h3 class="danger-zone">Danger zone</h3>
          <button class="danger" onclick={deleteOrg}>Delete organization</button>
        {/if}

      {:else if tab === 'members'}
        <h3>Members</h3>
        <table>
          <thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
          <tbody>
            {#each members.members as m}
              <tr>
                <td>{m.email}{m.id === session.user.id ? ' (you)' : ''}</td>
                <td>
                  {#if session.isAdmin && m.id !== session.user.id}
                    <select aria-label={`Role of ${m.email}`} value={m.role} onchange={(e) => setRole(m, e.currentTarget.value)}>
                      {#each ['viewer', 'editor', 'admin', ...(org.role === 'owner' ? ['owner'] : [])] as r}<option value={r}>{r}</option>{/each}
                      {#if m.role === 'owner' && org.role !== 'owner'}<option value="owner">owner</option>{/if}
                    </select>
                  {:else}{m.role}{/if}
                </td>
                <td>{#if session.isAdmin || m.id === session.user.id}<button class="ghost danger" onclick={() => removeMember(m)}>{m.id === session.user.id ? 'Leave' : 'Remove'}</button>{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if session.isAdmin}
          {#if members.invitations.length}
            <h3>Pending invitations</h3>
            <ul class="list">
              {#each members.invitations as i}<li><span>{i.email} <span class="muted">· {i.role}</span></span><button class="ghost danger" onclick={() => cancelInvitation(i)}>Cancel</button></li>{/each}
            </ul>
          {/if}
          <h3>Invite</h3>
          <form class="row" onsubmit={invite}>
            <input type="email" required placeholder="email@company.com" aria-label="Email to invite" bind:value={inviteEmail} />
            <select aria-label="Role" bind:value={inviteRole}>
              {#each ['viewer', 'editor', 'admin', ...(org.role === 'owner' ? ['owner'] : [])] as r}<option value={r}>{r}</option>{/each}
            </select>
            <button class="primary" disabled={busy}>Invite</button>
          </form>
          <p class="muted small">They sign in with that email (code or passkey) and join automatically. Roles: <b>viewer</b> reads and previews · <b>editor</b> edits and sends tests · <b>admin</b> manages members, SMTP and API keys · <b>owner</b> can delete the organization.</p>
        {/if}

      {:else if tab === 'smtp' && smtp}
        <h3>SMTP</h3>
        <p class="muted small">Used by the send API and the editor's test sends. Works with any provider (SES, Postmark, Mailgun, Brevo, your own server…). The password is stored encrypted.</p>
        <form class="grid" onsubmit={saveSmtp}>
          <label class="field span2"><span>Host</span><input bind:value={smtp.host} placeholder="smtp.example.com" /></label>
          <label class="field"><span>Port</span><input type="number" min="1" max="65535" bind:value={smtp.port} /></label>
          <Checkbox bind:checked={smtp.secure} class="field check">TLS from the start (port 465)</Checkbox>
          <label class="field"><span>User</span><input autocomplete="off" bind:value={smtp.user} /></label>
          <label class="field"><span>Password</span><input type="password" autocomplete="new-password" placeholder={smtp.hasPassword ? '•••••• (unchanged)' : ''} bind:value={smtpPassword} /></label>
          <label class="field span2"><span>From</span><input bind:value={smtp.from} placeholder="Acme <no-reply@acme.com>" /></label>
          <div class="row span2"><button class="primary" disabled={busy}>Save</button><button type="button" onclick={testSmtp} disabled={busy || !smtp.host}>Send a test</button></div>
        </form>

      {:else if tab === 'keys'}
        <h3>API keys</h3>
        {#if newKey}
          <div class="newkey" role="status">
            <p><b>Copy the key now</b>: it is not shown again.</p>
            <div class="row"><code class="mono">{newKey.key}</code><button onclick={() => copy(newKey.key)}>Copy</button></div>
            <p class="small">Send an email with a hosted template:</p>
            <pre>{curl(newKey.key)}</pre>
          </div>
        {/if}
        <table>
          <thead><tr><th scope="col">Name</th><th scope="col">Key</th><th scope="col">Last used</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
          <tbody>
            {#each keys as k}
              <tr class:revoked={k.revoked_at}>
                <td>{k.name}</td><td class="mono">tpl_{k.prefix}_…</td><td>{k.revoked_at ? 'revoked' : when(k.last_used_at)}</td>
                <td>{#if !k.revoked_at}<button class="ghost danger" onclick={() => revokeKey(k)}>Revoke</button>{/if}</td>
              </tr>
            {:else}<tr><td colspan="4" class="muted">No API keys</td></tr>{/each}
          </tbody>
        </table>
        <button onclick={createKey} disabled={busy}><Icon name="plus" size={13} /> New API key</button>
        <p class="muted small"><code>POST /v1/send</code> with <code>template</code> + <code>data</code> (hosted) or <code>subject</code> + <code>html</code> (raw) · <code>POST /v1/render</code> · <code>GET /v1/messages/:id</code> · <code>GET /v1/templates</code>.</p>

      {:else if tab === 'log'}
        <h3>Send log <button class="ghost small" onclick={() => load('log')} aria-label="Refresh the send log" title="Refresh"><Icon name="refresh" size={13} /></button></h3>
        {#if logDetail}
          <button class="ghost" onclick={() => (logDetail = null)}><Icon name="arrow-left" size={14} /> Back</button>
          <dl class="detail">
            <dt>Status</dt><dd><span class="st {logDetail.status}">{logDetail.status}</span> · {logDetail.attempts} attempt(s){logDetail.lastError ? ` · ${logDetail.lastError}` : ''}</dd>
            <dt>To</dt><dd>{[...logDetail.to, ...(logDetail.cc || [])].join(', ')}</dd>
            <dt>Subject</dt><dd>{logDetail.subject}</dd>
            <dt>Source</dt><dd>{logDetail.template ? `${logDetail.template} (${logDetail.locale})` : 'raw HTML'}</dd>
            {#if logDetail.attachments.length}<dt>Attachments</dt><dd>{logDetail.attachments.join(', ')}</dd>{/if}
            <dt>Created</dt><dd>{when(logDetail.createdAt)}{logDetail.sentAt ? ` · sent ${when(logDetail.sentAt)}` : ''}</dd>
          </dl>
          <iframe title="Sent email" sandbox="" srcdoc={logDetail.html}></iframe>
        {:else}
          <table>
            <thead><tr><th scope="col">When</th><th scope="col">To</th><th scope="col">Subject</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {#each log as m}
                <tr class="click" onclick={() => showMessage(m)}>
                  <td>{when(m.createdAt)}</td><td>{m.to.join(', ')}</td>
                  <td><button class="link" onclick={(e) => { e.stopPropagation(); showMessage(m) }}>{m.subject}</button>{#if m.attachments.length} <Icon name="paperclip" size={12} label="with attachments" />{/if}</td>
                  <td><span class="st {m.status}">{m.status}</span></td>
                </tr>
              {:else}<tr><td colspan="4" class="muted">Nothing sent yet</td></tr>{/each}
            </tbody>
          </table>
        {/if}

      {:else if tab === 'account'}
        <h3>Account</h3>
        <p class="muted">{session.user.email}</p>
        <label class="field"><span>Name</span>
          <div class="row"><input bind:value={userName} /><button onclick={saveName} disabled={busy}>Save</button></div>
        </label>
        <h3>Passkeys</h3>
        <p class="muted small">Sign in with your fingerprint, face or device PIN instead of an email code.</p>
        <ul class="list">
          {#each passkeys as p}
            <li><span><Icon name="key" size={13} /> {p.name} <span class="muted">· added {when(p.created_at)}{p.last_used_at ? ` · used ${when(p.last_used_at)}` : ''}</span></span>
              <span><button class="ghost" onclick={() => renamePasskey(p)}>Rename</button><button class="ghost danger" onclick={() => removePasskey(p)}>Remove</button></span>
            </li>
          {:else}<li class="muted">No passkeys yet</li>{/each}
        </ul>
        <button onclick={addPasskey} disabled={busy || !window.PublicKeyCredential}><Icon name="plus" size={13} /> Add a passkey</button>
        <h3>Session</h3>
        <button onclick={() => session.logout()}>Sign out</button>
      {/if}
    </section>
  </div>
</dialog>

<style>
  .settings { border: 1px solid var(--border); border-radius: 12px; padding: 0; width: min(900px, calc(100vw - 32px)); height: min(640px, calc(100vh - 32px)); color: var(--text); }
  .settings::backdrop { background: rgba(24, 24, 27, .38); }
  .settings[open] { display: flex; flex-direction: column; }
  .dhead { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); }
  h2 { margin: 0; font-size: 16px; }
  .role { font-weight: 400; font-size: 13px; }
  .body { flex: 1; display: grid; grid-template-columns: 170px 1fr; min-height: 0; }
  nav { display: flex; flex-direction: column; gap: 2px; padding: 10px; border-right: 1px solid var(--border); background: var(--panel-2); }
  nav button { text-align: left; border-color: transparent; background: transparent; }
  nav button.active { background: var(--accent-soft); color: #3730a3; }
  section { padding: 4px 20px 20px; overflow: auto; }
  h3 { font-size: 13px; margin: 16px 0 8px; display: flex; align-items: center; gap: 6px; }
  .row { display: flex; gap: 6px; align-items: center; }
  .row input { flex: 1; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
  .span2 { grid-column: 1 / -1; }
  :global(.cb.check) { align-self: end; height: 32px; }
  .list { list-style: none; padding: 0; margin: 0 0 10px; }
  .list li { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--border); }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  th { text-align: left; font-size: 11px; color: #52525b; font-weight: 600; padding: 4px 6px; border-bottom: 1px solid var(--border); }
  td { padding: 5px 6px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tr.click { cursor: pointer; }
  tr.click:hover td { background: var(--panel-2); }
  tr.revoked td { color: #71717a; text-decoration: line-through; }
  .link { border: 0; background: none; padding: 0; color: #1d4ed8; text-align: left; white-space: normal; }
  .st { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: #f4f4f5; color: #3f3f46; }
  .st.sent { background: #dcfce7; color: #166534; }
  .st.failed { background: #fee2e2; color: #991b1b; }
  .st.queued, .st.sending { background: #fef3c7; color: #92400e; }
  .newkey { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; }
  .newkey code { flex: 1; word-break: break-all; }
  pre { background: #18181b; color: #e4e4e7; padding: 10px; border-radius: 6px; overflow: auto; font-size: 11px; }
  .detail { display: grid; grid-template-columns: 100px 1fr; gap: 4px 10px; margin: 10px 0; }
  .detail dt { color: #52525b; }
  .detail dd { margin: 0; }
  iframe { width: 100%; height: 360px; border: 1px solid var(--border); border-radius: 6px; background: #fff; }
  .error { color: #b91c1c; }
  .small { font-size: 12px; }
  .danger-zone { color: var(--danger); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  @media (max-width: 640px) {
    .body { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
    nav { flex-direction: row; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--border); }
    .grid { grid-template-columns: 1fr; }
  }
</style>

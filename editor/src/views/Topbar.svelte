<script>
  import TemplatePicker from './TemplatePicker.svelte'
  import { store } from '../stores/editor.svelte.js'
  import { api } from '../lib/api.js'
  import { flagOf } from '../lib/flags.js'
  import { session } from '../lib/service.svelte.js'
  import ServiceSettings from './ServiceSettings.svelte'
  let settingsOpen = $state(false)
  import { confirmDialog, promptDialog } from '../lib/dialogs.svelte.js'
  import logo from '../../../assets/brand/logo.svg'

  let { onnew } = $props()
  let picking = $state(false)

  const VIEWS = $derived([
    ['design', 'Design'],
    ['preview', 'Preview'],
    ...(store.isPdf ? [['pdf', 'PDF']] : []),
    ['code', 'Code'],
  ])

  const draft = () => ({ kind: store.kind, mjml: store.doc.mjml, yml: store.doc.yml, data: store.doc.data, lang: store.lang })

  /**
   * URL of the email just sent in the Mailpit inbox (`smtp.web`), looked up by its Message-ID.
   * When the inbox is not Mailpit or does not answer, returns null (the inbox is linked instead).
   */
  async function mailpitMessageUrl(web, messageId) {
    if (!messageId) return null
    const base = web.endsWith('/') ? web : `${web}/`
    const query = `message-id:"${messageId.replace(/^<|>$/g, '')}"`
    for (let i = 0; i < 4; i++) {
      try {
        const res = await fetch(`${base}api/v1/search?${new URLSearchParams({ query, limit: '1' })}`)
        if (!res.ok) return null
        const id = (await res.json()).messages?.[0]?.ID
        if (id) return `${base}view/${id}`
      } catch {
        return null
      }
      await new Promise(r => setTimeout(r, 250)) // Mailpit indexes the message in the background
    }
    return null
  }

  async function sendTest() {
    let last = 'demo@example.com'
    try { last = localStorage.getItem('tpl:send-to') || last } catch {}
    const to = await promptDialog({
      title: `Send a test to ${store.project.smtp.label}`,
      message: `${store.doc.id} · ${store.lang} · with the demo data`,
      label: 'Recipient', value: last, inputType: 'email', okLabel: 'Send ➤',
    })
    if (!to) return
    try { localStorage.setItem('tpl:send-to', to) } catch {}
    try {
      const { messageId, attachments = [] } = await api.send({ ...draft(), to })
      const web = store.project.smtp.web
      const href = web ? (await mailpitMessageUrl(web, messageId)) ?? web : null
      if (href) store.lastSentUrl = href
      store.notify(`Sent to ${to}${attachments.length ? ` · 📎 ${attachments.join(', ')}` : ''}`, 'success', href ? { href, label: `Open in ${store.project.smtp.label}` } : null)
    } catch (e) {
      store.notify(e.message, 'error')
    }
  }

</script>

<header>
  <div class="brand" title={store.project?.name}>
    <img src={logo} width="22" height="22" alt="" />
    <b>templ<span class="ai">ai</span>tor</b>
  </div>

  {#if session.isService}
    <label class="org">
      <span class="sr">Organization</span>
      <select value={session.activeOrg?.id} onchange={(e) => session.switchOrg(e.currentTarget.value)} title="Organization">
        {#each session.orgs as o}<option value={o.id}>{o.name}</option>{/each}
      </select>
    </label>
  {/if}

  <div class="path">
    <button class="link" onclick={() => (picking = !picking)} title="Open a template, component or layout">
      <span class="at" class:comp={store.isComponent} class:lay={store.isLayout}>{store.isComponent ? '◆' : store.isLayout ? '⧉' : '@'}</span>
      <span class="id">{store.isComponent ? `${store.project?.componentsDir}/` : ''}{store.isLayout ? '_layouts/' : ''}{store.doc?.id ?? '…'}{store.isLayout ? '' : '/'}</span>
    </button>
    <TemplatePicker bind:open={picking} {onnew} />
  </div>
  {#if !store.isTemplate && store.returnTo}
    <button class="ghost back" onclick={() => store.back()} title="Back to the template">← {store.returnTo}</button>
  {/if}
  {#if store.dirty}<span class="dirty" title="Unsaved changes">●</span>{/if}

  <div class="spacer"></div>

  <div class="seg" role="group" aria-label="View">
    {#each VIEWS as [v, label]}
      <button class:active={store.view === v} onclick={() => (store.view = v)}>{label}</button>
    {/each}
  </div>
  {#if !store.isPdf}
  <div class="seg" role="group" aria-label="Device">
    <button class:active={store.device === 'desktop'} onclick={() => (store.device = 'desktop')} title="Desktop">🖥</button>
    <button class:active={store.device === 'mobile'} onclick={() => (store.device = 'mobile')} title="Mobile">📱</button>
  </div>
  {/if}
  <button class="ghost icon" disabled={!store.history.length} onclick={() => store.undo()} title="Undo (Ctrl+Z)">↶</button>
  <button class="ghost icon" disabled={!store.future.length} onclick={() => store.redo()} title="Redo (Ctrl+Shift+Z)">↷</button>
  {#if session.canEdit}
    <button class="ghost" onclick={() => store.compile()} title="Compile to {store.project?.outDir}/">⚙ Compile</button>
    <button class="save" class:primary={store.dirty} disabled={!store.dirty} onclick={() => store.save()} title="Save (Ctrl+S)">
      {store.dirty ? 'Save' : 'Saved'}
    </button>
  {:else}
    <span class="readonly" title="Your role in this organization is viewer">Read-only</span>
  {/if}

  <div class="flags" role="group" aria-label="Language">
    {#each store.langs as l}
      {@const locale = store.project?.locales?.[l] || l}
      <button class="flag" class:active={store.lang === l} onclick={() => (store.lang = l)} title={locale}>
        {flagOf(locale) ?? l.toUpperCase()}
      </button>
    {/each}
  </div>

  {#if store.project?.smtp && !store.isPdf && session.canEdit}
    <button class="send" onclick={sendTest} title="Send a test email (SMTP)">{store.project.smtp.label} <span class="arrow">➤</span></button>
  {/if}
  {#if store.project?.smtp?.web}
    <a
      class="icon ext"
      href={store.lastSentUrl ?? store.project.smtp.web}
      target="_blank"
      rel="noopener"
      title={store.lastSentUrl ? `Open the last sent email in ${store.project.smtp.label}` : `Open ${store.project.smtp.label}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>
    </a>
  {/if}
  {#if session.isService}
    <button class="ghost account" onclick={() => (settingsOpen = true)} title="Organization and account settings" aria-label="Settings">
      <span class="avatar" aria-hidden="true">{(session.user?.name || session.user?.email || '?').slice(0, 1).toUpperCase()}</span>
    </button>
    <ServiceSettings bind:open={settingsOpen} />
  {/if}
</header>

<style>
  header {
    height: 42px; display: flex; align-items: center; gap: 6px; padding: 0 0 0 14px;
    background: var(--panel); border-bottom: 3px solid #d4d4d8; flex: none;
  }
  .brand { display: flex; align-items: center; gap: 7px; margin-right: 10px; font-size: 15px; letter-spacing: -.2px; }
  .brand .ai { background: linear-gradient(90deg, #8b5cf6, #ec4899); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .path { position: relative; min-width: 0; }
  .link { display: flex; align-items: center; gap: 8px; border: 0; background: none; padding: 2px 4px; min-width: 0; }
  .at {
    display: inline-grid; place-content: center; width: 20px; height: 20px; border-radius: 4px; flex: none;
    border: 1px solid #93c5fd; color: #2563eb; background: #eff6ff; font-size: 12px;
  }
  .at.comp { border-color: #c4b5fd; color: #7c3aed; background: #f5f3ff; }
  .at.lay { border-color: #fcd34d; color: #b45309; background: #fffbeb; }
  .id { color: #2563eb; text-decoration: underline; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .back { font-size: 12px; color: var(--muted); }
  .dirty { color: var(--warn); font-size: 10px; }
  .spacer { flex: 1; }
  .org select { max-width: 160px; font-size: 12px; padding: 3px 6px; }
  .readonly { font-size: 12px; color: #52525b; border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px; }
  .account { padding: 2px 8px; }
  .avatar { display: inline-grid; place-content: center; width: 24px; height: 24px; border-radius: 50%; background: linear-gradient(135deg, #6366f1, #ec4899); color: #fff; font-size: 12px; font-weight: 600; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .seg button { font-size: 12px; padding: 3px 9px; }
  .icon { padding: 2px 7px; font-size: 15px; }
  .save { min-width: 84px; }
  .flags { display: flex; gap: 2px; margin-left: 6px; }
  .flag { border: 2px solid transparent; background: none; padding: 0 3px; font-size: 18px; line-height: 24px; border-radius: 4px; opacity: .55; }
  .flag.active { opacity: 1; border-color: #d4d4d8; }
  .flag:hover { opacity: 1; }
  .send {
    height: 42px; margin-top: -3px; border: 0; border-radius: 0; padding: 0 18px; background: #3b6cf6; color: #fff;
    font-weight: 600; font-size: 15px; display: flex; align-items: center; gap: 8px;
  }
  .send:hover:not(:disabled) { background: #2f5be0; }
  .arrow { font-size: 16px; }
  .ext { display: grid; place-content: center; width: 40px; height: 100%; color: #3f3f46; border-radius: 6px; }
  .ext:hover { background: #f4f4f5; }
</style>

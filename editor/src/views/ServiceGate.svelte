<script>
  import Checkbox from '../components/Checkbox.svelte'
  import Icon from '../components/Icon.svelte'
  // Hosted service: sign in (email code or passkey) and first organization.
  import { session, svc } from '../lib/service.svelte.js'
  import logo from '../../../assets/brand/logo.svg'

  let step = $state(session.user ? 'org' : 'email') // email · code · org
  let email = $state('')
  let code = $state('')
  let busy = $state(false)
  let error = $state('')
  let info = $state('')
  let orgName = $state('')
  let starter = $state('blank')
  const passkeysSupported = typeof window !== 'undefined' && !!window.PublicKeyCredential

  async function run(fn) {
    busy = true
    error = ''
    try { await fn() } catch (e) { error = e.message } finally { busy = false }
  }

  const requestCode = (e) => {
    e.preventDefault()
    run(async () => {
      await svc.post('/auth/code', { email })
      info = `If ${email} can sign in, a 6-digit code is on its way.`
      step = 'code'
    })
  }

  const verify = (e) => {
    e.preventDefault()
    run(async () => {
      await svc.post('/auth/code/verify', { email, code: code.replace(/\s/g, '') })
      location.reload()
    })
  }

  const passkey = () => run(async () => {
    const { startAuthentication } = await import('@simplewebauthn/browser')
    const { options } = await svc.post('/auth/passkeys/login/options')
    let response
    try { response = await startAuthentication({ optionsJSON: options }) } catch (e) {
      throw new Error(e.name === 'NotAllowedError' ? 'Passkey sign-in was cancelled' : e.message)
    }
    await svc.post('/auth/passkeys/login', { response })
    location.reload()
  })

  const createOrg = (e) => {
    e.preventDefault()
    run(async () => {
      await svc.post('/orgs', { name: orgName, starter })
      location.reload()
    })
  }
</script>

<main class="gate">
  <div class="card">
    <div class="brand"><img src={logo} width="28" height="28" alt="" /><b>templ<span class="ai">ai</span>tor</b></div>

    {#if step === 'email'}
      <h1>Sign in</h1>
      <form onsubmit={requestCode}>
        <label class="field"><span>Email</span>
          <input type="email" autocomplete="username webauthn" required bind:value={email} placeholder="you@company.com" />
        </label>
        <button class="primary wide" disabled={busy}>Email me a code</button>
      </form>
      {#if passkeysSupported}
        <div class="or" aria-hidden="true">or</div>
        <button class="wide" onclick={passkey} disabled={busy}><Icon name="key" size={15} /> Sign in with a passkey</button>
      {/if}
      {#if session.signup === 'invite'}<p class="muted small">Only invited emails can sign in.</p>{/if}
    {:else if step === 'code'}
      <h1>Check your email</h1>
      <p class="muted" role="status">{info}</p>
      <form onsubmit={verify}>
        <label class="field"><span>Code</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input class="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{'{6,7}'}" maxlength="7" required autofocus bind:value={code} />
        </label>
        <button class="primary wide" disabled={busy}>Sign in</button>
      </form>
      <button class="ghost wide" onclick={() => { step = 'email'; code = ''; error = '' }}><Icon name="arrow-left" size={14} /> Use another email</button>
    {:else}
      <h1>Create your organization</h1>
      <p class="muted">Signed in as {session.user?.email}. Organizations hold templates, members, the SMTP and the API keys.</p>
      <form onsubmit={createOrg}>
        <label class="field"><span>Name</span>
          <input required maxlength="80" bind:value={orgName} placeholder="Acme" />
        </label>
        <fieldset class="field">
          <legend>Start with</legend>
          <Checkbox type="radio" bind:group={starter} value="blank" class="radio">A blank project (one layout and one template)</Checkbox>
          <Checkbox type="radio" bind:group={starter} value="demo" class="radio">The demo project (emails, components and a PDF invoice)</Checkbox>
        </fieldset>
        <button class="primary wide" disabled={busy}>Create organization</button>
      </form>
      <button class="ghost wide" onclick={() => session.logout()}>Sign out</button>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
</main>

<style>
  .gate { min-height: 100%; display: grid; place-items: center; padding: 24px 16px; background: var(--bg); }
  .card { width: 100%; max-width: 380px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 24px; }
  .brand { display: flex; align-items: center; gap: 8px; font-size: 18px; margin-bottom: 16px; }
  .brand .ai { background: linear-gradient(90deg, #8b5cf6, #ec4899); -webkit-background-clip: text; background-clip: text; color: transparent; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  .wide { width: 100%; padding: 8px; margin-top: 4px; }
  .field input { padding: 8px; font-size: 14px; }
  .field > span, legend { font-size: 12px; color: #52525b; }
  fieldset { border: 0; padding: 0; margin: 0 0 8px; }
  :global(.cb.radio) { display: flex; margin: 6px 0; font-size: 13px; }
  .code { font-family: var(--mono); font-size: 22px !important; letter-spacing: 6px; text-align: center; }
  .or { text-align: center; color: #52525b; margin: 12px 0 8px; font-size: 12px; }
  .error { color: #b91c1c; margin: 12px 0 0; }
  .small { font-size: 12px; margin: 12px 0 0; }
</style>

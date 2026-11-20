<script>
  // Informe de accesibilidad (WCAG 2.1 AA · EN 301 549 · PDF/UA) del borrador actual
  import { store } from '../stores/editor.svelte.js'

  const report = $derived(store.preview.a11yReport)
  const counts = $derived.by(() => {
    const c = { fail: 0, warn: 0, pass: 0, na: 0 }
    for (const ch of report?.checks || []) c[ch.status]++
    return c
  })
  const ICON = { pass: '✓', warn: '⚠', fail: '✕', na: '–' }
  const LABEL = { pass: 'Cumple', warn: 'Revisar', fail: 'No cumple', na: 'No aplica' }

  let open = $state({})
  const isOpen = (c) => open[c.id] ?? c.status !== 'pass'
</script>

<aside class="report" aria-label="Informe de accesibilidad">
  <header>
    <h2>♿ Accesibilidad</h2>
    {#if report}
      <p class="std">{report.standard}</p>
      <div class="score" class:ok={!counts.fail && !counts.warn} class:bad={counts.fail}>
        {#if counts.fail}
          <b>{counts.fail} criterio(s) no cumplen</b>
        {:else if counts.warn}
          <b>Cumple, con {counts.warn} aviso(s)</b>
        {:else}
          <b>Cumple todos los criterios comprobados</b>
        {/if}
        <span>{counts.pass} ✓ · {counts.warn} ⚠ · {counts.fail} ✕</span>
      </div>
      <p class="scope">Idioma: <b>{store.lang}</b>. Comprobación automática del HTML compilado; revisa también el orden de lectura y el sentido de los textos.</p>
    {:else}
      <p class="std">Calculando…</p>
    {/if}
  </header>

  {#if report}
    <ul class="checks">
      {#each report.checks as c (c.id)}
        <li class="check {c.status}">
          <button class="row" aria-expanded={isOpen(c)} onclick={() => (open[c.id] = !isOpen(c))}>
            <span class="ic" aria-label={LABEL[c.status]}>{ICON[c.status]}</span>
            <span class="title">{c.title}</span>
            <span class="wcag">{c.wcag}</span>
          </button>
          {#if isOpen(c)}
            <div class="detail">
              {#each c.issues as i}
                <div class="issue {i.level}">
                  <p>{i.message}</p>
                  {#if i.hint}<p class="hint">→ {i.hint}</p>{/if}
                </div>
              {/each}

              {#if c.id === 'lang'}
                <p class="inv">lang = <code>{report.inventory.lang ?? '—'}</code></p>
              {:else if c.id === 'title'}
                <p class="inv">«{report.inventory.title || '—'}»</p>
              {:else if c.id === 'headings'}
                {#if report.inventory.headings.length}
                  <ol class="outline">
                    {#each report.inventory.headings as h}
                      <li style="padding-left: {(h.level - 1) * 12}px"><code>h{h.level}</code> {h.text}</li>
                    {/each}
                  </ol>
                {/if}
              {:else if c.id === 'images'}
                {#each report.inventory.images as img}
                  <p class="inv"><code>{img.src.split('/').pop() || img.src}</code> — {img.alt === null ? 'sin alt' : img.alt === '' ? 'decorativa (alt="")' : `«${img.alt}»`}</p>
                {/each}
              {:else if c.id === 'links'}
                {#each report.inventory.links as l}
                  <p class="inv">«{l.text || '—'}» → <code>{l.href}</code></p>
                {/each}
              {:else if c.id === 'contrast'}
                <table>
                  <caption class="sr">Pares de color de texto y fondo</caption>
                  <thead><tr><th scope="col">Muestra</th><th scope="col">Ratio</th><th scope="col">Mín.</th></tr></thead>
                  <tbody>
                    {#each report.inventory.contrast as p}
                      <tr class:fail={!p.pass}>
                        <td><span class="swatch" style="color:{p.fg};background:{p.bg}">Aa</span> <span class="sample">{p.sample}</span></td>
                        <td>{p.ratio}:1</td>
                        <td>{p.min}:1</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {:else if c.id === 'pdf-ua'}
                <p class="inv">El PDF se genera etiquetado (estructura de encabezados, tablas, alt de imágenes), con idioma, título y marcadores.</p>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .report { background: var(--panel); border-left: 1px solid var(--border); overflow: auto; min-height: 0; font-size: 12.5px; }
  header { padding: 14px 16px 10px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--panel); z-index: 1; }
  h2 { margin: 0; font-size: 15px; }
  .std { margin: 2px 0 10px; color: var(--muted); font-size: 11px; }
  .score { display: grid; gap: 2px; padding: 8px 10px; border-radius: 8px; background: #fffbeb; color: #92400e; }
  .score.ok { background: #f0fdf4; color: #166534; }
  .score.bad { background: #fef2f2; color: #991b1b; }
  .score span { font-size: 11px; }
  .scope { margin: 8px 0 0; color: var(--muted); font-size: 11px; }
  .checks { list-style: none; margin: 0; padding: 4px 0 24px; }
  .check { border-bottom: 1px solid #f4f4f5; }
  .row { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; border-radius: 0; background: none; padding: 8px 16px; text-align: left; }
  .row:hover { background: #fafafa; }
  .ic { width: 18px; height: 18px; flex: none; display: grid; place-content: center; border-radius: 50%; font-size: 11px; font-weight: 700; color: #fff; }
  .pass .ic { background: #15803d; }
  .warn .ic { background: #b45309; }
  .fail .ic { background: #b91c1c; }
  .na .ic { background: #a1a1aa; }
  .title { flex: 1; font-weight: 500; }
  .wcag { font: 10px var(--mono); color: var(--muted); }
  .detail { padding: 0 16px 10px 42px; }
  .issue { margin-bottom: 6px; padding: 6px 8px; border-radius: 6px; background: #fffbeb; }
  .issue.error { background: #fef2f2; }
  .issue p { margin: 0; }
  .issue .hint { color: #52525b; margin-top: 2px; }
  .inv { margin: 2px 0; color: #3f3f46; word-break: break-word; }
  .outline { list-style: none; margin: 0; padding: 0; }
  .outline li { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  th { text-align: left; color: var(--muted); font-weight: 500; padding: 2px 4px; }
  td { padding: 3px 4px; border-top: 1px solid #f4f4f5; vertical-align: middle; }
  tr.fail td { color: #b91c1c; font-weight: 600; }
  .swatch { display: inline-block; padding: 0 5px; border: 1px solid #e4e4e7; border-radius: 4px; font-weight: 700; }
  .sample { color: #52525b; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>

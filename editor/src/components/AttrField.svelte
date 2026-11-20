<script>
  let { def, value = '', onchange, placeholder = null } = $props()
  const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v || '')
</script>

<label class="field">
  <span>{def.label || def.name}</span>
  {#if def.type === 'select'}
    <select value={value || ''} onchange={(e) => onchange(e.currentTarget.value)}>
      {#each def.options as opt}
        <option value={opt}>{opt || (placeholder ? `— por defecto: ${placeholder} —` : '— por defecto —')}</option>
      {/each}
      {#if value && !def.options.includes(value)}<option value={value}>{value}</option>{/if}
    </select>
  {:else if def.type === 'color'}
    <div class="row">
      <input type="color" value={isHex(value) ? value : isHex(placeholder) ? placeholder : '#000000'} oninput={(e) => onchange(e.currentTarget.value)} />
      <input type="text" class="mono" value={value || ''} placeholder={placeholder ?? 'por defecto'} oninput={(e) => onchange(e.currentTarget.value)} />
    </div>
  {:else}
    <input type="text" class:mono={def.type !== 'text'} value={value || ''} placeholder={placeholder ?? (def.type === 'spacing' ? 'p.ej. 16px 24px' : def.type === 'size' ? 'p.ej. 14px' : '')} oninput={(e) => onchange(e.currentTarget.value)} />
  {/if}
</label>

<style>
  .row { display: grid; grid-template-columns: 32px 1fr; gap: 6px; }
  input[type='color'] { padding: 0 2px; height: 28px; width: 32px; }
</style>

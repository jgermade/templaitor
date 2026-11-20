<script>
  import ImageField from './ImageField.svelte'

  // `image`: extra props for ImageField (assets, assetsUrl, resolve, onupload)
  let { def, value = '', onchange, placeholder = null, image = {} } = $props()
  const boolLabel = (v) => (v === 'true' || v === true ? 'yes' : 'no')
  const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v || '')
</script>

<svelte:element this={def.type === 'image' ? 'div' : 'label'} class="field">
  <span>{def.label || def.name}</span>
  {#if def.type === 'boolean'}
    <select value={value === true ? 'true' : value === false ? 'false' : value || ''} onchange={(e) => onchange(e.currentTarget.value)}>
      <option value="">{placeholder !== null ? `— default: ${boolLabel(placeholder)} —` : '— default —'}</option>
      <option value="true">Yes</option>
      <option value="false">No</option>
    </select>
  {:else if def.type === 'image'}
    <ImageField {value} placeholder={placeholder ?? ''} {onchange} {...image} />
  {:else if def.type === 'select'}
    <select value={value || ''} onchange={(e) => onchange(e.currentTarget.value)}>
      {#each def.options as opt}
        <option value={opt}>{opt || (placeholder ? `— default: ${placeholder} —` : '— default —')}</option>
      {/each}
      {#if value && !def.options.includes(value)}<option value={value}>{value}</option>{/if}
    </select>
  {:else if def.type === 'color'}
    <div class="row">
      <input type="color" value={isHex(value) ? value : isHex(placeholder) ? placeholder : '#000000'} oninput={(e) => onchange(e.currentTarget.value)} />
      <input type="text" class="mono" value={value || ''} placeholder={placeholder ?? 'default'} oninput={(e) => onchange(e.currentTarget.value)} />
    </div>
  {:else}
    <input type="text" class:mono={def.type !== 'text'} value={value || ''} placeholder={placeholder ?? (def.type === 'spacing' ? 'e.g. 16px 24px' : def.type === 'size' ? 'e.g. 14px' : '')} oninput={(e) => onchange(e.currentTarget.value)} />
  {/if}
</svelte:element>

<style>
  .row { display: grid; grid-template-columns: 32px 1fr; gap: 6px; }
  input[type='color'] { padding: 0 2px; height: 28px; width: 32px; }
</style>

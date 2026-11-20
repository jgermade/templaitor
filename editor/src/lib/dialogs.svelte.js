// Modales propios (sobre <dialog>) en lugar de prompt()/confirm() del navegador.
//
//   if (await confirmDialog({ title: '¿Eliminar?', danger: true })) …
//   const name = await promptDialog({ title: 'Nuevo componente', label: 'Nombre' })  // null si se cancela

class Dialogs {
  current = $state(null) // { type, title, message, label, value, placeholder, okLabel, danger, inputType, pattern, hint, resolve }

  open(opts) {
    // si había uno abierto, se cancela
    this.current?.resolve(opts.type === 'confirm' ? false : null)
    return new Promise((resolve) => { this.current = { ...opts, resolve } })
  }

  close(result) {
    const c = this.current
    this.current = null
    c?.resolve(result)
  }
}

export const dialogs = new Dialogs()

export function confirmDialog({ title, message = '', okLabel = 'Aceptar', cancelLabel = 'Cancelar', danger = false } = {}) {
  return dialogs.open({ type: 'confirm', title, message, okLabel, cancelLabel, danger })
}

export function promptDialog({
  title, message = '', label = '', value = '', placeholder = '', okLabel = 'Aceptar', cancelLabel = 'Cancelar',
  inputType = 'text', pattern = null, hint = '',
} = {}) {
  return dialogs.open({ type: 'prompt', title, message, label, value, placeholder, okLabel, cancelLabel, inputType, pattern, hint })
}

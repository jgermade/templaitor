// Own modals (built on <dialog>) instead of the browser prompt()/confirm().
//
//   if (await confirmDialog({ title: 'Delete?', danger: true })) …
//   const name = await promptDialog({ title: 'New component', label: 'Name' })  // null when cancelled

class Dialogs {
  current = $state(null) // { type, title, message, label, value, placeholder, okLabel, danger, inputType, pattern, hint, resolve }

  open(opts) {
    // cancels the one already open, if any
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

export function confirmDialog({ title, message = '', okLabel = 'OK', cancelLabel = 'Cancel', danger = false } = {}) {
  return dialogs.open({ type: 'confirm', title, message, okLabel, cancelLabel, danger })
}

export function promptDialog({
  title, message = '', label = '', value = '', placeholder = '', okLabel = 'OK', cancelLabel = 'Cancel',
  inputType = 'text', pattern = null, hint = '',
} = {}) {
  return dialogs.open({ type: 'prompt', title, message, label, value, placeholder, okLabel, cancelLabel, inputType, pattern, hint })
}

const DISMISSIBLE_DETAILS_SELECTOR = 'details[data-dismiss-outside][open]'

export function dismissOpenDetailsOutside(target: EventTarget | null): void {
  if (!(target instanceof Node)) return

  document.querySelectorAll<HTMLDetailsElement>(DISMISSIBLE_DETAILS_SELECTOR).forEach(details => {
    if (!details.contains(target)) details.open = false
  })
}

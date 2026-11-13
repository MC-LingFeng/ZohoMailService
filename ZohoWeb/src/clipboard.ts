export async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const previous = document.activeElement;
  const field = document.createElement('textarea');
  field.value = value;
  field.readOnly = true;
  field.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.append(field);
  try {
    field.select();
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
  } finally {
    field.remove();
    if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
  }
}


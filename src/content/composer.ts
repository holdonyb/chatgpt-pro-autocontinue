export type ComposerEditor = HTMLTextAreaElement | HTMLElement;

export function findComposerEditor(root: ParentNode = document): ComposerEditor | null {
  const exact = root.querySelector('#prompt-textarea[contenteditable="true"]');
  if (exact instanceof HTMLElement) return exact;

  const rich = root.querySelector('[data-composer-body] [contenteditable="true"][role="textbox"], .ProseMirror[contenteditable="true"]');
  if (rich instanceof HTMLElement) return rich;

  const textareas = Array.from(root.querySelectorAll('textarea'));
  const visible = textareas.find((candidate) => {
    if (!(candidate instanceof HTMLTextAreaElement)) return false;
    return candidate.style.display !== 'none' && !candidate.hidden && candidate.getAttribute('aria-hidden') !== 'true';
  });
  if (visible instanceof HTMLTextAreaElement) return visible;

  const fallbackRich = root.querySelector('[contenteditable="true"]');
  return fallbackRich instanceof HTMLElement ? fallbackRich : null;
}

export function composerValue(editor: ComposerEditor | null): string {
  if (!editor) return '';
  return editor instanceof HTMLTextAreaElement ? editor.value : editor.textContent ?? '';
}

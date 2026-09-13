// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { readSnapshot } from '../../src/content/chatgpt-adapter';

beforeEach(() => {
  window.history.replaceState({}, '', '/c/model-test');
  document.body.innerHTML = '<form><button type="button">Pro</button><textarea aria-label="Message"></textarea></form>';
});

it('does not turn a proof filename into a new model fingerprint', () => {
  document.body.insertAdjacentHTML('afterbegin', '<button title="C065 Proof notes.md">Download</button>');
  expect(readSnapshot('d').modeFingerprint).toBe('pro');
});
it('ignores model-looking labels inside answers and account navigation', () => {
  document.body.insertAdjacentHTML('afterbegin', '<nav><button>6 Pro</button></nav><section data-message-author-role="assistant"><button data-testid="model-example">7 Pro</button></section>');
  expect(readSnapshot('d').modeFingerprint).toBe('pro');
});
it('does not use account Pro when an explicit model selector is non-Pro', () => {
  document.body.innerHTML = '<nav><button>Pro</button></nav><button data-testid="model-switcher">Thinking</button><textarea aria-label="Message"></textarea>';
  expect(readSnapshot('d').modeFingerprint).toBeNull();
});
it('treats conflicting fallback controls as unknown instead of choosing DOM order', () => {
  document.querySelector('form')!.insertAdjacentHTML('afterbegin', '<button type="button">6 Pro</button>');
  expect(readSnapshot('d').modeFingerprint).toBeNull();
});
it('ignores hidden controls but still reads a visible selector in a background document', () => {
  document.body.insertAdjacentHTML('afterbegin', '<button style="display:none" data-testid="model-switcher">6 Pro</button>');
  expect(readSnapshot('d').modeFingerprint).toBe('pro');
});
it('reports genuine model versions distinctly and retains a source diagnostic', () => {
  document.body.innerHTML = '<button data-testid="model-switcher">6 Pro</button><textarea aria-label="Message"></textarea>';
  expect(readSnapshot('d').modeFingerprint).toBe('6 pro');
  document.querySelector('button')!.textContent = '7 Pro';
  expect(readSnapshot('d').modeFingerprint).toBe('7 pro');
  expect(readSnapshot('d').modeDetail).toContain('source=model-control');
});
it('reads the supplied composer structure with adjacent version and Pro spans', () => {
  document.body.innerHTML = '<button title="C065 Proof notes.md">Download</button><form data-type="unified-composer"><div data-composer-body><div contenteditable="true" id="prompt-textarea" class="ProseMirror"><p><br></p></div><div data-composer-transition-slot="trailing"><button type="button" aria-haspopup="menu"><span><span>6</span><span>Pro</span></span><svg aria-hidden="true"></svg></button><button data-testid="stop-button" aria-label="停止回答" type="submit"></button></div></div></form>';
  const page = readSnapshot('d');
  expect(page.modeLabel).toBe('6 Pro');
  expect(page.modeFingerprint).toBe('6 pro');
  expect(page.modeDetail).toContain('source=model-control');
  expect(page.busySignal).toBe(true);
});
it('prefers the composer model control over a generic header model control', () => {
  document.body.innerHTML = '<button data-testid="model-switcher">Pro</button><form data-type="unified-composer"><textarea aria-label="Message"></textarea><div data-composer-transition-slot="trailing"><button aria-haspopup="menu"><span>6</span><span>Pro</span></button></div></form>';
  expect(readSnapshot('d').modeFingerprint).toBe('6 pro');
});

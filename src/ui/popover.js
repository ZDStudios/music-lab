/* One small floating menu, shared by the pattern menu and the sound pickers. */

let current = null;

export function closePopover() {
  if (!current) return;
  document.removeEventListener('pointerdown', current.outside, true);
  document.removeEventListener('keydown', current.onKey, true);
  current.el.remove();
  current = null;
}

/**
 * @param {HTMLElement} anchor  the button the menu belongs to
 * @param {string} html         menu contents; clickable items carry data-value
 * @param {(value: string, event: Event) => void} onPick
 */
export function openPopover({ anchor, html, className = '', onPick, closeOnPick = true }) {
  const wasFor = current && current.anchor === anchor;
  closePopover();
  if (wasFor) return null;             // clicking the same button again closes it

  const el = document.createElement('div');
  el.className = 'popmenu ' + className;
  el.innerHTML = html;
  document.body.appendChild(el);

  const r = anchor.getBoundingClientRect();
  const gap = 8;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let left = r.left;
  if (left + w > window.innerWidth - gap) left = window.innerWidth - w - gap;
  el.style.left = Math.max(gap, left) + 'px';
  // Above the anchor by default, below it when there is no room; then clamped
  // so a tall menu on a short window still lands fully on screen.
  const above = r.top - h - 6;
  const top = above < gap ? r.bottom + 6 : above;
  el.style.top = Math.max(gap, Math.min(top, window.innerHeight - h - gap)) + 'px';

  const outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closePopover(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePopover(); } };

  el.addEventListener('click', (e) => {
    const item = e.target.closest('[data-value]');
    if (!item) return;
    const value = item.dataset.value;
    if (closeOnPick) closePopover();
    onPick?.(value, e);
  });

  current = { el, anchor, outside, onKey };
  // Deferred so the click that opened the menu does not immediately close it.
  setTimeout(() => {
    if (current && current.el === el) {
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', onKey, true);
    }
  }, 0);
  return el;
}

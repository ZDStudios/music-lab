/* Little pictograms for the instrument and kit pickers. 24×24, currentColor. */

const s = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const line = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

export const INSTRUMENT_ICONS = {
  marimba: s('<rect x="3" y="9" width="4" height="10" rx="1.5"/><rect x="10" y="6" width="4" height="13" rx="1.5"/><rect x="17" y="11" width="4" height="8" rx="1.5"/>'),

  piano: s(`<rect x="2.5" y="6" width="19" height="12" rx="2.5" ${line} stroke-width="1.6"/>
    <rect x="7" y="6" width="2.6" height="7" rx="1"/><rect x="14" y="6" width="2.6" height="7" rx="1"/>
    <path d="M7 13v5M12 13v5M17 13v5" ${line} stroke-width="1.3"/>`),

  musicbox: s('<path d="M12 3l1.7 5.1L19 9.8l-5.3 1.7L12 16.7l-1.7-5.2L5 9.8l5.3-1.7z"/><circle cx="18" cy="17.5" r="2.2"/>'),

  pluck: s(`<path d="M5 20c6.5-2.5 11-8 13-17" ${line} stroke-width="1.7"/>
    <path d="M8.5 19.2V9M11.5 18V7.6M14.5 16.4V6.4" ${line} stroke-width="1.3"/>`),

  strings: s(`<path d="M3 7.5c3-3.4 5 3.4 8 0s5-3.4 8 0" ${line} stroke-width="1.7"/>
    <path d="M3 13c3-3.4 5 3.4 8 0s5-3.4 8 0" ${line} stroke-width="1.7"/>
    <path d="M3 18.5c3-3.4 5 3.4 8 0s5-3.4 8 0" ${line} stroke-width="1.7"/>`),

  brass: s(`<path d="M4 12h9a5.5 5.5 0 015.5-5.5v11A5.5 5.5 0 0113 12" ${line} stroke-width="1.7"/>
    <circle cx="6" cy="8.6" r="1.4"/><circle cx="9.6" cy="8.6" r="1.4"/>`),

  flute: s(`<rect x="2" y="9.8" width="20" height="4.4" rx="2.2" ${line} stroke-width="1.6"/>
    <circle cx="8" cy="12" r="1.15"/><circle cx="12" cy="12" r="1.15"/><circle cx="16" cy="12" r="1.15"/>`),

  organ: s(`<path d="M4.5 20V8.5a2 2 0 014 0V20M10 20V5.5a2 2 0 014 0V20M15.5 20v-9.5a2 2 0 014 0V20" ${line} stroke-width="1.6"/>
    <path d="M2.5 20h19" ${line} stroke-width="1.7"/>`),

  lead: s(`<path d="M2 17.5l5-11v11l5-11v11l5-11v11l5-11" ${line} stroke-width="1.8"/>`),

  pad: s(`<path d="M2 11c2.6-7.5 5.4-7.5 8 0s5.4 7.5 8 0" ${line} stroke-width="1.9"/>
    <path d="M2 17.5c2.6-4.2 5.4-4.2 8 0s5.4 4.2 8 0" ${line} stroke-width="1.3" opacity=".55"/>`),

  bass: s(`<rect x="4" y="3" width="16" height="18" rx="3" ${line} stroke-width="1.6"/>
    <circle cx="12" cy="10" r="4" ${line} stroke-width="1.6"/><circle cx="12" cy="10" r="1.3"/>
    <path d="M8.5 17.2h7" ${line} stroke-width="1.4"/>`),
};

export const KIT_ICONS = {
  electronic: s(`<rect x="2.5" y="4.5" width="19" height="15" rx="3" ${line} stroke-width="1.6"/>
    <rect x="6" y="8" width="4.6" height="4" rx="1.2"/><rect x="13.4" y="8" width="4.6" height="4" rx="1.2"/>
    <rect x="6" y="14" width="4.6" height="2.4" rx="1"/><rect x="13.4" y="14" width="4.6" height="2.4" rx="1"/>`),

  acoustic: s(`<path d="M5 12.5v3.5c0 1.9 3.1 3.5 7 3.5s7-1.6 7-3.5v-3.5" ${line} stroke-width="1.6"/>
    <ellipse cx="12" cy="12.5" rx="7" ry="3.5" ${line} stroke-width="1.6"/>
    <path d="M6 4.5l4.2 4.6M18 4.5l-4.2 4.6" ${line} stroke-width="1.5"/>`),

  blocks: s('<rect x="2.5" y="7.5" width="8.5" height="9.5" rx="1.8"/><rect x="13" y="10" width="8.5" height="7" rx="1.8" opacity=".6"/>'),

  world: s(`<path d="M5.2 7.5h6l-1 12.5H6.2z" ${line} stroke-width="1.5"/><ellipse cx="8.2" cy="7.5" rx="3" ry="1.7"/>
    <path d="M14.2 10.5h6l-1 9.5h-4z" ${line} stroke-width="1.5"/><ellipse cx="17.2" cy="10.5" rx="3" ry="1.7"/>`),
};

export function instrumentIcon(id) {
  return INSTRUMENT_ICONS[id] || KIT_ICONS[id] || INSTRUMENT_ICONS.marimba;
}

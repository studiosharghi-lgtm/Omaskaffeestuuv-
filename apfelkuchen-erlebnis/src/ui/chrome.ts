import { missingMedia } from '../content/media';

const PREF_KEY = 'omas-apfelkuchen:ansicht';

export type ViewPref = 'ruhig' | 'bewegt' | null;

export function readViewPref(): ViewPref {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v === 'ruhig' || v === 'bewegt' ? v : null;
  } catch {
    return null;
  }
}

function writeViewPref(v: Exclude<ViewPref, null>): void {
  try {
    localStorage.setItem(PREF_KEY, v);
  } catch {
    /* storage blocked: the choice simply isn't remembered */
  }
}

/**
 * "Ruhige Ansicht" switches between the animated film and the calm, static story.
 * Hidden when the device cannot show the animated version anyway.
 */
export function setupMotionToggle(calm: boolean, canAnimate: boolean, onSwitch: (calm: boolean) => void): void {
  const btn = document.querySelector<HTMLButtonElement>('.kopf__bewegung');
  if (!btn) return;
  if (!canAnimate) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  btn.setAttribute('aria-pressed', String(calm));
  btn.addEventListener('click', () => {
    const next = !calm;
    writeViewPref(next ? 'ruhig' : 'bewegt');
    onSwitch(next);
  });
}

/** Lists still-missing production media; only present while placeholders are in use. */
export function setupStatusPanel(): void {
  const items = missingMedia();
  const btn = document.querySelector<HTMLButtonElement>('.kopf__status');
  const panel = document.querySelector<HTMLElement>('#produktionsstatus');
  const list = panel?.querySelector('.status__liste');
  if (!btn || !panel || !list || items.length === 0) return;

  const kindLabel = { sequence: 'Filmsequenz', model: '3D-Scan', poster: 'Foto' } as const;
  list.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = `${kindLabel[item.kind]}: ${item.title}`;
      const detail = document.createElement('span');
      detail.textContent = item.detail;
      li.append(title, detail);
      return li;
    }),
  );

  btn.hidden = false;
  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(panel.hidden !== false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.hidden === false) {
      setOpen(false);
      btn.focus();
    }
  });
  document.addEventListener('click', (e) => {
    if (panel.hidden === false && !panel.contains(e.target as Node)) setOpen(false);
  });
}

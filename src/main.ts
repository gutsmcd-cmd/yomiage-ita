import './base.css';
import './style.css';
import { h, uid, langToggle, confirmDialog, showSaveBanner, hideSaveBanner } from './ui';
import { dicts, type Lang, type Dict } from './i18n';
import { askPersist, idbLoad, idbSave, idbPutNow } from './db';

const DB = 'yomiage-ita';

interface Script { id: string; title: string; body: string; updated: number }
interface State {
  lang: Lang;
  scripts: Script[];
  fontSize: number;
  speed: number;
  mirror: boolean;
}

let state: State = { lang: 'ja', scripts: [], fontSize: 52, speed: 40, mirror: false };
let t: Dict = dicts.ja;
let view: 'list' | 'edit' | 'play' = 'list';
let currentId: string | null = null;
const app = document.getElementById('app')!;

let scrollY = 0;
let playing = false;
let counting = false;
let countToken = 0;
let raf = 0;
let lastTs = 0;
let arm = false;
let mode: 'count' | 'run' | 'pause' | 'done' = 'pause';

function isLang(v: unknown): v is Lang { return v === 'ja' || v === 'en'; }
function clamp(n: number, a: number, b: number): number { return Math.max(a, Math.min(b, n)); }
function normalize(raw: unknown): State {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const scripts: Script[] = [];
  if (Array.isArray(o.scripts)) {
    for (const item of o.scripts) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      if (typeof r.id !== 'string') continue;
      scripts.push({
        id: r.id,
        title: typeof r.title === 'string' ? r.title : '',
        body: typeof r.body === 'string' ? r.body : '',
        updated: typeof r.updated === 'number' ? r.updated : Date.now(),
      });
    }
  }
  const fontSize = typeof o.fontSize === 'number' ? clamp(o.fontSize, 28, 120) : 52;
  const speed = typeof o.speed === 'number' ? clamp(o.speed, 10, 180) : 40;
  return {
    lang: isLang(o.lang) ? o.lang : 'ja',
    scripts,
    fontSize,
    speed,
    mirror: o.mirror === true,
  };
}

let saveChain: Promise<void> = Promise.resolve();
let saveQueued = false;
function queueSave(): void {
  saveQueued = true;
  saveChain = saveChain.then(async () => {
    if (!saveQueued) return;
    saveQueued = false;
    try {
      await idbSave(DB, state);
      hideSaveBanner();
    } catch {
      showSaveBanner();
    }
  }).catch(() => { showSaveBanner(); });
}
document.addEventListener('visibilitychange', () => { if (document.hidden) queueSave(); });
window.addEventListener('pagehide', () => { idbPutNow(DB, state); queueSave(); });

function theme(color: string): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}
function setLang(l: Lang): void {
  state.lang = l;
  t = dicts[l];
  document.documentElement.lang = l;
  document.title = t.app;
  queueSave();
  render();
}
function current(): Script | null {
  return state.scripts.find((s) => s.id === currentId) ?? null;
}
function sorted(): Script[] {
  return [...state.scripts].sort((a, b) => b.updated - a.updated);
}
function titleOf(s: Script): string {
  return s.title.trim() || s.body.split('\n').find((l) => l.trim())?.trim() || t.untitled;
}
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, ms); });
}

function stopMotion(): void {
  countToken++;
  counting = false;
  playing = false;
  cancelAnimationFrame(raf);
}

function openNew(): void {
  const s: Script = { id: uid(), title: '', body: '', updated: Date.now() };
  state.scripts.unshift(s);
  currentId = s.id;
  view = 'edit';
  queueSave();
  render();
}
async function deleteScript(id: string): Promise<void> {
  const ok = await confirmDialog(t.deleteAsk, t.deleteBody, t.del, t.cancel, true);
  if (!ok) return;
  state.scripts = state.scripts.filter((s) => s.id !== id);
  if (currentId === id) { currentId = null; view = 'list'; }
  queueSave();
  render();
}

function maxScroll(): number {
  const viewport = document.querySelector('.viewport');
  const mover = document.querySelector('.mover');
  if (!viewport || !mover) return 0;
  return Math.max(0, mover.scrollHeight - viewport.clientHeight);
}
function applyTransform(): void {
  const mover = document.querySelector<HTMLElement>('.mover');
  if (mover) mover.style.transform = `translateY(${-scrollY}px)`;
}
function showCount(n: string): void {
  const el = document.getElementById('count');
  if (!el) return;
  el.hidden = false;
  el.textContent = n;
}
function hideCount(): void {
  const el = document.getElementById('count');
  if (el) el.hidden = true;
}
function setRunLabel(): void {
  const el = document.getElementById('run-btn');
  if (!el) return;
  if (mode === 'done') el.textContent = t.restart;
  else if (playing) el.textContent = t.pause;
  else if (counting) el.textContent = t.countdownHint;
  else el.textContent = t.resume;
}
function frame(ts: number): void {
  if (!playing) return;
  if (lastTs) scrollY += state.speed * Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;
  const max = maxScroll();
  if (max <= 1) {
    playing = false;
    mode = 'pause';
    scrollY = 0;
    applyTransform();
    setRunLabel();
    return;
  }
  if (scrollY >= max) {
    scrollY = max;
    playing = false;
    mode = 'done';
    applyTransform();
    setRunLabel();
    return;
  }
  applyTransform();
  raf = requestAnimationFrame(frame);
}
function startRun(): void {
  mode = 'run';
  playing = true;
  counting = false;
  lastTs = 0;
  hideCount();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
  setRunLabel();
}
async function beginCountdown(): Promise<void> {
  const token = ++countToken;
  counting = true;
  playing = false;
  mode = 'count';
  setRunLabel();
  for (const n of ['3', '2', '1']) {
    if (token !== countToken) return;
    showCount(n);
    await wait(700);
  }
  if (token !== countToken) return;
  counting = false;
  hideCount();
  startRun();
}
function onSurfaceTap(): void {
  if (counting) {
    countToken++;
    counting = false;
    hideCount();
    startRun();
    return;
  }
  if (mode === 'done') return;
  if (playing) {
    playing = false;
    mode = 'pause';
    cancelAnimationFrame(raf);
    setRunLabel();
    return;
  }
  startRun();
}
function restart(): void {
  stopMotion();
  scrollY = 0;
  applyTransform();
  void beginCountdown();
}
function goPlay(): void {
  queueSave();
  arm = true;
  stopMotion();
  scrollY = 0;
  mode = 'count';
  view = 'play';
  render();
}
function leavePlay(): void {
  stopMotion();
  view = 'edit';
  render();
}

function render(): void {
  app.classList.toggle('playmode', view === 'play');
  if (view === 'play') renderPlay();
  else if (view === 'edit' && current()) {
    theme('#0E7490');
    renderEdit(current()!);
  } else {
    view = 'list';
    app.classList.remove('playmode');
    theme('#0E7490');
    renderList();
  }
}

function renderList(): void {
  const rows = sorted();
  app.replaceChildren(
    h('header', { class: 'topbar' },
      h('h1', {}, t.app),
      langToggle(state.lang, setLang),
    ),
    h('main', {},
      h('p', { class: 'subhead' }, t.sub),
      h('button', { class: 'btn primary block', type: 'button', onclick: openNew }, t.newScript),
      h('h2', { class: 'sec' }, t.listTitle),
      rows.length === 0
        ? h('p', { class: 'empty' }, t.empty)
        : h('div', { style: 'display:flex;flex-direction:column;gap:8px' },
            ...rows.map((s) => h('div', { class: 'script-row' },
              h('button', {
                class: 'script-open', type: 'button',
                onclick: () => { currentId = s.id; view = 'edit'; render(); },
              },
                h('div', { class: 'ttl' }, titleOf(s)),
                h('div', { class: 'sub' }, s.body.replace(/\s+/g, ' ').trim()),
              ),
              h('button', {
                class: 'icon-btn', type: 'button', 'aria-label': t.del,
                onclick: () => { void deleteScript(s.id); },
              }, '×'),
            )),
          ),
    ),
    h('p', { class: 'foot' }, t.privacy),
  );
}

function renderEdit(s: Script): void {
  app.replaceChildren(
    h('header', { class: 'topbar' },
      h('button', { class: 'top-back', type: 'button', onclick: () => { view = 'list'; render(); } }, t.back),
      h('h1', {}, t.app),
      langToggle(state.lang, setLang),
    ),
    h('main', {},
      h('p', { class: 'subhead' }, t.sub),
      h('label', { class: 'field' }, t.titlePh,
        h('input', {
          class: 'input', type: 'text', value: s.title, placeholder: t.titlePh, autocomplete: 'off',
          oninput: (e: Event) => { s.title = (e.target as HTMLInputElement).value; s.updated = Date.now(); queueSave(); },
        }),
      ),
      h('label', { class: 'field' }, t.bodyPh,
        h('textarea', {
          class: 'input', style: 'min-height:46vh', value: s.body, placeholder: t.bodyPh,
          oninput: (e: Event) => { s.body = (e.target as HTMLTextAreaElement).value; s.updated = Date.now(); queueSave(); },
        }),
      ),
      h('button', { class: 'btn primary block', type: 'button', onclick: goPlay }, t.start),
      h('button', { class: 'btn danger block', type: 'button', onclick: () => { void deleteScript(s.id); } }, t.del),
    ),
    h('p', { class: 'foot' }, t.privacy),
  );
}

function renderPlay(): void {
  const s = current();
  if (!s) { view = 'list'; render(); return; }
  theme('#07080b');
  const text = h('div', { class: 'script-text' + (state.mirror ? ' mirror' : ''), style: `font-size:${state.fontSize}px` }, s.body || ' ');
  const mover = h('div', { class: 'mover' }, text);
  const count = h('div', { class: 'count', id: 'count', hidden: '' }, '3');
  const viewport = h('div', { class: 'viewport' }, mover, count);

  let downY = 0;
  let downScroll = 0;
  let moved = false;
  let active = false;
  viewport.addEventListener('pointerdown', (e) => {
    active = true;
    moved = false;
    downY = e.clientY;
    downScroll = scrollY;
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!active || playing || counting) return;
    const dy = e.clientY - downY;
    if (Math.abs(dy) > 8) moved = true;
    if (!moved) return;
    scrollY = clamp(downScroll - dy, 0, maxScroll());
    if (mode === 'done' && scrollY < maxScroll() - 2) mode = 'pause';
    applyTransform();
  });
  viewport.addEventListener('pointerup', () => {
    active = false;
    if (moved) { moved = false; return; }
    onSurfaceTap();
  });
  viewport.addEventListener('pointercancel', () => { active = false; });

  const sizeVal = h('span', { class: 'num' }, String(state.fontSize));
  const speedVal = h('span', { class: 'num' }, String(state.speed));
  const mirrorBtn = h('button', {
    class: 'btn', type: 'button', 'aria-pressed': String(state.mirror),
    onclick: () => {
      state.mirror = !state.mirror;
      text.classList.toggle('mirror', state.mirror);
      mirrorBtn.setAttribute('aria-pressed', String(state.mirror));
      mirrorBtn.textContent = state.mirror ? t.mirrorOff : t.mirror;
      queueSave();
    },
  }, state.mirror ? t.mirrorOff : t.mirror);

  app.replaceChildren(
    h('div', { class: 'play' },
      h('header', { class: 'topbar' },
        h('button', { class: 'top-back', type: 'button', onclick: leavePlay }, t.back),
        h('h1', {}, titleOf(s)),
        langToggle(state.lang, setLang),
      ),
      viewport,
      h('div', { class: 'play-controls' },
        h('label', { class: 'field' }, `${t.size} `, sizeVal,
          h('input', {
            type: 'range', min: '28', max: '120', step: '2', value: String(state.fontSize),
            oninput: (e: Event) => {
              state.fontSize = Number((e.target as HTMLInputElement).value);
              sizeVal.textContent = String(state.fontSize);
              text.style.fontSize = `${state.fontSize}px`;
              queueSave();
            },
          }),
        ),
        h('label', { class: 'field' }, `${t.speed} `, speedVal,
          h('input', {
            type: 'range', min: '10', max: '180', step: '2', value: String(state.speed),
            oninput: (e: Event) => {
              state.speed = Number((e.target as HTMLInputElement).value);
              speedVal.textContent = String(state.speed);
              queueSave();
            },
          }),
        ),
        h('div', { class: 'row' },
          mirrorBtn,
          h('button', {
            id: 'run-btn', class: 'btn primary grow', type: 'button',
            onclick: () => { if (mode === 'done') restart(); else onSurfaceTap(); },
          }, t.pause),
          h('button', { class: 'btn', type: 'button', onclick: restart }, t.restart),
        ),
        h('p', { class: 'small', style: 'margin:0;color:#b7b2a8' }, t.tapHint),
      ),
    ),
  );

  applyTransform();
  if (arm) {
    arm = false;
    scrollY = 0;
    applyTransform();
    void beginCountdown();
  } else if (playing) {
    lastTs = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    setRunLabel();
  } else {
    setRunLabel();
  }
}

async function boot(): Promise<void> {
  await askPersist();
  try { state = normalize(await idbLoad(DB)); }
  catch {
    state = { lang: 'ja', scripts: [], fontSize: 52, speed: 40, mirror: false };
    showSaveBanner();
  }
  t = dicts[state.lang];
  document.documentElement.lang = state.lang;
  document.title = t.app;
  render();
}
void boot();

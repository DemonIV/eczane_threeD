// Uygulama girişi: state → core hesap → sahne + UI bağlama (SPEC §3.2 katman ayrımı).
import './style.css';
import { computeDerived } from './core/geometry';
import { validate } from './core/validate';
import { solve } from './core/solver';
import { defaultParams } from './core/defaults';
import type { CabinetParams, Derived, GroupParams } from './core/types';
import { SceneManager, type CameraPreset } from './scene/SceneManager';
import { CabinetBuilder } from './scene/CabinetBuilder';
import { RobotRig } from './scene/RobotRig';
import { Delivery } from './scene/Delivery';
import { Controls } from './ui/Controls';
import { Metrics, renderStatusChip } from './ui/Metrics';
import { AiPanel } from './ui/AiPanel';
import { decodeShare, encodeShare, loadLocal, saveLocal } from './core/store';
import { openReport } from './ui/report';
import type { Diagnostic, SolverReport } from './core/types';

// Açılış önceliği: paylaşım linki (#p=...) > son otomatik kayıt > varsayılanlar.
let params: CabinetParams =
  decodeShare(location.hash) ?? loadLocal() ?? defaultParams();
let derived: Derived = computeDerived(params);
let lastDiags: Diagnostic[] = [];
let lastReport: SolverReport = solve(params, derived);

const canvas = document.getElementById('c3d') as HTMLCanvasElement;
const scene = new SceneManager(canvas);
const cabinet = new CabinetBuilder(scene.scene);
const delivery = new Delivery(scene.scene);
const robot = new RobotRig(scene.scene);
const metrics = new Metrics(document.getElementById('metrics')!);
const statusChip = document.getElementById('status-chip')!;

// Sahne yeniden kurulumu debounce'lu (SPEC §3.3: input'ta hesap, ~32ms toparlama).
let sceneTimer: number | null = null;
function scheduleSceneUpdate(): void {
  if (sceneTimer !== null) return;
  sceneTimer = window.setTimeout(() => {
    sceneTimer = null;
    cabinet.update(params, derived);
    delivery.update(params, derived);
    robot.update(params, derived);
  }, 32);
}

function recompute(): void {
  derived = computeDerived(params);
  lastDiags = validate(params, derived);
  lastReport = solve(params, derived);
  metrics.render(params, derived, lastDiags);
  renderStatusChip(statusChip, derived);
  controls.updateDerived(derived, lastDiags, lastReport);
  scheduleSceneUpdate();
}

// --- Geçmiş (undo/redo) + otomatik kayıt ---
const HISTORY_MAX = 100;
const past: CabinetParams[] = [];
const future: CabinetParams[] = [];
let lastHistoryPush = 0;

const snapshot = (): CabinetParams => JSON.parse(JSON.stringify(params)) as CabinetParams;

function pushHistory(force = false): void {
  const now = performance.now();
  // Slider sürüklemesi saniyede onlarca yama üretir: 400ms içindeki ardışık
  // değişiklikler tek geri-alma adımı sayılır.
  if (!force && now - lastHistoryPush < 400 && past.length > 0) {
    future.length = 0;
    return;
  }
  past.push(snapshot());
  if (past.length > HISTORY_MAX) past.shift();
  future.length = 0;
  lastHistoryPush = now;
  updateHistoryButtons();
}

let saveTimer: number | null = null;
function scheduleSave(): void {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    saveLocal(params);
  }, 300);
}

/** Tüm parametre değişiklikleri (paneller + AI) bu tek noktadan geçer. */
function applyPatch(
  patch: Partial<CabinetParams>,
  groups?: GroupParams[],
  opts?: { rebuild?: boolean },
): void {
  pushHistory();
  params = { ...params, ...patch, groups: groups ?? params.groups };
  if (opts?.rebuild) controls.build();
  recompute();
  scheduleSave();
}

function restore(p: CabinetParams): void {
  params = p;
  controls.build(); // yapısal değişiklik olabilir — panel DOM'u yeniden kurulur
  recompute();
  scheduleSave();
  updateHistoryButtons();
}

function undo(): void {
  const prev = past.pop();
  if (!prev) return;
  future.push(snapshot());
  restore(prev);
}

function redo(): void {
  const next = future.pop();
  if (!next) return;
  past.push(snapshot());
  lastHistoryPush = performance.now();
  restore(next);
}

function resetAll(): void {
  pushHistory(true); // sıfırlama her zaman geri alınabilir
  restore(defaultParams());
}

const aiPanel = new AiPanel({
  getParams: () => params,
  getDerived: () => derived,
  getDiags: () => lastDiags,
  getReport: () => lastReport,
  onPatch: applyPatch,
});

const controls = new Controls(
  document.getElementById('tabs')!,
  document.getElementById('tab-content')!,
  () => params,
  () => derived,
  { onPatch: applyPatch },
  (el) => aiPanel.mount(el),
);

// --- Üst bar eylemleri: geri/ileri/sıfırla/paylaş/rapor ---
const topActions = document.getElementById('top-actions')!;
function topBtn(icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = icon;
  b.title = title;
  b.addEventListener('click', onClick);
  topActions.appendChild(b);
  return b;
}
const undoBtn = topBtn('↩', 'Geri al (Ctrl+Z)', undo);
const redoBtn = topBtn('↪', 'Yinele (Ctrl+Y)', redo);
topBtn('⟲', 'Varsayılanlara sıfırla', resetAll);
const shareBtn = topBtn('🔗', 'Paylaşım linkini kopyala', () => {
  const url = `${location.origin}${location.pathname}#p=${encodeShare(params)}`;
  window.history.replaceState(null, '', url.slice(url.indexOf('#')));
  navigator.clipboard
    ?.writeText(url)
    .then(() => flashBtn(shareBtn, '✓'))
    .catch(() => flashBtn(shareBtn, '⚠'));
});
const reportBtn = topBtn('📄', 'Rapor + kesim listesi (yazdır/PDF)', () => {
  if (!openReport(params, derived, lastDiags)) flashBtn(reportBtn, '⚠');
});

function flashBtn(b: HTMLButtonElement, txt: string): void {
  const old = b.textContent;
  b.textContent = txt;
  window.setTimeout(() => (b.textContent = old), 1200);
}

function updateHistoryButtons(): void {
  undoBtn.disabled = past.length === 0;
  redoBtn.disabled = future.length === 0;
}
updateHistoryButtons();

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) {
    e.preventDefault();
    redo();
  }
});

// --- Viewport butonları ---
const camHost = document.getElementById('cam-presets')!;
const presets: Array<[CameraPreset, string]> = [
  ['front', 'Ön'],
  ['side', 'Yan'],
  ['perspective', '3D'],
  ['iso', 'İzo'],
];
for (const [id, label] of presets) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => scene.setPreset(id, params));
  camHost.appendChild(b);
}

const actions = document.getElementById('vp-actions')!;
const dispenseBtn = document.createElement('button');
dispenseBtn.textContent = '🤖 İlaç getir';
dispenseBtn.addEventListener('click', () => robot.dispense(params, derived, delivery.getDropInfo()));
actions.appendChild(dispenseBtn);

let dimsOn = true;
const dimBtn = document.createElement('button');
dimBtn.textContent = '📐 Ölçüler';
dimBtn.className = 'toggled';
dimBtn.addEventListener('click', () => {
  dimsOn = !dimsOn;
  cabinet.setDimsVisible(dimsOn);
  dimBtn.classList.toggle('toggled', dimsOn);
});
actions.appendChild(dimBtn);

let boxesOn = true;
const boxBtn = document.createElement('button');
boxBtn.textContent = '📦 Kutular';
boxBtn.className = 'toggled';
boxBtn.addEventListener('click', () => {
  boxesOn = !boxesOn;
  cabinet.setBoxesVisible(boxesOn);
  boxBtn.classList.toggle('toggled', boxesOn);
});
actions.appendChild(boxBtn);

// --- Başlat ---
controls.build();
recompute();
scene.onFrame((dt) => robot.tick(dt));
scene.setPreset('perspective', params);
scene.start();

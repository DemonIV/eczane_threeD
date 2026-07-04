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
import type { Diagnostic, SolverReport } from './core/types';

let params: CabinetParams = defaultParams();
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

const aiPanel = new AiPanel({
  getParams: () => params,
  getDerived: () => derived,
  getDiags: () => lastDiags,
  getReport: () => lastReport,
  onPatch(patch, groups, opts) {
    params = { ...params, ...patch, groups: groups ?? params.groups };
    if (opts?.rebuild) controls.build();
    recompute();
  },
});

const controls = new Controls(
  document.getElementById('tabs')!,
  document.getElementById('tab-content')!,
  () => params,
  () => derived,
  {
    onPatch(patch, groups?: GroupParams[], opts?) {
      params = { ...params, ...patch, groups: groups ?? params.groups };
      if (opts?.rebuild) controls.build();
      recompute();
    },
  },
  (el) => aiPanel.mount(el),
);

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

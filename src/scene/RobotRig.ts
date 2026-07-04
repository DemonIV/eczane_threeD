// SPEC §1/§10 — kartezyen robot: tavanda X-gantry + gezen dikey Y-kolonu + kafa.
// "İlaç getir": doğru kanala X-Y servo hareketi → mandal → kutu teslim noktasına akar.
import * as THREE from 'three';
import type { CabinetParams, Derived } from '../core/types';
import type { DropInfo } from './Delivery';

type Phase = 'idle' | 'toPick' | 'dwell' | 'toDrop' | 'fall' | 'slide' | 'fade' | 'toHome';

const STEEL = new THREE.MeshStandardMaterial({ color: 0x4a5462, metalness: 0.8, roughness: 0.3 });
const ACCENT = new THREE.MeshStandardMaterial({ color: 0xffc857, metalness: 0.4, roughness: 0.5 });

export class RobotRig {
  readonly group = new THREE.Group();
  busy = false;

  private column!: THREE.Mesh;
  private carriage!: THREE.Mesh;
  private head!: THREE.Group;
  private disposables: Array<{ dispose(): void }> = [];

  private zPlane = 0;
  private homeX = 0;
  private homeY = 1;
  private speed = 1;
  private phase: Phase = 'idle';
  private target = new THREE.Vector2();
  private dwellLeft = 0;
  private carryBox: THREE.Mesh | null = null;
  private carryBoxH = 0;
  private drop: DropInfo | null = null;
  private fallVel = 0;
  private fadeLeft = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  private clear(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.group.clear();
    this.releaseBox();
  }

  private releaseBox(): void {
    if (this.carryBox) {
      this.carryBox.geometry.dispose();
      (this.carryBox.material as THREE.Material).dispose();
      this.carryBox.parent?.remove(this.carryBox);
      this.carryBox = null;
    }
  }

  update(p: CabinetParams, d: Derived): void {
    this.clear();
    this.phase = 'idle';
    this.busy = false;
    this.speed = p.robotSpeed;
    this.zPlane = p.D / 2 - p.robotDepthClearance / 2;
    this.homeX = 0;
    this.homeY = p.bottomMargin + d.usableHeight * 0.4;

    const { W, H } = p;
    // X-gantry kirişi (tavan)
    const beamG = new THREE.BoxGeometry(W - 0.12, 0.08, 0.08);
    this.disposables.push(beamG);
    const beam = new THREE.Mesh(beamG, STEEL);
    beam.position.set(0, H - 0.1, this.zPlane);
    this.group.add(beam);

    // gantry üzerinde gezen araba
    const carG = new THREE.BoxGeometry(0.16, 0.14, 0.14);
    this.disposables.push(carG);
    this.carriage = new THREE.Mesh(carG, ACCENT);
    this.carriage.position.set(this.homeX, H - 0.1, this.zPlane);
    this.group.add(this.carriage);

    // dikey Y-kolonu (arabayla birlikte X'te gezer)
    const colH = H - 0.24;
    const colG = new THREE.BoxGeometry(0.07, colH, 0.05);
    this.disposables.push(colG);
    this.column = new THREE.Mesh(colG, STEEL);
    this.column.position.set(this.homeX, colH / 2 + 0.02, this.zPlane);
    this.group.add(this.column);

    // kafa (mandal/tepsi mekanizması)
    this.head = new THREE.Group();
    const headG = new THREE.BoxGeometry(0.2, 0.1, 0.12);
    this.disposables.push(headG);
    this.head.add(new THREE.Mesh(headG, ACCENT));
    const trayG = new THREE.BoxGeometry(0.24, 0.015, 0.16);
    this.disposables.push(trayG);
    const tray = new THREE.Mesh(trayG, STEEL);
    tray.position.set(0, -0.06, 0.02);
    this.head.add(tray);
    this.head.position.set(this.homeX, this.homeY, this.zPlane);
    this.group.add(this.head);
  }

  /** Rastgele bir kanaldan ilaç getirme animasyonu başlatır. */
  dispense(p: CabinetParams, d: Derived, drop: DropInfo | null): void {
    if (this.busy || d.shelves.length === 0 || !drop) return;
    // rastgele raf + (oluğu olan) kolon + kanal seç
    const shelf = d.shelves[Math.floor(Math.random() * d.shelves.length)];
    const g = p.groups[shelf.groupIndex];
    const gd = d.groups[shelf.groupIndex];
    const validCols = gd.channelsPerColumn
      .map((cnt, i) => ({ cnt, i }))
      .filter((x) => x.cnt > 0);
    if (validCols.length === 0) return;
    const { cnt, i: col } = validCols[Math.floor(Math.random() * validCols.length)];
    const k = Math.floor(Math.random() * cnt);

    const totalWidth = cnt * gd.xPitch;
    const xLeft = d.columnLefts[col] + (d.columnWidths[col] - totalWidth) / 2;
    const pickX = xLeft + k * gd.xPitch + g.flangeThickness + g.channelInnerWidth / 2;
    const pickY = shelf.frontY + gd.sectionHeight / 2;

    // taşınacak kutu (grup rengi/boyutu)
    const boxG = new THREE.BoxGeometry(g.med.w, g.med.h, g.med.len);
    const boxM = new THREE.MeshStandardMaterial({
      color: g.color,
      metalness: 0.05,
      roughness: 0.7,
      transparent: true,
    });
    this.carryBox = new THREE.Mesh(boxG, boxM);
    this.carryBoxH = g.med.h;
    this.carryBox.visible = false;
    this.group.add(this.carryBox);

    this.drop = drop;
    this.target.set(pickX, pickY);
    this.phase = 'toPick';
    this.busy = true;
  }

  /** Her karede çağrılır; servo hızıyla ölçekli hareket (SPEC §5). */
  tick(dt: number): void {
    if (this.phase === 'idle') return;
    const h = this.head.position;

    const moveAxes = (): boolean => {
      const step = this.speed * dt;
      const dx = this.target.x - h.x;
      const dy = this.target.y - h.y;
      h.x += Math.abs(dx) <= step ? dx : Math.sign(dx) * step;
      h.y += Math.abs(dy) <= step ? dy : Math.sign(dy) * step;
      return Math.abs(this.target.x - h.x) < 1e-4 && Math.abs(this.target.y - h.y) < 1e-4;
    };

    switch (this.phase) {
      case 'toPick':
        if (moveAxes()) {
          this.phase = 'dwell';
          this.dwellLeft = 0.5; // mandal süresi
        }
        break;
      case 'dwell':
        this.dwellLeft -= dt;
        if (this.dwellLeft <= 0.25 && this.carryBox) this.carryBox.visible = true; // kutu mandaldan tepsiye
        if (this.dwellLeft <= 0 && this.drop) {
          this.target.set(this.drop.robotX, this.drop.robotY);
          this.phase = 'toDrop';
        }
        break;
      case 'toDrop':
        if (moveAxes()) {
          this.phase = 'fall';
          this.fallVel = 0;
          if (this.carryBox && this.drop) {
            // kutuyu kafadan ayır, düşüş X/Z hedefine hizala
            this.carryBox.position.x = this.drop.fallTo.x === this.drop.slideTo.x ? this.drop.fallTo.x : h.x;
            this.carryBox.position.z = this.drop.fallTo.z;
          }
        }
        break;
      case 'fall':
        if (this.carryBox && this.drop) {
          this.fallVel += 6 * dt;
          this.carryBox.position.y -= this.fallVel * dt;
          if (this.carryBox.position.y <= this.drop.fallTo.y) {
            this.carryBox.position.y = this.drop.fallTo.y;
            this.phase = 'slide';
          }
        } else this.phase = 'toHome';
        break;
      case 'slide':
        if (this.carryBox && this.drop) {
          const to = this.drop.slideTo;
          const v = new THREE.Vector3().subVectors(to, this.carryBox.position);
          const dist = v.length();
          const step = 0.9 * dt;
          if (dist <= step) {
            this.carryBox.position.copy(to);
            this.phase = 'fade';
            this.fadeLeft = 0.7;
          } else {
            this.carryBox.position.addScaledVector(v.normalize(), step);
          }
        } else this.phase = 'toHome';
        break;
      case 'fade':
        this.fadeLeft -= dt;
        if (this.carryBox) {
          (this.carryBox.material as THREE.MeshStandardMaterial).opacity = Math.max(0, this.fadeLeft / 0.7);
        }
        if (this.fadeLeft <= 0) {
          this.releaseBox();
          this.target.set(this.homeX, this.homeY);
          this.phase = 'toHome';
        }
        break;
      case 'toHome':
        if (moveAxes()) {
          this.phase = 'idle';
          this.busy = false;
        }
        break;
    }

    // kolon + araba kafayı izler; taşınan kutu tepside durur
    this.column.position.x = h.x;
    this.carriage.position.x = h.x;
    if (this.carryBox && (this.phase === 'dwell' || this.phase === 'toDrop')) {
      this.carryBox.position.set(h.x, h.y - 0.04 + this.carryBoxH / 2, this.zPlane + 0.09);
    }
  }
}

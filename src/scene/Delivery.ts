// SPEC §1/§5 — teslim varyantı: yan hazne VEYA alt konveyör. İkisi de modellenir,
// parametreyle seçilir. RobotRig, düşen kutunun hedefini buradan alır.
import * as THREE from 'three';
import type { CabinetParams, Derived } from '../core/types';

export interface DropInfo {
  /** Robotun bırakma öncesi gitmesi gereken X (dünya) ve Y (dünya). */
  robotX: number;
  robotY: number;
  /** Kutunun serbest düşüş hedefi (hazne ağzı / bant üstü). */
  fallTo: THREE.Vector3;
  /** Düşüş sonrası kayma hedefi (konveyörde bant sonu; haznede aynı nokta). */
  slideTo: THREE.Vector3;
}

const BIN_MAT = new THREE.MeshStandardMaterial({
  color: 0x2f6f4f,
  metalness: 0.3,
  roughness: 0.6,
  transparent: true,
  opacity: 0.85,
});
const BELT_MAT = new THREE.MeshStandardMaterial({ color: 0x23262c, metalness: 0.2, roughness: 0.9 });
const ROLLER_MAT = new THREE.MeshStandardMaterial({ color: 0x8a919c, metalness: 0.8, roughness: 0.3 });

export class Delivery {
  readonly group = new THREE.Group();
  private disposables: Array<{ dispose(): void }> = [];
  private info: DropInfo | null = null;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  private clear(): void {
    for (const dd of this.disposables) dd.dispose();
    this.disposables = [];
    this.group.clear();
  }

  update(p: CabinetParams, d: Derived): void {
    this.clear();
    if (p.delivery === 'side_bin') this.buildSideBin(p, d);
    else this.buildConveyor(p, d);
  }

  getDropInfo(): DropInfo | null {
    return this.info;
  }

  /** Yan teslim haznesi: kabinin sağ dış yüzünde, eczacı erişim yüksekliğinde. */
  private buildSideBin(p: CabinetParams, d: Derived): void {
    const binW = 0.4;
    const binH = 0.3;
    const binD = 0.45;
    const wall = 0.012;
    const cx = p.W / 2 + binW / 2 + 0.02;
    const cy = 0.85;
    const cz = p.D / 2 - binD / 2 - 0.05;

    const parts: Array<[number, number, number, number, number, number]> = [
      [cx, cy - binH / 2, cz, binW, wall, binD], // taban
      [cx - binW / 2, cy, cz, wall, binH, binD], // sol (kabine bitişik)
      [cx + binW / 2, cy, cz, wall, binH, binD], // sağ
      [cx, cy, cz - binD / 2, binW, binH, wall], // arka
      [cx, cy, cz + binD / 2, binW, binH, wall], // ön
    ];
    for (const [x, y, z, sx, sy, sz] of parts) {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      this.disposables.push(g);
      const m = new THREE.Mesh(g, BIN_MAT);
      m.position.set(x, y, z);
      this.group.add(m);
    }
    const target = new THREE.Vector3(cx, cy - binH / 2 + 0.06, cz);
    this.info = {
      robotX: d.usableWidth / 2, // robot en sağa gider, kutu hazneye akar
      robotY: cy + binH,
      fallTo: target,
      slideTo: target,
    };
  }

  /** Alt konveyör bandı: kabin içi ön-alt, sağa doğru taşır, sağ dışta teslim ucu. */
  private buildConveyor(p: CabinetParams, d: Derived): void {
    const beltY = 0.14;
    const beltZ = p.D / 2 - 0.18;
    const beltDepth = 0.28;
    const beltLen = d.usableWidth + 0.6;
    const beltX = -d.usableWidth / 2 + beltLen / 2; // sağa 0.6 m taşar

    const beltG = new THREE.BoxGeometry(beltLen, 0.03, beltDepth);
    this.disposables.push(beltG);
    const belt = new THREE.Mesh(beltG, BELT_MAT);
    belt.position.set(beltX, beltY, beltZ);
    this.group.add(belt);

    // makaralar + ayaklar
    const rollG = new THREE.CylinderGeometry(0.035, 0.035, beltDepth, 12);
    rollG.rotateX(Math.PI / 2);
    this.disposables.push(rollG);
    for (const ex of [-beltLen / 2 + 0.05, beltLen / 2 - 0.05]) {
      const r = new THREE.Mesh(rollG, ROLLER_MAT);
      r.position.set(beltX + ex, beltY, beltZ);
      this.group.add(r);
    }
    const legG = new THREE.BoxGeometry(0.04, beltY, 0.04);
    this.disposables.push(legG);
    for (const ex of [-beltLen / 2 + 0.1, 0, beltLen / 2 - 0.1]) {
      const leg = new THREE.Mesh(legG, ROLLER_MAT);
      leg.position.set(beltX + ex, beltY / 2, beltZ);
      this.group.add(leg);
    }

    this.info = {
      robotX: 0, // robot bulunduğu X'te bırakabilir; 0 = varsayılan
      robotY: beltY + 0.25,
      fallTo: new THREE.Vector3(0, beltY + 0.05, beltZ),
      slideTo: new THREE.Vector3(beltX + beltLen / 2 - 0.1, beltY + 0.05, beltZ),
    };
  }
}

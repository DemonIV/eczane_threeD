// SPEC §2.8/§3.3 — sigma profil şasi + nested eğimli raflar (gerçek U-kesit ExtrudeGeometry)
// + ilaç kutuları (InstancedMesh) + ölçü çizgileri (sunum modu).
import * as THREE from 'three';
import { buildGroupSection } from '../core/profile';
import { degToRad } from '../core/geometry';
import type { CabinetParams, Derived } from '../core/types';

/** Mobil güvenlik tavanı: instanced kutu sayısı bunu aşarsa kanal başına gösterim kısılır. */
const MAX_BOX_INSTANCES = 60000;

const ALU = new THREE.MeshStandardMaterial({ color: 0xb9bec7, metalness: 0.75, roughness: 0.35 });
const ALU_DARK = new THREE.MeshStandardMaterial({ color: 0x7d838d, metalness: 0.7, roughness: 0.45 });
const PANEL = new THREE.MeshStandardMaterial({
  color: 0x8fa3b8,
  transparent: true,
  opacity: 0.1,
  side: THREE.DoubleSide,
  depthWrite: false,
});

function beamMatrix(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(cx, cy, cz),
    new THREE.Quaternion(),
    new THREE.Vector3(sx, sy, sz),
  );
}

function makeTextSprite(text: string, color = '#e8edf5'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = '600 44px system-ui, sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 28;
  canvas.width = w;
  canvas.height = 64;
  ctx.font = font;
  ctx.fillStyle = 'rgba(16,20,27,0.72)';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, 64, 12);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 14, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const spr = new THREE.Sprite(mat);
  const s = 0.0035;
  spr.scale.set(w * s, 64 * s, 1);
  spr.renderOrder = 10;
  return spr;
}

/** İki nokta arası ölçü çizgisi: uç çizgileri + etiket. */
function makeDimension(a: THREE.Vector3, b: THREE.Vector3, label: string, tickDir: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0xffc857 });
  const tick = tickDir.clone().normalize().multiplyScalar(0.06);
  const pts = [
    a.clone().add(tick), a.clone().sub(tick),
    a, b,
    b.clone().add(tick), b.clone().sub(tick),
  ];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  g.add(new THREE.LineSegments(geo, mat));
  const spr = makeTextSprite(label, '#ffc857');
  spr.position.copy(a).lerp(b, 0.5).add(tick.clone().multiplyScalar(2.2));
  g.add(spr);
  return g;
}

export class CabinetBuilder {
  readonly group = new THREE.Group();
  private content = new THREE.Group();
  private dims = new THREE.Group();
  private boxMeshes: THREE.InstancedMesh[] = [];
  private disposables: Array<{ dispose(): void }> = [];
  private showBoxes = true;
  private showDims = true;

  constructor(scene: THREE.Scene) {
    this.group.add(this.content, this.dims);
    scene.add(this.group);
  }

  setBoxesVisible(v: boolean): void {
    this.showBoxes = v;
    for (const m of this.boxMeshes) m.visible = v;
  }

  setDimsVisible(v: boolean): void {
    this.showDims = v;
    this.dims.visible = v;
  }

  private clear(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.boxMeshes = [];
    this.content.clear();
    this.dims.clear();
  }

  /** Parametre değişiminde çağrılır (debounce'lu). Sahneyi param+derived'dan yeniden kurar. */
  update(p: CabinetParams, d: Derived): void {
    this.clear();
    this.buildFrame(p, d);
    this.buildShelvesAndBoxes(p, d);
    this.buildDimensions(p, d);
    this.dims.visible = this.showDims;
  }

  // ---- Şasi: sigma profil iskelet + saydam paneller ----
  private buildFrame(p: CabinetParams, d: Derived): void {
    const { W, H, D } = p;
    const t = 0.045; // 45mm sigma profil
    const unit = new THREE.BoxGeometry(1, 1, 1);
    this.disposables.push(unit);

    const mats: THREE.Matrix4[] = [];
    const hx = W / 2 - t / 2;
    const hz = D / 2 - t / 2;
    // 4 dikey köşe
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      mats.push(beamMatrix(sx * hx, H / 2, sz * hz, t, H, t));
    }
    // üst/alt X kirişleri (ön/arka)
    for (const sy of [0, 1]) for (const sz of [-1, 1]) {
      mats.push(beamMatrix(0, sy * (H - t) + t / 2, sz * hz, W - 2 * t, t, t));
    }
    // üst/alt Z kirişleri (sol/sağ)
    for (const sy of [0, 1]) for (const sx of [-1, 1]) {
      mats.push(beamMatrix(sx * hx, sy * (H - t) + t / 2, 0, t, t, D));
    }
    // kolon ayırıcı dikmeler (ön+arka), kullanılabilir bölge sınırlarında
    const uW = d.usableWidth;
    for (let i = 0; i <= p.nColumns; i++) {
      const x = -uW / 2 + i * d.columnWidth;
      for (const sz of [-1, 1]) {
        mats.push(beamMatrix(x, H / 2, sz * (hz - t), t * 0.8, H - 2 * t, t * 0.8));
      }
    }
    const frame = new THREE.InstancedMesh(unit, ALU, mats.length);
    mats.forEach((m, i) => frame.setMatrixAt(i, m));
    this.disposables.push(frame);
    this.content.add(frame);

    // saydam yan/arka/üst paneller
    const panels = new THREE.Group();
    const mk = (w: number, h: number, px: number, py: number, pz: number, ry = 0): void => {
      const g = new THREE.PlaneGeometry(w, h);
      this.disposables.push(g);
      const mesh = new THREE.Mesh(g, PANEL);
      mesh.position.set(px, py, pz);
      mesh.rotation.y = ry;
      panels.add(mesh);
    };
    mk(W, H, 0, H / 2, -D / 2); // arka
    mk(D, H, -W / 2, H / 2, 0, Math.PI / 2); // sol
    mk(D, H, W / 2, H / 2, 0, Math.PI / 2); // sağ
    this.content.add(panels);
  }

  // ---- Raflar (grup başına ExtrudeGeometry, InstancedMesh) + kutular ----
  private buildShelvesAndBoxes(p: CabinetParams, d: Derived): void {
    const tilt = degToRad(p.tiltDeg);
    const rot = new THREE.Matrix4().makeRotationX(tilt);
    const zBack = -p.D / 2 + 0.02;
    const uW = d.usableWidth;

    // Kutu bütçesi: toplam ilaç tavanı aşarsa kanal başına gösterimi orantıla (SPEC §3.3 mobil).
    const boxBudgetScale = d.totalMeds > MAX_BOX_INSTANCES ? MAX_BOX_INSTANCES / d.totalMeds : 1;

    p.groups.forEach((g, gi) => {
      if (!g.enabled || g.nRows <= 0) return;
      const gd = d.groups[gi];
      const section = buildGroupSection(g, d.columnWidth);
      if (section.channelCount === 0) return;

      // U-kesit → THREE.Shape → Extrude (SPEC §2.8: kutu-yaklaşımı DEĞİL, gerçek profil)
      const shape = new THREE.Shape(section.points.map((q) => new THREE.Vector2(q.x, q.y)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: d.L, bevelEnabled: false });
      this.disposables.push(geo);

      const shelfRows = d.shelves.filter((s) => s.groupIndex === gi);
      const shelfMesh = new THREE.InstancedMesh(geo, ALU_DARK, shelfRows.length * p.nColumns);

      // kutu instanced mesh
      const medGeo = new THREE.BoxGeometry(g.med.w, g.med.h, g.med.len);
      this.disposables.push(medGeo);
      const medMat = new THREE.MeshStandardMaterial({
        color: g.color,
        metalness: 0.05,
        roughness: 0.7,
      });
      this.disposables.push(medMat);
      const medsShown = Math.max(
        gd.medsPerChannel > 0 ? 1 : 0,
        Math.floor(gd.medsPerChannel * boxBudgetScale),
      );
      const boxCount = shelfRows.length * p.nColumns * section.channelCount * medsShown;
      const boxMesh = new THREE.InstancedMesh(medGeo, medMat, boxCount);

      let si = 0;
      let bi = 0;
      const tmp = new THREE.Matrix4();
      const local = new THREE.Matrix4();
      for (const shelf of shelfRows) {
        for (let c = 0; c < p.nColumns; c++) {
          const colLeft = -uW / 2 + c * d.columnWidth;
          const xLeft = colLeft + (d.columnWidth - section.totalWidth) / 2;
          // raf: yerel (0,0,0)=arka-alt köşe → dünya (xLeft, frontY+rise, zBack), X ekseninde +α
          const shelfM = new THREE.Matrix4()
            .makeTranslation(xLeft, shelf.frontY + d.rise, zBack)
            .multiply(rot);
          shelfMesh.setMatrixAt(si++, shelfM);

          for (let k = 0; k < section.channelCount; k++) {
            const cx = k * section.xPitch + g.flangeThickness + g.channelInnerWidth / 2;
            for (let s = 0; s < medsShown; s++) {
              // öndeki kutu s=0: yerel z = L - (s+0.5)*medLen (kutular öne yaslı — gravity feed)
              local.makeTranslation(
                cx,
                g.baseThickness + g.med.h / 2 + 0.002,
                d.L - (s + 0.5) * g.med.len,
              );
              tmp.copy(shelfM).multiply(local);
              boxMesh.setMatrixAt(bi++, tmp);
            }
          }
        }
      }
      shelfMesh.instanceMatrix.needsUpdate = true;
      boxMesh.instanceMatrix.needsUpdate = true;
      this.disposables.push(shelfMesh, boxMesh);
      boxMesh.visible = this.showBoxes;
      this.boxMeshes.push(boxMesh);
      this.content.add(shelfMesh, boxMesh);
    });
  }

  // ---- Sunum modu ölçü çizgileri (SPEC §5) ----
  private buildDimensions(p: CabinetParams, d: Derived): void {
    const { W, H, D } = p;
    const zF = D / 2;
    const off = 0.25;
    this.dims.add(
      makeDimension(
        new THREE.Vector3(-W / 2, -off * 0.6, zF),
        new THREE.Vector3(W / 2, -off * 0.6, zF),
        `W = ${(W * 100).toFixed(0)} cm`,
        new THREE.Vector3(0, -1, 0),
      ),
      makeDimension(
        new THREE.Vector3(-W / 2 - off, 0, zF),
        new THREE.Vector3(-W / 2 - off, H, zF),
        `H = ${(H * 100).toFixed(0)} cm`,
        new THREE.Vector3(-1, 0, 0),
      ),
      makeDimension(
        new THREE.Vector3(W / 2 + off, 0, zF - D),
        new THREE.Vector3(W / 2 + off, 0, zF),
        `D = ${(D * 100).toFixed(0)} cm`,
        new THREE.Vector3(1, 0, 0),
      ),
    );
    // eğim + rise etiketi (yan görünüşte anlamlı)
    const mid = d.shelves[Math.floor(d.shelves.length / 2)];
    if (mid) {
      const spr = makeTextSprite(
        `α = ${p.tiltDeg.toFixed(1)}°  ·  rise = ${(d.rise * 100).toFixed(0)} cm`,
        '#8ecdf7',
      );
      spr.position.set(W / 2 + 0.45, mid.frontY + d.rise / 2, 0);
      this.dims.add(spr);
    }
    // kullanılabilir bölge çerçevesi (ön yüz)
    const uGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-d.usableWidth / 2, p.bottomMargin, zF + 0.005),
      new THREE.Vector3(d.usableWidth / 2, p.bottomMargin, zF + 0.005),
      new THREE.Vector3(d.usableWidth / 2, p.bottomMargin + d.usableHeight, zF + 0.005),
      new THREE.Vector3(-d.usableWidth / 2, p.bottomMargin + d.usableHeight, zF + 0.005),
      new THREE.Vector3(-d.usableWidth / 2, p.bottomMargin, zF + 0.005),
    ]);
    this.disposables.push(uGeo);
    this.dims.add(
      new THREE.Line(uGeo, new THREE.LineBasicMaterial({ color: 0x5ad18b, transparent: true, opacity: 0.6 })),
    );
  }
}

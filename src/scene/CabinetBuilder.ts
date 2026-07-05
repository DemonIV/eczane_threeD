// SPEC §2.8/§3.3 — sigma profil şasi + nested eğimli raflar (gerçek U-kesit ExtrudeGeometry)
// + ilaç kutuları (InstancedMesh) + ölçü çizgileri (sunum modu).
import * as THREE from 'three';
import { buildGroupSection } from '../core/profile';
import { degToRad } from '../core/geometry';
import type { CabinetParams, Derived } from '../core/types';

/** Mobil güvenlik tavanı: instanced kutu sayısı bunu aşarsa kanal başına gösterim kısılır. */
const MAX_BOX_INSTANCES = 60000;

const ALU = new THREE.MeshStandardMaterial({ color: 0xb9bec7, metalness: 0.75, roughness: 0.35 });
// Raf malzemesi beyaz taban: gerçek renk instance başına verilir (normal gri / taşan kırmızı).
const SHELF_MAT = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.7, roughness: 0.45 });
const SHELF_COLOR = new THREE.Color(0x7d838d);
const SHELF_COLOR_OVERFLOW = new THREE.Color(0xd84040);
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
function makeDimension(
  a: THREE.Vector3,
  b: THREE.Vector3,
  label: string,
  tickDir: THREE.Vector3,
  color = 0xffc857,
): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color });
  const tick = tickDir.clone().normalize().multiplyScalar(0.06);
  const pts = [
    a.clone().add(tick), a.clone().sub(tick),
    a, b,
    b.clone().add(tick), b.clone().sub(tick),
  ];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  g.add(new THREE.LineSegments(geo, mat));
  const spr = makeTextSprite(label, `#${color.toString(16).padStart(6, '0')}`);
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
    // kolon ayırıcı dikmeler (ön+arka), gerçek kolon sınırlarında (eşit veya özel genişlik)
    const uW = d.usableWidth;
    const boundaries = [...d.columnLefts, uW / 2];
    for (const x of boundaries) {
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

    // Kutu bütçesi: toplam ilaç tavanı aşarsa kanal başına gösterimi orantıla (SPEC §3.3 mobil).
    const boxBudgetScale = d.totalMeds > MAX_BOX_INSTANCES ? MAX_BOX_INSTANCES / d.totalMeds : 1;

    p.groups.forEach((g, gi) => {
      if (!g.enabled || g.nRows <= 0) return;
      const gd = d.groups[gi];
      if (gd.rowChannels === 0) return;
      const shelfRows = d.shelves.filter((s) => s.groupIndex === gi);

      // kutu instanced mesh — grup başına tek mesh (kolon farkı sadece konumda)
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
      const boxMesh = new THREE.InstancedMesh(
        medGeo,
        medMat,
        shelfRows.length * gd.rowChannels * medsShown,
      );
      let bi = 0;
      const tmp = new THREE.Matrix4();
      const local = new THREE.Matrix4();

      // Kolonları oluk sayısına göre grupla: aynı sayı = aynı kesit geometrisi (önbellek).
      const byCount = new Map<number, number[]>();
      gd.channelsPerColumn.forEach((cnt, c) => {
        if (cnt < 1) return;
        const list = byCount.get(cnt) ?? [];
        list.push(c);
        byCount.set(cnt, list);
      });

      for (const [cnt, cols] of byCount) {
        // U-kesit → THREE.Shape → Extrude (SPEC §2.8: kutu-yaklaşımı DEĞİL, gerçek profil)
        const section = buildGroupSection(g, d.columnWidths[cols[0]]);
        if (section.channelCount !== cnt) continue; // güvenlik: hesapla tutarlı olmalı
        const shape = new THREE.Shape(section.points.map((q) => new THREE.Vector2(q.x, q.y)));
        const geo = new THREE.ExtrudeGeometry(shape, { depth: d.L, bevelEnabled: false });
        this.disposables.push(geo);
        const shelfMesh = new THREE.InstancedMesh(geo, SHELF_MAT, shelfRows.length * cols.length);

        let si = 0;
        for (const shelf of shelfRows) {
          // Tavanı delen raf (arka ucu izinli tavanın üstünde) kırmızı gösterilir.
          const overflows = shelf.frontY + d.rise > d.ceilingLimit + 1e-9;
          for (const c of cols) {
            const xLeft = d.columnLefts[c] + (d.columnWidths[c] - section.totalWidth) / 2;
            // raf: yerel (0,0,0)=arka-alt köşe → dünya (xLeft, frontY+rise, zBack), X ekseninde +α
            const shelfM = new THREE.Matrix4()
              .makeTranslation(xLeft, shelf.frontY + d.rise, zBack)
              .multiply(rot);
            shelfMesh.setColorAt(si, overflows ? SHELF_COLOR_OVERFLOW : SHELF_COLOR);
            shelfMesh.setMatrixAt(si++, shelfM);

            for (let k = 0; k < cnt; k++) {
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
        if (shelfMesh.instanceColor) shelfMesh.instanceColor.needsUpdate = true;
        this.disposables.push(shelfMesh);
        this.content.add(shelfMesh);
      }

      boxMesh.count = bi; // güvenlik: yerleşenden fazlasını çizme
      boxMesh.instanceMatrix.needsUpdate = true;
      this.disposables.push(boxMesh);
      boxMesh.visible = this.showBoxes;
      this.boxMeshes.push(boxMesh);
      this.content.add(boxMesh);
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

    // --- Taşma göstergeleri (kırmızı) ---
    const RED = 0xff5d5d;
    if (d.ceilingViolation) {
      // İzinli tavan çizgisi (yan görünüş): sağ yüz boyunca kesikli kırmızı hat.
      const cGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(W / 2 + 0.002, d.ceilingLimit, -D / 2),
        new THREE.Vector3(W / 2 + 0.002, d.ceilingLimit, D / 2),
      ]);
      this.disposables.push(cGeo);
      const cLine = new THREE.Line(
        cGeo,
        new THREE.LineDashedMaterial({ color: RED, dashSize: 0.05, gapSize: 0.035 }),
      );
      cLine.computeLineDistances();
      this.dims.add(cLine);
      // Tavan delme miktarı: en üst rafın arka ucu ↔ izinli tavan (arka tarafta, yan görünüş).
      const xd = W / 2 + 0.18;
      const zd = -D / 2 + 0.03;
      this.dims.add(
        makeDimension(
          new THREE.Vector3(xd, d.ceilingLimit, zd),
          new THREE.Vector3(xd, d.topRowBackY, zd),
          `TAVAN +${(d.ceilingOverflow * 100).toFixed(1)} cm`,
          new THREE.Vector3(1, 0, 0),
          RED,
        ),
      );
    }
    if (d.deficit > 0) {
      // İstif açığı: gerekli istif tepesi ↔ kullanılabilir bölge tepesi (ön yüz).
      const xd = W / 2 + 0.25;
      this.dims.add(
        makeDimension(
          new THREE.Vector3(xd, p.bottomMargin + d.usableHeight, zF),
          new THREE.Vector3(xd, p.bottomMargin + d.stackHeight, zF),
          `İSTİF +${(d.deficit * 100).toFixed(1)} cm`,
          new THREE.Vector3(1, 0, 0),
          RED,
        ),
      );
    }
  }
}

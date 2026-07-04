// SPEC "Not — Doğrulanmış sayısal test vektörleri" birebir kodlanmıştır.
import { describe, expect, it } from 'vitest';
import {
  backRise,
  computeDerived,
  degToRad,
  maxRowsHomogeneous,
  nestedPitch,
  stackHeightHomogeneous,
  usableHeight,
} from './geometry';
import { defaultParams } from './defaults';
import type { CabinetParams } from './types';

/** Tek-profil (homojen) senaryo kurucu: sectionHeight=6.4cm (flanş 6.0 + taban 0.4), rdc=10cm. */
function homogeneous(over: Partial<CabinetParams>, nRows: number): CabinetParams {
  const p = defaultParams();
  return {
    ...p,
    ...over,
    robotDepthClearance: 0.1,
    groups: [
      {
        id: 'medium',
        label: 'Tek',
        enabled: true,
        channelInnerWidth: 0.06,
        flangeHeight: 0.06,
        flangeThickness: 0.003,
        baseThickness: 0.004,
        nRows,
        med: { w: 0.05, h: 0.05, len: 0.12 },
        color: 0x888888,
      },
    ],
  };
}

describe('homojen istif — SPEC test vektörleri (sectionHeight=6.4cm, rdc=10cm)', () => {
  it('pay30/30/5, D=1.25, α=25° → N_max=20 (pitch≈7.06, rise≈49)', () => {
    const tilt = degToRad(25);
    const uH = 2.5 - 0.3 - 0.3 - 0.05; // 1.85
    const L = 1.25 - 0.1; // 1.15
    const pitch = nestedPitch(0.064, tilt);
    const rise = backRise(L, tilt);
    expect(pitch * 100).toBeCloseTo(7.06, 1);
    expect(rise * 100).toBeCloseTo(48.6, 0);
    expect(maxRowsHomogeneous(uH, rise, pitch)).toBe(20);
  });

  it('pay40/25/5, D=1.25, α=27.5° → N_max=18 (pitch≈7.22, rise≈53)', () => {
    const tilt = degToRad(27.5);
    const uH = 2.5 - 0.4 - 0.25 - 0.05; // 1.80
    const pitch = nestedPitch(0.064, tilt);
    const rise = backRise(1.15, tilt);
    expect(pitch * 100).toBeCloseTo(7.22, 1);
    expect(rise * 100).toBeCloseTo(53.1, 0);
    expect(maxRowsHomogeneous(uH, rise, pitch)).toBe(18);
  });

  it('pay15/15/0, D=0.90, α=25° → N_max=27', () => {
    const tilt = degToRad(25);
    const uH = 2.5 - 0.15 - 0.15 - 0; // 2.20
    const pitch = nestedPitch(0.064, tilt);
    const rise = backRise(0.8, tilt);
    expect(maxRowsHomogeneous(uH, rise, pitch)).toBe(27);
  });

  it('taban kalınlığı ihmal edilirse sonuç İYİMSER/HATALI çıkar (21≠20) — regresyon koruması', () => {
    const tilt = degToRad(25);
    const uH = 1.85;
    const rise = backRise(1.15, tilt);
    const wrongPitch = nestedPitch(0.06, tilt); // taban ihmal: 6.0/cosα ≈ 6.62
    expect(wrongPitch * 100).toBeCloseTo(6.62, 1);
    expect(maxRowsHomogeneous(uH, rise, wrongPitch)).toBe(21); // hatalı iyimser değer
  });

  it('stackHeightHomogeneous: (N-1)*pitch + rise, N_max ile tutarlı', () => {
    const tilt = degToRad(25);
    const pitch = nestedPitch(0.064, tilt);
    const rise = backRise(1.15, tilt);
    expect(stackHeightHomogeneous(20, pitch, rise)).toBeLessThanOrEqual(1.85);
    expect(stackHeightHomogeneous(21, pitch, rise)).toBeGreaterThan(1.85);
  });

  it('computeDerived homojen: 20 raf sığar, 21 sığmaz', () => {
    const p20 = homogeneous({ tiltDeg: 25, topMargin: 0.3, bottomMargin: 0.3, topServiceCut: 0.05, D: 1.25 }, 20);
    expect(computeDerived(p20).fits).toBe(true);
    const p21 = homogeneous({ tiltDeg: 25, topMargin: 0.3, bottomMargin: 0.3, topServiceCut: 0.05, D: 1.25 }, 21);
    expect(computeDerived(p21).fits).toBe(false);
  });
});

describe('grup-bazlı (heterojen) — SPEC varsayılan senaryo n=6/9/10, pay30/30/5, D=1.25, α=25°', () => {
  const d = computeDerived(defaultParams());

  it('grup pitchleri: Büyük 9.82 · Orta 7.61 · Küçük 5.41 cm', () => {
    const byId = Object.fromEntries(d.groups.map((g) => [g.id, g]));
    expect(byId.large.pitch * 100).toBeCloseTo(9.82, 1);
    expect(byId.medium.pitch * 100).toBeCloseTo(7.61, 1);
    expect(byId.small.pitch * 100).toBeCloseTo(5.41, 1);
  });

  it('gerekli istif ≈250 cm, mevcut 185 cm → SIĞMAZ', () => {
    expect(d.stackHeight * 100).toBeCloseTo(250, 0);
    expect(d.usableHeight * 100).toBeCloseTo(185, 5);
    expect(d.fits).toBe(false);
    expect(d.deficit).toBeGreaterThan(0);
  });

  it('kanal kırılımı: Büyük 12/kolon→216 · Orta 15/kolon→405 · Küçük 22/kolon→660 · toplam 1281', () => {
    const byId = Object.fromEntries(d.groups.map((g) => [g.id, g]));
    expect(byId.large.channelsPerColumn).toEqual([12, 12, 12]);
    expect(byId.large.channels).toBe(216);
    expect(byId.medium.channelsPerColumn).toEqual([15, 15, 15]);
    expect(byId.medium.channels).toBe(405);
    expect(byId.small.channelsPerColumn).toEqual([22, 22, 22]);
    expect(byId.small.channels).toBe(660);
    expect(d.totalChannels).toBe(1281);
  });

  it('ilaç kırılımı: 1512 + 3645 + 7260 = 12417', () => {
    const byId = Object.fromEntries(d.groups.map((g) => [g.id, g]));
    expect(byId.large.meds).toBe(1512);
    expect(byId.medium.meds).toBe(3645);
    expect(byId.small.meds).toBe(7260);
    expect(d.totalMeds).toBe(12417);
  });

  it('pay15/15/0, D=0.95 → istif ≈237 cm, usable 220 → hâlâ sığmaz; toplam ilaç 9195', () => {
    const p = defaultParams();
    const q = computeDerived({
      ...p,
      topMargin: 0.15,
      bottomMargin: 0.15,
      topServiceCut: 0,
      D: 0.95,
    });
    expect(q.stackHeight * 100).toBeCloseTo(237, 0);
    expect(q.usableHeight * 100).toBeCloseTo(220, 5);
    expect(q.fits).toBe(false);
    expect(q.totalMeds).toBe(9195);
  });
});

describe('yerleşim ve tavan kontrolü', () => {
  it('raf sayısı Σn_g ile eşleşir ve frontY artan sıradadır', () => {
    const d = computeDerived(defaultParams());
    expect(d.shelves.length).toBe(25);
    for (let i = 1; i < d.shelves.length; i++) {
      expect(d.shelves[i].frontY).toBeGreaterThan(d.shelves[i - 1].frontY);
    }
  });

  it('sığmayan istifte en-üst-raf-tavan ihlali raporlanır (SPEC §2.6)', () => {
    const d = computeDerived(defaultParams());
    expect(d.ceilingViolation).toBe(true);
    expect(d.topRowBackY).toBeGreaterThan(d.ceilingLimit);
  });

  it('devre dışı grup kapasiteye ve istife katılmaz', () => {
    const p = defaultParams();
    p.groups = p.groups.map((g) => (g.id === 'large' ? { ...g, enabled: false } : g));
    const d = computeDerived(p);
    expect(d.totalRows).toBe(19);
    expect(d.totalChannels).toBe(405 + 660);
    // 2 aktif grup → tek geçiş payı
    const byId = Object.fromEntries(d.groups.map((g) => [g.id, g]));
    const gap = d.transitionGap;
    expect(d.stackHeight).toBeCloseTo(
      byId.medium.stackShare + byId.small.stackShare + d.rise + gap,
      9,
    );
  });

  it('usableHeight yardımcı fonksiyonu', () => {
    expect(usableHeight({ H: 2.5, topMargin: 0.3, bottomMargin: 0.3, topServiceCut: 0.05 })).toBeCloseTo(1.85, 9);
  });
});

describe('özel kolon genişlikleri (columnMode=custom, son kolon = kalan)', () => {
  it('150/100 cm girilirse son kolon 90 cm; kolon başına oluk sayısı farklı', () => {
    const p = defaultParams(); // uW = 400-60 = 340
    p.columnMode = 'custom';
    p.columnWidths = [1.5, 1.0];
    const d = computeDerived(p);
    expect(d.columnWidths.map((w) => Math.round(w * 100))).toEqual([150, 100, 90]);
    // kolon sol kenarları: -170, -20, +80 cm
    expect(d.columnLefts.map((x) => Math.round(x * 100))).toEqual([-170, -20, 80]);
    const byId = Object.fromEntries(d.groups.map((g) => [g.id, g]));
    // Büyük xPitch=9.1: floor(150/9.1)=16, floor(100/9.1)=10, floor(90/9.1)=9
    expect(byId.large.channelsPerColumn).toEqual([16, 10, 9]);
    expect(byId.large.rowChannels).toBe(35);
    expect(byId.large.channels).toBe(6 * 35);
    // Orta xPitch=7.1: 21/14/12 · Küçük xPitch=5.1: 29/19/17
    expect(byId.medium.channelsPerColumn).toEqual([21, 14, 12]);
    expect(byId.small.channelsPerColumn).toEqual([29, 19, 17]);
    // toplam = Σ nRows*rowChannels
    expect(d.totalChannels).toBe(6 * 35 + 9 * 47 + 10 * 65);
  });

  it('equal modda columnWidths yok sayılır', () => {
    const p = defaultParams();
    p.columnWidths = [3.0, 0.1]; // saçma değerler — equal modda etkisiz olmalı
    const d = computeDerived(p);
    expect(d.columnWidths.every((w) => Math.abs(w - d.usableWidth / 3) < 1e-9)).toBe(true);
  });

  it('kolonlar taşarsa son kolon negatif kalan alır (validate hata üretir)', () => {
    const p = defaultParams();
    p.columnMode = 'custom';
    p.columnWidths = [2.0, 1.6]; // 360 > 340
    const d = computeDerived(p);
    expect(d.columnWidths[2]).toBeLessThan(0);
    // negatif kolonda hiçbir grup kanal alamaz
    for (const g of d.groups) expect(g.channelsPerColumn[2]).toBe(0);
  });
});

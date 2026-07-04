// SPEC §4 + "KRİTİK DERS": varsayılan 25 raf sığmaz; çözücü grup bazında sayısal öneri üretmeli.
import { describe, expect, it } from 'vitest';
import { computeDerived } from './geometry';
import { defaultParams } from './defaults';
import { solve } from './solver';
import type { CabinetParams } from './types';

function applySuggestion(p: CabinetParams, s: { patch: Partial<CabinetParams> | null; groupsPatch?: CabinetParams['groups'] }): CabinetParams {
  return { ...p, ...(s.patch ?? {}), groups: s.groupsPatch ?? p.groups };
}

describe('solve — varsayılan senaryo (25 raf, sığmaz)', () => {
  const p = defaultParams();
  const d = computeDerived(p);
  const r = solve(p, d);

  it('durumu doğru raporlar: 25 raf yapılandırılmış, sığmıyor, açık ~65cm', () => {
    expect(r.rowsConfigured).toBe(25);
    expect(r.stackFits).toBe(false);
    expect(r.rowsTargetMet).toBe(false);
    expect(r.deficitCm).toBeGreaterThan(60);
    expect(r.deficitCm).toBeLessThan(70);
  });

  it('her kaldıraç için öneri listelenir (paylar, eğim, derinlik, flanş, grup rafları)', () => {
    const ids = r.suggestions.map((s) => s.id);
    expect(ids).toContain('margins');
    expect(ids).toContain('tilt');
    expect(ids).toContain('depth');
    expect(ids).toContain('flange');
    expect(ids.some((x) => x.startsWith('rows_'))).toBe(true);
  });

  it('grup-bazlı raf önerisi uygulanınca istif gerçekten sığar', () => {
    const rowSugs = r.suggestions.filter((s) => s.id.startsWith('rows_') && s.groupsPatch);
    expect(rowSugs.length).toBeGreaterThan(0);
    for (const s of rowSugs) {
      const q = computeDerived(applySuggestion(p, s));
      expect(q.fits).toBe(true);
    }
  });

  it('flanş önerisi uygulanınca sığar ve ilaçlar hâlâ flanşa sığar', () => {
    const s = r.suggestions.find((x) => x.id === 'flange');
    expect(s).toBeDefined();
    if (s?.groupsPatch) {
      const q = computeDerived(applySuggestion(p, s));
      expect(q.fits).toBe(true);
      for (const g of s.groupsPatch) {
        if (g.enabled) expect(g.med.h).toBeLessThanOrEqual(g.flangeHeight - 0.005);
      }
    }
  });

  it('derin açıkta (65cm) derinlik kısaltma uygulanamaz (L ilaçtan kısa olamaz) → patch=null', () => {
    const s = r.suggestions.find((x) => x.id === 'depth');
    expect(s).toBeDefined();
    expect(s!.patch).toBeNull();
  });

  it('orta açıkta derinlik önerisi uygulanabilir ve stok düşüşünü sayısal verir', () => {
    const p2 = defaultParams();
    p2.groups = p2.groups.map((g) => ({
      ...g,
      nRows: g.id === 'large' ? 4 : g.id === 'medium' ? 6 : 9,
    }));
    const d2 = computeDerived(p2);
    expect(d2.fits).toBe(false); // ~17 cm açık
    const r2 = solve(p2, d2);
    const s = r2.suggestions.find((x) => x.id === 'depth');
    expect(s).toBeDefined();
    expect(s!.sideEffect).toMatch(/stok/);
    expect(s!.patch).not.toBeNull();
    const q = computeDerived({ ...p2, ...s!.patch });
    expect(q.fits).toBe(true);
    expect(q.totalMeds).toBeLessThan(d2.totalMeds);
    // margins da bu açıkta uygulanabilir olmalı
    const m = r2.suggestions.find((x) => x.id === 'margins');
    expect(m!.patch).not.toBeNull();
  });

  it('eğim önerisi: 25°den aşağı tarama; uygulanırsa sığar', () => {
    const s = r.suggestions.find((x) => x.id === 'tilt');
    expect(s).toBeDefined();
    if (s?.patch && 'tiltDeg' in s.patch) {
      expect(s.patch.tiltDeg!).toBeLessThan(25);
      const q = computeDerived({ ...p, ...s.patch });
      expect(q.fits).toBe(true);
    }
  });

  it('paylar tek başına yetmiyorsa patch=null ile yine listelenir', () => {
    // deficit ~65cm, kısılabilir üst+alt ~56cm → uygulanamaz ama açıklanır
    const s = r.suggestions.find((x) => x.id === 'margins');
    expect(s).toBeDefined();
    expect(s!.patch).toBeNull();
  });
});

describe('solve — sığan senaryo ve ilaç hedefi', () => {
  it('sığan konfigürasyonda raf önerisi üretilmez, durum ✓', () => {
    const p = defaultParams();
    p.groups = p.groups.map((g) => ({ ...g, nRows: g.id === 'large' ? 2 : g.id === 'medium' ? 3 : 4 }));
    p.targetRows = 9;
    const d = computeDerived(p);
    expect(d.fits).toBe(true);
    const r = solve(p, d);
    expect(r.stackFits).toBe(true);
    expect(r.rowsTargetMet).toBe(true);
    expect(r.suggestions.filter((s) => s.id.startsWith('rows_')).length).toBe(0);
  });

  it('ilaç hedefi açığı varsa en verimli gruba raf ekleme önerisi gelir', () => {
    const p = defaultParams();
    p.groups = p.groups.map((g) => ({ ...g, nRows: g.id === 'large' ? 2 : g.id === 'medium' ? 3 : 4 }));
    const d0 = computeDerived(p);
    p.targetMeds = d0.totalMeds + 500;
    const d = computeDerived(p);
    const r = solve(p, d);
    expect(r.medsTargetMet).toBe(false);
    const s = r.suggestions.find((x) => x.id === 'meds_add_rows');
    expect(s).toBeDefined();
    if (s?.groupsPatch) {
      const q = computeDerived({ ...p, groups: s.groupsPatch });
      expect(q.totalMeds).toBeGreaterThanOrEqual(p.targetMeds);
    }
  });
});

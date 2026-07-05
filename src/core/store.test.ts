// store — savunmalı birleştirme + paylaşım linki gidiş-dönüş testleri.
import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, mergeParams } from './store';
import { defaultParams } from './defaults';

describe('mergeParams — savunmalı birleştirme', () => {
  it('null/bozuk girdi → varsayılanlar', () => {
    expect(mergeParams(null)).toEqual(defaultParams());
    expect(mergeParams('çöp')).toEqual(defaultParams());
    expect(mergeParams(42)).toEqual(defaultParams());
  });

  it('geçerli alanlar korunur, bilinmeyen/bozuk alanlar varsayılana düşer', () => {
    const p = mergeParams({
      W: 3.2,
      H: 'bozuk', // sayı değil → varsayılan
      tiltDeg: 22,
      columnMode: 'custom',
      columnWidths: [1.0, 'x', 0.8], // bozuk eleman ayıklanır
      delivery: 'conveyor',
      bilinmeyenAlan: true,
    });
    const base = defaultParams();
    expect(p.W).toBe(3.2);
    expect(p.H).toBe(base.H);
    expect(p.tiltDeg).toBe(22);
    expect(p.columnMode).toBe('custom');
    expect(p.columnWidths).toEqual([1.0, 0.8]);
    expect(p.delivery).toBe('conveyor');
    expect('bilinmeyenAlan' in p).toBe(false);
  });

  it('gruplar: kayıt sırası korunur, eksik grup varsayılandan tamamlanır', () => {
    const p = mergeParams({
      groups: [
        { id: 'small', nRows: 4, med: { w: 0.02 } },
        { id: 'large', flangeHeight: 0.09 },
        { id: 'sahte' }, // bilinmeyen id atlanır
      ],
    });
    expect(p.groups.map((g) => g.id)).toEqual(['small', 'large', 'medium']);
    expect(p.groups[0].nRows).toBe(4);
    expect(p.groups[0].med.w).toBe(0.02);
    expect(p.groups[0].med.h).toBeGreaterThan(0); // eksik med alanı varsayılandan
    expect(p.groups[1].flangeHeight).toBe(0.09);
  });

  it('transitionGapOverride: sayı değilse null (auto)', () => {
    expect(mergeParams({ transitionGapOverride: 0.08 }).transitionGapOverride).toBe(0.08);
    expect(mergeParams({ transitionGapOverride: 'auto' }).transitionGapOverride).toBeNull();
    expect(mergeParams({}).transitionGapOverride).toBeNull();
  });
});

describe('paylaşım linki — encode/decode gidiş-dönüş', () => {
  it('tüm parametreler kayıpsız döner', () => {
    const p = { ...defaultParams(), W: 3.75, tiltDeg: 23.5, columnMode: 'custom' as const };
    const hash = `#p=${encodeShare(p)}`;
    expect(decodeShare(hash)).toEqual(p);
  });

  it('bozuk hash → null', () => {
    expect(decodeShare('#p=!!!bozuk')).toBeNull();
    expect(decodeShare('#baska=1')).toBeNull();
    expect(decodeShare('')).toBeNull();
  });
});

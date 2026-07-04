// Kolon genişliği validasyonları (özel kolon modu).
import { describe, expect, it } from 'vitest';
import { computeDerived } from './geometry';
import { defaultParams } from './defaults';
import { validate } from './validate';

describe('validate — özel kolon genişlikleri', () => {
  it('taşmada COLUMN_WIDTHS_OVERFLOW hatası üretir', () => {
    const p = defaultParams();
    p.columnMode = 'custom';
    p.columnWidths = [2.0, 1.6]; // uW=3.4 → kalan -0.2
    const d = computeDerived(p);
    const diags = validate(p, d);
    expect(diags.some((x) => x.code === 'COLUMN_WIDTHS_OVERFLOW' && x.level === 'error')).toBe(true);
  });

  it('bir kolon bir grubun oluğu için çok darsa COLUMN_TOO_NARROW uyarısı üretir', () => {
    const p = defaultParams();
    p.columnMode = 'custom';
    p.columnWidths = [0.06, 2.0]; // 1. kolon 6cm: Büyük (9.1) ve Orta (7.1) sığmaz, Küçük (5.1) sığar
    const d = computeDerived(p);
    const diags = validate(p, d);
    const narrow = diags.filter((x) => x.code === 'COLUMN_TOO_NARROW');
    expect(narrow.some((x) => x.groupId === 'large')).toBe(true);
    expect(narrow.some((x) => x.groupId === 'medium')).toBe(true);
    expect(narrow.some((x) => x.groupId === 'small')).toBe(false);
  });

  it('geçerli özel genişliklerde kolon hatası yok', () => {
    const p = defaultParams();
    p.columnMode = 'custom';
    p.columnWidths = [1.5, 1.0];
    const d = computeDerived(p);
    const diags = validate(p, d);
    expect(diags.some((x) => x.code === 'COLUMN_WIDTHS_OVERFLOW')).toBe(false);
    expect(diags.some((x) => x.code === 'COLUMN_TOO_NARROW')).toBe(false);
  });
});

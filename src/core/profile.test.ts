// SPEC §2.8 — profil kesiti birim testleri: oluk sayısı, kesit yüksekliği, toplam en, alan.
import { describe, expect, it } from 'vitest';
import { buildProfileShape, expectedSectionArea, polygonArea } from './profile';

const PP = {
  channelInnerWidth: 0.06,
  flangeHeight: 0.06,
  flangeThickness: 0.003,
  baseThickness: 0.004,
};

describe('buildProfileShape', () => {
  it('SPEC §2.4 örneği: inner=6cm, t=0.3cm → xPitch=6.6cm; kolon 113cm → 17 oluk', () => {
    const s = buildProfileShape(PP, 1.13);
    expect(s.xPitch * 100).toBeCloseTo(6.6, 9);
    expect(s.channelCount).toBe(17);
    expect(s.totalWidth * 100).toBeCloseTo(17 * 6.6, 6);
  });

  it('kesit yüksekliği = flanş + taban (6.4cm)', () => {
    const s = buildProfileShape(PP, 1.13);
    expect(s.sectionHeight * 100).toBeCloseTo(6.4, 9);
  });

  it('poligon: her oluk 4 nokta + 4 dış köşe; tüm noktalar kesit kutusunda', () => {
    const s = buildProfileShape(PP, 1.13);
    expect(s.points.length).toBe(4 * s.channelCount + 4);
    for (const pt of s.points) {
      expect(pt.x).toBeGreaterThanOrEqual(-1e-12);
      expect(pt.x).toBeLessThanOrEqual(s.totalWidth + 1e-12);
      expect(pt.y).toBeGreaterThanOrEqual(-1e-12);
      expect(pt.y).toBeLessThanOrEqual(s.sectionHeight + 1e-12);
    }
  });

  it('poligon alanı = analitik malzeme alanı (taban + duvarlar), CCW pozitif', () => {
    const s = buildProfileShape(PP, 1.13);
    const area = polygonArea(s.points);
    expect(area).toBeGreaterThan(0); // CCW
    expect(area).toBeCloseTo(expectedSectionArea(PP, s.channelCount), 12);
  });

  it('kolona hiç oluk sığmıyorsa boş kesit döner', () => {
    const s = buildProfileShape(PP, 0.05);
    expect(s.channelCount).toBe(0);
    expect(s.points.length).toBe(0);
    expect(s.totalWidth).toBe(0);
  });
});

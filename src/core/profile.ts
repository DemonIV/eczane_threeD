// SPEC §2.8 — sigma/U-kanal profil kesiti. Saf 2D nokta listesi üretir (Three.js'siz).
// SceneManager bu poligonu THREE.Shape → ExtrudeGeometry'ye çevirir; SVG önizleme de aynı
// noktaları kullanır. Böylece kesit geometrisi birim-test edilebilir.
import type { GroupParams, ProfileSection, Pt2 } from './types';
import { channelPitchX, sectionHeight } from './geometry';

export interface ProfileShapeParams {
  channelInnerWidth: number; // m
  flangeHeight: number; // m
  flangeThickness: number; // m
  baseThickness: number; // m
}

/**
 * Kolon genişliğine sığan U-oluk kesitini üretir.
 * Kesit: taban levhası + her oluğun iki flanş duvarı (komşu oluklarda duvarlar bitişiktir,
 * bu yüzden xPitch = inner + 2*t — SPEC §2.4 formülüyle birebir).
 *
 * Poligon saat yönü tersine (CCW), origin = kesit sol-alt köşesi, x sağa, y yukarı.
 */
export function buildProfileShape(
  pp: ProfileShapeParams,
  columnWidth: number,
): ProfileSection {
  const xPitch = pp.channelInnerWidth + 2 * pp.flangeThickness;
  const secH = pp.flangeHeight + pp.baseThickness;
  const channelCount =
    xPitch > 0 && columnWidth > 0 ? Math.floor((columnWidth + 1e-9) / xPitch) : 0;
  const totalWidth = channelCount * xPitch;

  const points: Pt2[] = [];
  if (channelCount > 0) {
    const t = pp.flangeThickness;
    const w = pp.channelInnerWidth;
    const base = pp.baseThickness;
    const top = secH;

    // Alt kenar: sol-alt → sağ-alt
    points.push({ x: 0, y: 0 });
    points.push({ x: totalWidth, y: 0 });
    // Sağ dış duvar yukarı
    points.push({ x: totalWidth, y: top });
    // Üst kenar boyunca sağdan sola U-oluklar
    for (let k = channelCount - 1; k >= 0; k--) {
      const xLeftWall = k * xPitch; // oluğun sol duvarının dış kenarı
      const xInnerRight = xLeftWall + t + w; // oluk iç sağ kenar
      const xInnerLeft = xLeftWall + t; // oluk iç sol kenar
      points.push({ x: xInnerRight, y: top }); // sağ duvar iç üst
      points.push({ x: xInnerRight, y: base }); // oluğa in
      points.push({ x: xInnerLeft, y: base }); // oluk tabanı
      points.push({ x: xInnerLeft, y: top }); // sol duvardan çık
    }
    // Sol dış duvar aşağı (kapanış: ilk noktaya döner)
    points.push({ x: 0, y: top });
  }

  return { points, sectionHeight: secH, xPitch, channelCount, totalWidth };
}

/** GroupParams'tan kesit üretimi (kolaylık sarmalayıcı). */
export function buildGroupSection(g: GroupParams, columnWidth: number): ProfileSection {
  return buildProfileShape(
    {
      channelInnerWidth: g.channelInnerWidth,
      flangeHeight: g.flangeHeight,
      flangeThickness: g.flangeThickness,
      baseThickness: g.baseThickness,
    },
    columnWidth,
  );
}

// Doğrulama yardımcıları (testler + tutarlılık kontrolleri için):
export { channelPitchX, sectionHeight };

/** Poligonun imzalı alanı (m²) — CCW ise pozitif. Test/doğrulama için. */
export function polygonArea(points: Pt2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Kesitin beklenen malzeme alanı: taban levhası + duvarlar (analitik, alan testine referans). */
export function expectedSectionArea(pp: ProfileShapeParams, channelCount: number): number {
  const xPitch = pp.channelInnerWidth + 2 * pp.flangeThickness;
  const totalWidth = channelCount * xPitch;
  const baseArea = totalWidth * pp.baseThickness;
  const wallArea = channelCount * 2 * pp.flangeThickness * pp.flangeHeight;
  return baseArea + wallArea;
}

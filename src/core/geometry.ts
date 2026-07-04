// SPEC §2 — saf geometri/fizik fonksiyonları. Three.js'e BAĞIMLI DEĞİL (SPEC §3.2).
import type {
  CabinetParams,
  Derived,
  GroupDerived,
  GroupParams,
  ShelfPlacement,
} from './types';

export const degToRad = (deg: number): number => (deg * Math.PI) / 180;
export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

const EPS = 1e-9;

/** Kanal boyu: L = D - robot_depth_clearance (SPEC §2.6) */
export function channelLength(p: Pick<CabinetParams, 'D' | 'robotDepthClearance'>): number {
  return p.D - p.robotDepthClearance;
}

/** usable_height = H - top_margin - bottom_margin - top_service_cut (SPEC §2.3) */
export function usableHeight(
  p: Pick<CabinetParams, 'H' | 'topMargin' | 'bottomMargin' | 'topServiceCut'>,
): number {
  return p.H - p.topMargin - p.bottomMargin - p.topServiceCut;
}

/** Profil kesit yüksekliği = flanş + taban levhası (taban MUTLAKA sayılır — SPEC §2.2 NOT). */
export function sectionHeight(g: Pick<GroupParams, 'flangeHeight' | 'baseThickness'>): number {
  return g.flangeHeight + g.baseThickness;
}

/** Nested dikey adım: pitch = sectionHeight / cosα (SPEC §2.2) */
export function nestedPitch(section: number, tiltRad: number): number {
  return section / Math.cos(tiltRad);
}

/** Arka yükseliş: rise = L * sinα (SPEC §2.1) */
export function backRise(L: number, tiltRad: number): number {
  return L * Math.sin(tiltRad);
}

/** Yatay kanal adımı: xPitch = inner + 2*flanş kalınlığı (SPEC §2.4) */
export function channelPitchX(
  g: Pick<GroupParams, 'channelInnerWidth' | 'flangeThickness'>,
): number {
  return g.channelInnerWidth + 2 * g.flangeThickness;
}

/** Homojen (tek profil) maksimum raf: N_max = floor((usableH - rise)/pitch) + 1 (SPEC §2.3) */
export function maxRowsHomogeneous(usableH: number, rise: number, pitch: number): number {
  if (pitch <= 0) return 0;
  const n = Math.floor((usableH - rise + EPS) / pitch) + 1;
  return Math.max(0, n);
}

/** Homojen istif yüksekliği: (N-1)*pitch + rise (SPEC §2.3) */
export function stackHeightHomogeneous(nRows: number, pitch: number, rise: number): number {
  if (nRows <= 0) return 0;
  return (nRows - 1) * pitch + rise;
}

/**
 * Auto geçiş payı (SPEC §2.3): aktif gruplar arasında sabit güvenli pay
 * = max(sectionHeight) / cosα. (Test vektörleri bu sadeleştirmeyle doğrulanmıştır.)
 */
export function autoTransitionGap(groups: GroupParams[], tiltRad: number): number {
  const enabled = groups.filter((g) => g.enabled && g.nRows > 0);
  if (enabled.length === 0) return 0;
  const maxSection = Math.max(...enabled.map((g) => sectionHeight(g)));
  return maxSection / Math.cos(tiltRad);
}

/** Tüm türetilmiş değerleri tek geçişte hesaplar. UI/scene yalnızca bunu çağırır. */
export function computeDerived(p: CabinetParams): Derived {
  const tilt = degToRad(p.tiltDeg);
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);
  const L = channelLength(p);
  const rise = backRise(L, tilt);
  const uH = usableHeight(p);
  const uW = p.W - 2 * p.sideMargin;
  const colW = p.nColumns > 0 ? uW / p.nColumns : 0;
  const gap =
    p.transitionGapOverride !== null && p.transitionGapOverride >= 0
      ? p.transitionGapOverride
      : autoTransitionGap(p.groups, tilt);

  const groups: GroupDerived[] = p.groups.map((g) => {
    const sec = sectionHeight(g);
    const pitch = nestedPitch(sec, tilt);
    const xPitch = channelPitchX(g);
    const active = g.enabled && g.nRows > 0;
    const channelsPerRow = active && xPitch > 0 && colW > 0 ? Math.floor(colW / xPitch) : 0;
    const medsPerChannel = active && g.med.len > 0 ? Math.floor((L + EPS) / g.med.len) : 0;
    const channels = active ? g.nRows * channelsPerRow * p.nColumns : 0;
    const meds = channels * medsPerChannel;
    return {
      id: g.id,
      label: g.label,
      enabled: g.enabled,
      nRows: g.nRows,
      sectionHeight: sec,
      pitch,
      xPitch,
      channelsPerRow,
      medsPerChannel,
      channels,
      meds,
      stackShare: active ? g.nRows * pitch : 0,
    };
  });

  const activeGroups = groups.filter((g) => g.enabled && g.nRows > 0);
  const nActive = activeGroups.length;
  const totalRows = activeGroups.reduce((s, g) => s + g.nRows, 0);
  const totalChannels = activeGroups.reduce((s, g) => s + g.channels, 0);
  const totalMeds = activeGroups.reduce((s, g) => s + g.meds, 0);

  // SPEC §2.3: çok-gruplu istifte sadeleştirilmiş güvenli üst-sınır
  //   stack ≈ Σ n_g*pitch_g + rise + (n_groups-1)*transition_gap
  // Tek-grup özel durumu §2.2 kesin formülüne indirgenir: (N-1)*pitch + rise
  // (N_max = floor((uH-rise)/pitch)+1 test vektörleriyle tutarlılık için şart).
  const stackHeight =
    nActive === 0
      ? 0
      : nActive === 1
        ? stackHeightHomogeneous(activeGroups[0].nRows, activeGroups[0].pitch, rise)
        : activeGroups.reduce((s, g) => s + g.stackShare, 0) + rise + (nActive - 1) * gap;

  // Fiziksel yerleşim (render + tavan kontrolü): raf ön uçları alttan üste birikir.
  const shelves: ShelfPlacement[] = [];
  let y = p.bottomMargin;
  let lastFrontY = p.bottomMargin;
  let placedGroups = 0;
  p.groups.forEach((g, gi) => {
    if (!g.enabled || g.nRows <= 0) return;
    const gd = groups[gi];
    if (placedGroups > 0) y += gap; // grup sınırı geçişi
    for (let r = 0; r < g.nRows; r++) {
      shelves.push({ groupIndex: gi, groupId: g.id, rowIndex: r, frontY: y });
      lastFrontY = y;
      y += gd.pitch;
    }
    placedGroups++;
  });
  const stackHeightExact =
    shelves.length === 0 ? 0 : lastFrontY + rise - p.bottomMargin;

  const fits = stackHeight <= uH + EPS;
  const deficit = fits ? 0 : stackHeight - uH;

  // SPEC §2.6: en üst rafın arka ucu tavanı (servis payı dahil) delmemeli.
  const ceilingLimit = p.H - p.topMargin - p.topServiceCut;
  const topRowBackY = shelves.length === 0 ? 0 : lastFrontY + rise;
  const ceilingViolation = topRowBackY > ceilingLimit + EPS;

  return {
    L,
    rise,
    usableHeight: uH,
    usableWidth: uW,
    columnWidth: colW,
    transitionGap: gap,
    cosTilt: cosT,
    sinTilt: sinT,
    groups,
    totalRows,
    totalChannels,
    totalMeds,
    stackHeight,
    stackHeightExact,
    fits,
    deficit,
    shelves,
    topRowBackY,
    ceilingLimit,
    ceilingViolation,
  };
}

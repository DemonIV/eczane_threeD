// SPEC §6 — ilk açılış varsayılanları (müşteri örneği).
import type { CabinetParams, GroupParams } from './types';

export function defaultGroups(): GroupParams[] {
  // Dizi sırası = alttan üste: Büyük (alt, stabilite) → Orta → Küçük (üst).
  return [
    {
      id: 'large',
      label: 'Büyük',
      enabled: true,
      channelInnerWidth: 0.085,
      flangeHeight: 0.085,
      flangeThickness: 0.003,
      baseThickness: 0.004,
      nRows: 6,
      med: { w: 0.07, h: 0.07, len: 0.16 },
      color: 0xe07a5f,
    },
    {
      id: 'medium',
      label: 'Orta',
      enabled: true,
      channelInnerWidth: 0.065,
      flangeHeight: 0.065,
      flangeThickness: 0.003,
      baseThickness: 0.004,
      nRows: 9,
      med: { w: 0.05, h: 0.05, len: 0.12 },
      color: 0x3d9970,
    },
    {
      id: 'small',
      label: 'Küçük',
      enabled: true,
      channelInnerWidth: 0.045,
      flangeHeight: 0.045,
      flangeThickness: 0.003,
      baseThickness: 0.004,
      nRows: 10,
      med: { w: 0.03, h: 0.03, len: 0.1 },
      color: 0x4a7fb5,
    },
  ];
}

export function defaultParams(): CabinetParams {
  return {
    W: 4.0,
    H: 2.5,
    D: 1.25,
    nColumns: 3,
    topMargin: 0.3,
    bottomMargin: 0.3,
    sideMargin: 0.3,
    robotDepthClearance: 0.1,
    topServiceCut: 0.05,
    tiltDeg: 25,
    groups: defaultGroups(),
    transitionGapOverride: null, // auto = maxSection/cosα
    delivery: 'side_bin',
    robotSpeed: 1.2,
    targetRows: 25, // 6+9+10 — açılışta çözücü sığmadığını gösterir (SPEC test vektörü)
    targetMeds: 1500,
  };
}

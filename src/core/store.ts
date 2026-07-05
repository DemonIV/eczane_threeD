// Kalıcılık + paylaşım: params ↔ localStorage / URL hash.
// Kayıtlı veri her zaman defaults üzerine SAVUNMALI birleştirilir — eski sürüm kayıtları
// veya bozuk hash yeni alan eklendiğinde uygulamayı kırmasın.
import { defaultParams } from './defaults';
import type { CabinetParams, GroupParams, MedSize } from './types';

const LS_KEY = 'eczane.params.v1';

const num = (v: unknown, fb: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fb;
const bool = (v: unknown, fb: boolean): boolean => (typeof v === 'boolean' ? v : fb);
const str = (v: unknown, fb: string): string => (typeof v === 'string' ? v : fb);

function mergeMed(raw: unknown, fb: MedSize): MedSize {
  if (typeof raw !== 'object' || raw === null) return { ...fb };
  const r = raw as Record<string, unknown>;
  return { w: num(r.w, fb.w), h: num(r.h, fb.h), len: num(r.len, fb.len) };
}

function mergeGroups(raw: unknown, base: GroupParams[]): GroupParams[] {
  if (!Array.isArray(raw)) return base;
  const byId = new Map(base.map((g) => [g.id, g]));
  const out: GroupParams[] = [];
  // Kayıttaki sıra korunur (dizi sırası = fiziksel yerleşim); bilinmeyen id atlanır.
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    const fb = byId.get(r.id as GroupParams['id']);
    if (!fb) continue;
    byId.delete(fb.id);
    out.push({
      id: fb.id,
      label: str(r.label, fb.label),
      enabled: bool(r.enabled, fb.enabled),
      channelInnerWidth: num(r.channelInnerWidth, fb.channelInnerWidth),
      flangeHeight: num(r.flangeHeight, fb.flangeHeight),
      flangeThickness: num(r.flangeThickness, fb.flangeThickness),
      baseThickness: num(r.baseThickness, fb.baseThickness),
      nRows: num(r.nRows, fb.nRows),
      med: mergeMed(r.med, fb.med),
      color: num(r.color, fb.color),
    });
  }
  // Kayıtta bulunmayan gruplar (eski sürüm) varsayılan hâlleriyle sona eklenir.
  for (const g of base) if (byId.has(g.id)) out.push(g);
  return out.length > 0 ? out : base;
}

/** Ham (JSON.parse edilmiş) veriyi geçerli CabinetParams'a dönüştürür. */
export function mergeParams(raw: unknown): CabinetParams {
  const base = defaultParams();
  if (typeof raw !== 'object' || raw === null) return base;
  const r = raw as Record<string, unknown>;
  return {
    W: num(r.W, base.W),
    H: num(r.H, base.H),
    D: num(r.D, base.D),
    nColumns: num(r.nColumns, base.nColumns),
    columnMode: r.columnMode === 'custom' ? 'custom' : 'equal',
    columnWidths: Array.isArray(r.columnWidths)
      ? r.columnWidths.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
      : base.columnWidths,
    topMargin: num(r.topMargin, base.topMargin),
    bottomMargin: num(r.bottomMargin, base.bottomMargin),
    sideMargin: num(r.sideMargin, base.sideMargin),
    robotDepthClearance: num(r.robotDepthClearance, base.robotDepthClearance),
    topServiceCut: num(r.topServiceCut, base.topServiceCut),
    tiltDeg: num(r.tiltDeg, base.tiltDeg),
    groups: mergeGroups(r.groups, base.groups),
    transitionGapOverride:
      typeof r.transitionGapOverride === 'number' && Number.isFinite(r.transitionGapOverride)
        ? r.transitionGapOverride
        : null,
    delivery: r.delivery === 'conveyor' ? 'conveyor' : 'side_bin',
    robotSpeed: num(r.robotSpeed, base.robotSpeed),
    targetRows: num(r.targetRows, base.targetRows),
    targetMeds: num(r.targetMeds, base.targetMeds),
  };
}

// ---- localStorage (otomatik kayıt) ----

export function saveLocal(p: CabinetParams): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    // depolama kapalı/dolu — otomatik kayıt sessizce atlanır
  }
}

export function loadLocal(): CabinetParams | null {
  try {
    const s = localStorage.getItem(LS_KEY);
    return s ? mergeParams(JSON.parse(s)) : null;
  } catch {
    return null;
  }
}

// ---- URL hash paylaşımı (#p=<base64url(JSON)>) ----

export function encodeShare(p: CabinetParams): string {
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeShare(hash: string): CabinetParams | null {
  const m = hash.match(/p=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return mergeParams(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

// SPEC §2 doğrulama katmanı — fizik ihlali tespiti + insan-okur uyarılar (TR).
import type { CabinetParams, Derived, Diagnostic } from './types';

/** İlaç-kanal sığma toleransı (m): kutu, oluktan bu kadar küçük olmalı. */
export const FIT_TOLERANCE = 0.005;

/** Gravity-feed için tipik eğim aralığı (SPEC §1): altında sürtünme, üstünde arka baskı. */
export const TILT_MIN_DEG = 20;
export const TILT_MAX_DEG = 30;

const cm = (m: number): string => (m * 100).toFixed(1);

export function validate(p: CabinetParams, d: Derived): Diagnostic[] {
  const out: Diagnostic[] = [];

  // --- Temel geometri sağlığı ---
  if (d.L <= 0) {
    out.push({
      level: 'error',
      code: 'L_NONPOSITIVE',
      message: `Kanal boyu L = D − robot payı = ${cm(d.L)} cm ≤ 0. Derinliği artırın veya robot payını azaltın.`,
    });
  }
  if (d.usableHeight <= 0) {
    out.push({
      level: 'error',
      code: 'USABLE_H_NONPOSITIVE',
      message: `Kullanılabilir yükseklik ${cm(d.usableHeight)} cm ≤ 0. Üst/alt payları veya servis payını azaltın.`,
    });
  }
  if (d.usableWidth <= 0 || d.columnWidth <= 0) {
    out.push({
      level: 'error',
      code: 'USABLE_W_NONPOSITIVE',
      message: `Kullanılabilir genişlik ${cm(d.usableWidth)} cm ≤ 0. Yan payları azaltın.`,
    });
  }

  // --- İstif sığma (SPEC §2.3) ---
  if (d.totalRows > 0) {
    if (!d.fits) {
      out.push({
        level: 'error',
        code: 'STACK_OVERFLOW',
        message:
          `${d.totalRows} raflık istif ${cm(d.stackHeight)} cm ister; mevcut ${cm(d.usableHeight)} cm. ` +
          `Eksik: ${cm(d.deficit)} cm. Çözücü önerilerine bakın.`,
      });
    } else {
      out.push({
        level: 'ok',
        code: 'STACK_OK',
        message: `${d.totalRows} raf sığıyor: istif ${cm(d.stackHeight)} cm ≤ kullanılabilir ${cm(d.usableHeight)} cm.`,
      });
    }
  }

  // --- En-üst-raf-tavan kontrolü (SPEC §2.6) ---
  if (d.ceilingViolation) {
    out.push({
      level: 'error',
      code: 'TOP_ROW_CEILING',
      message:
        `En üst rafın arka ucu tavanı deliyor: arka uç ${cm(d.topRowBackY)} cm, ` +
        `izinli tavan ${cm(d.ceilingLimit)} cm (üst pay + servis kesimi düşülmüş).`,
    });
  }

  // --- Eğim aralığı (gravity feed) ---
  if (p.tiltDeg < TILT_MIN_DEG) {
    out.push({
      level: 'warn',
      code: 'TILT_LOW',
      message: `Eğim ${p.tiltDeg.toFixed(1)}° < ${TILT_MIN_DEG}°: sürtünme beslemeyi durdurabilir (kutular öne kaymaz).`,
    });
  } else if (p.tiltDeg > TILT_MAX_DEG) {
    out.push({
      level: 'warn',
      code: 'TILT_HIGH',
      message: `Eğim ${p.tiltDeg.toFixed(1)}° > ${TILT_MAX_DEG}°: arka baskı kuvveti mandalı zorlar.`,
    });
  }

  // --- Grup başına ilaç sığma (SPEC §2.9) ---
  for (const g of p.groups) {
    if (!g.enabled || g.nRows <= 0) continue;
    const gd = d.groups[p.groups.indexOf(g)];
    if (g.med.w > g.channelInnerWidth - FIT_TOLERANCE) {
      out.push({
        level: 'error',
        code: 'MED_TOO_WIDE',
        groupId: g.id,
        message:
          `${g.label}: ilaç eni ${cm(g.med.w)} cm, oluk içi ${cm(g.channelInnerWidth)} cm ` +
          `(tolerans ${cm(FIT_TOLERANCE)} cm) — sığmıyor.`,
      });
    }
    if (g.med.h > g.flangeHeight - FIT_TOLERANCE) {
      out.push({
        level: 'error',
        code: 'MED_TOO_TALL',
        groupId: g.id,
        message:
          `${g.label}: ilaç yüksekliği ${cm(g.med.h)} cm, flanş ${cm(g.flangeHeight)} cm ` +
          `(tolerans ${cm(FIT_TOLERANCE)} cm) — üstteki iç içe rafa çarpar.`,
      });
    }
    if (g.med.len > d.L) {
      out.push({
        level: 'error',
        code: 'MED_TOO_LONG',
        groupId: g.id,
        message: `${g.label}: ilaç boyu ${cm(g.med.len)} cm > kanal boyu ${cm(d.L)} cm.`,
      });
    }
    if (gd.channelsPerRow < 1) {
      out.push({
        level: 'error',
        code: 'NO_CHANNEL_FITS',
        groupId: g.id,
        message:
          `${g.label}: kolon genişliği ${cm(d.columnWidth)} cm, tek oluk adımı ${cm(gd.xPitch)} cm — ` +
          `hiç kanal sığmıyor.`,
      });
    }
  }

  if (d.totalRows === 0) {
    out.push({
      level: 'warn',
      code: 'NO_ACTIVE_GROUPS',
      message: 'Hiç aktif raf grubu yok — en az bir grubu etkinleştirin.',
    });
  }

  return out;
}

export function hasError(diags: Diagnostic[]): boolean {
  return diags.some((x) => x.level === 'error');
}

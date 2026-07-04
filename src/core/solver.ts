// SPEC §4 — hedef-çözücü: "N raf / M ilaç için ne değişmeli?"
// Sığmayan senaryoda her serbest kaldıraç için TEK-değişkenli sayısal düzeltme + yan etki üretir.
import { computeDerived } from './geometry';
import type { CabinetParams, Derived, GroupParams, Suggestion, SolverReport } from './types';

const cm = (m: number): string => (m * 100).toFixed(1);
const pct = (x: number): string => `${x >= 0 ? '−' : '+'}${Math.abs(x).toFixed(0)}%`;

function withGroups(p: CabinetParams, groups: GroupParams[]): CabinetParams {
  return { ...p, groups };
}

/** Bir yamanın gerçekten sığdırıp sığdırmadığını kontrol eder (öneriler doğrulanmış çıkar). */
function patchFits(p: CabinetParams, patch: Partial<CabinetParams>, groups?: GroupParams[]): boolean {
  const q: CabinetParams = { ...p, ...patch, groups: groups ?? p.groups };
  return computeDerived(q).fits;
}

export function solve(p: CabinetParams, d: Derived): SolverReport {
  const suggestions: Suggestion[] = [];
  const deficit = d.deficit; // m

  if (deficit > 0 && d.totalRows > 0) {
    // ---- 1) Üst/alt payları kısmak: usable_height doğrudan artar ----
    {
      const reducible = Math.max(0, p.topMargin - 0.02) + Math.max(0, p.bottomMargin - 0.02);
      if (reducible >= deficit) {
        // önce alttan, kalanı üstten kırp (2 cm minimum bırak)
        const fromBottom = Math.min(deficit, Math.max(0, p.bottomMargin - 0.02));
        const fromTop = deficit - fromBottom;
        const patch: Partial<CabinetParams> = {
          bottomMargin: p.bottomMargin - fromBottom,
          topMargin: p.topMargin - fromTop,
        };
        suggestions.push({
          id: 'margins',
          label: `Üst/alt payları toplam ${cm(deficit)} cm azalt`,
          detail:
            `Alt pay ${cm(p.bottomMargin)}→${cm(patch.bottomMargin!)} cm, ` +
            `üst pay ${cm(p.topMargin)}→${cm(patch.topMargin!)} cm.`,
          sideEffect: 'Servis/montaj erişim payı daralır; kapasite değişmez.',
          patch: patchFits(p, patch) ? patch : null,
        });
      } else {
        suggestions.push({
          id: 'margins',
          label: `Paylar yetersiz: ${cm(deficit)} cm gerek, kısılabilir ${cm(reducible)} cm var`,
          detail: 'Üst+alt paylardan en fazla bu kadar kırpılabilir (2 cm minimum bırakılır).',
          sideEffect: 'Tek başına bu kaldıraç hedefe yetmez.',
          patch: null,
        });
      }
    }

    // ---- 2) Eğimi düşürmek: pitch VE rise birlikte küçülür (sayısal tarama) ----
    {
      let found: number | null = null;
      for (let a = p.tiltDeg; a >= 5; a -= 0.1) {
        const q = { ...p, tiltDeg: a };
        if (computeDerived(q).fits) {
          found = Math.round(a * 10) / 10;
          break;
        }
      }
      if (found !== null && found < p.tiltDeg) {
        suggestions.push({
          id: 'tilt',
          label: `Eğimi ${p.tiltDeg.toFixed(1)}°→${found.toFixed(1)}° düşür`,
          detail: `α=${found.toFixed(1)}°'de istif kullanılabilir yüksekliğe sığar (pitch ve arka yükseliş birlikte azalır).`,
          sideEffect:
            found < 20
              ? `DİKKAT: ${found.toFixed(1)}° < 20° — sürtünme gravity-feed'i durdurabilir.`
              : 'Kayma hızı azalır; 20° üstünde kaldığı için besleme güvenli.',
          patch: { tiltDeg: found },
        });
      } else {
        suggestions.push({
          id: 'tilt',
          label: 'Eğim düşürmek tek başına yetmiyor',
          detail: '5°ye kadar taramada istif sığmadı.',
          sideEffect: '—',
          patch: null,
        });
      }
    }

    // ---- 3) Kanal boyunu (L) kısaltmak: rise = L·sinα azalır ----
    {
      const sinT = d.sinTilt;
      if (sinT > 1e-6) {
        const newL = d.L - deficit / sinT;
        const maxMedLen = Math.max(
          0,
          ...p.groups.filter((g) => g.enabled && g.nRows > 0).map((g) => g.med.len),
        );
        if (newL >= maxMedLen && newL > 0) {
          const newD = newL + p.robotDepthClearance;
          const patch: Partial<CabinetParams> = { D: newD };
          const q = computeDerived({ ...p, ...patch });
          const medsDelta = d.totalMeds > 0 ? ((q.totalMeds - d.totalMeds) / d.totalMeds) * 100 : 0;
          suggestions.push({
            id: 'depth',
            label: `Kanal boyunu ${cm(d.L)}→${cm(newL)} cm kısalt (D=${cm(newD)} cm)`,
            detail: `Arka yükseliş ${cm(d.rise)}→${cm(newL * sinT)} cm olur; istif sığar.`,
            sideEffect: `İlaç/kanal düşer → toplam stok ${d.totalMeds}→${q.totalMeds} (${pct(-medsDelta)}).`,
            patch: q.fits ? patch : null,
          });
        } else {
          suggestions.push({
            id: 'depth',
            label: 'Kanal boyu kısaltma tek başına yetmiyor',
            detail: `Gerekli L=${cm(newL)} cm, en uzun ilaç ${cm(maxMedLen)} cm — kanal ilaçtan kısa olamaz.`,
            sideEffect: '—',
            patch: null,
          });
        }
      }
    }

    // ---- 4) Flanş yüksekliklerini azaltmak: pitch_g ∝ sectionHeight_g ----
    {
      const active = p.groups.filter((g) => g.enabled && g.nRows > 0);
      const totalN = active.reduce((s, g) => s + g.nRows, 0);
      if (totalN > 0) {
        // Σ n_g·Δ/cosα = deficit → Δ = deficit·cosα/Σn (tüm gruplarda eşit kısma; geçiş payı da azalır → güvenli taraf)
        const delta = (deficit * d.cosTilt) / totalN;
        const groups = p.groups.map((g) =>
          g.enabled && g.nRows > 0 ? { ...g, flangeHeight: g.flangeHeight - delta } : g,
        );
        const medOk = groups.every(
          (g) => !g.enabled || g.nRows <= 0 || g.med.h <= g.flangeHeight - 0.005,
        );
        const fits = patchFits(p, {}, groups);
        suggestions.push({
          id: 'flange',
          label: `Tüm flanş yüksekliklerini ${cm(delta)} cm azalt`,
          detail: active
            .map((g) => `${g.label}: ${cm(g.flangeHeight)}→${cm(g.flangeHeight - delta)} cm`)
            .join(' · '),
          sideEffect: medOk
            ? 'Maksimum ilaç yüksekliği azalır; mevcut ilaçlar hâlâ sığıyor.'
            : 'DİKKAT: bu kısma sonrası bazı grupların ilacı flanşa sığmaz!',
          patch: fits && medOk ? {} : null,
          groupsPatch: fits && medOk ? groups : undefined,
        });
      }
    }

    // ---- 5) Grup bazında raf çıkarmak (SPEC test-vektörü dersi: "Büyük gruptan raf çıkar") ----
    // Her grup için sığdıran EN KÜÇÜK çıkarma sayısı doğrudan aranır (grup tamamen
    // boşalırsa geçiş payı da düşer — computeDerived bunu otomatik hesaplar).
    for (const g of p.groups) {
      if (!g.enabled || g.nRows <= 0) continue;
      const gd = d.groups[p.groups.indexOf(g)];
      let applied: { k: number; groups: GroupParams[]; meds: number } | null = null;
      for (let k = 1; k <= g.nRows; k++) {
        const groups = p.groups.map((x) => (x.id === g.id ? { ...x, nRows: x.nRows - k } : x));
        const q = computeDerived(withGroups(p, groups));
        if (q.fits) {
          applied = { k, groups, meds: q.totalMeds };
          break;
        }
      }
      if (applied) {
        const { k, groups, meds } = applied;
        suggestions.push({
          id: `rows_${g.id}`,
          label:
            k === g.nRows
              ? `${g.label} grubunu tamamen kaldır (${g.nRows}→0 raf)`
              : `${g.label} grubunu ${g.nRows}→${g.nRows - k} rafa indir`,
          detail: `Bu gruptan ${k} raf çıkmak istifi ~${cm(k * gd.pitch)} cm kısaltır (pitch ${cm(gd.pitch)} cm).`,
          sideEffect: `−${k * gd.rowChannels} kanal, −${
            k * gd.rowChannels * gd.medsPerChannel
          } ilaç (toplam ${d.totalMeds}→${meds}).`,
          patch: {},
          groupsPatch: groups,
        });
      } else {
        suggestions.push({
          id: `rows_${g.id}`,
          label: `${g.label} grubunu azaltmak tek başına yetmiyor`,
          detail: `Grup tamamen kaldırılsa bile istif sığmıyor.`,
          sideEffect: '—',
          patch: null,
        });
      }
    }
  }

  // ---- İlaç hedefi ----
  const medsDeficit = Math.max(0, p.targetMeds - d.totalMeds);
  if (medsDeficit > 0 && d.fits) {
    // En verimli grup (ilaç/raf) ile kaç ek raf gerekir; dikeyde sığıyor mu?
    let best: { g: GroupParams; perRow: number } | null = null;
    for (const g of p.groups) {
      if (!g.enabled || g.nRows <= 0) continue;
      const gd = d.groups[p.groups.indexOf(g)];
      const perRow = gd.rowChannels * gd.medsPerChannel;
      if (perRow > 0 && (best === null || perRow > best.perRow)) best = { g, perRow };
    }
    if (best) {
      const need = Math.ceil(medsDeficit / best.perRow);
      const groups = p.groups.map((x) =>
        x.id === best!.g.id ? { ...x, nRows: x.nRows + need } : x,
      );
      const q = computeDerived(withGroups(p, groups));
      suggestions.push({
        id: 'meds_add_rows',
        label: `İlaç hedefi için ${best.g.label} grubuna +${need} raf`,
        detail: `${best.g.label} rafı başına ${best.perRow} ilaç → +${need * best.perRow} ilaç (hedef açığı ${medsDeficit}).`,
        sideEffect: q.fits
          ? `İstif ${cm(q.stackHeight)} cm olur, hâlâ sığar.`
          : `DİKKAT: eklenince istif ${cm(q.stackHeight)} cm olur — ${cm(q.stackHeight - q.usableHeight)} cm taşar.`,
        patch: q.fits ? {} : null,
        groupsPatch: q.fits ? groups : undefined,
      });
    }
  }

  return {
    rowsConfigured: d.totalRows,
    rowsTarget: p.targetRows,
    rowsTargetMet: d.fits && d.totalRows >= p.targetRows,
    stackFits: d.fits,
    deficitCm: d.deficit * 100,
    medsCurrent: d.totalMeds,
    medsTarget: p.targetMeds,
    medsTargetMet: d.totalMeds >= p.targetMeds,
    medsDeficit,
    suggestions,
  };
}

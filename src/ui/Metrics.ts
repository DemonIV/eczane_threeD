// SPEC §5 — canlı metrikler: sığan raf, kanal (SKU), ilaç, pitch, rise, tavan kontrolü.
// Fizik ihlalinde ilgili chip kırmızı + tooltip'te neden.
import type { CabinetParams, Derived, Diagnostic } from '../core/types';

const cm = (m: number): string => (m * 100).toFixed(1).replace(/\.0$/, '');
const int = (n: number): string => n.toLocaleString('tr-TR');

interface Chip {
  label: string;
  value: string;
  bad?: boolean;
  warn?: boolean;
  title?: string;
}

export class Metrics {
  constructor(private el: HTMLElement) {}

  render(p: CabinetParams, d: Derived, diags: Diagnostic[]): void {
    const has = (code: string): Diagnostic | undefined => diags.find((x) => x.code === code);
    const overflow = has('STACK_OVERFLOW');
    const ceiling = has('TOP_ROW_CEILING');
    const tiltDiag = has('TILT_LOW') ?? has('TILT_HIGH');
    const medErr = diags.find((x) => x.code.startsWith('MED_') || x.code === 'NO_CHANNEL_FITS');

    const chips: Chip[] = [
      {
        label: 'Raf',
        value: `${d.totalRows}${d.fits ? ' ✓' : ' ✗'}`,
        bad: !d.fits,
        title: overflow?.message ?? `${d.totalRows} raf kullanılabilir yüksekliğe sığıyor.`,
      },
      {
        label: 'İstif',
        value: `${cm(d.stackHeight)}/${cm(d.usableHeight)} cm`,
        bad: !d.fits,
        title: 'Gerekli istif yüksekliği / kullanılabilir yükseklik (SPEC §2.3)',
      },
      { label: 'SKU (kanal)', value: int(d.totalChannels), title: 'Toplam kanal = ilaç çeşidi kapasitesi' },
      { label: 'İlaç', value: int(d.totalMeds), title: 'Toplam fiziksel stok' },
      {
        label: 'Kanal boyu L',
        value: `${cm(d.L)} cm`,
        title: `L = D − robot payı (${cm(p.robotDepthClearance)} cm)`,
      },
      {
        label: 'Arka yükseliş',
        value: `${cm(d.rise)} cm`,
        title: 'rise = L·sin α — eğimli kanalın dikey izdüşümü (SPEC §2.1)',
      },
      {
        label: 'Pitch',
        value: d.groups
          .filter((g) => g.enabled && g.nRows > 0)
          .map((g) => `${g.label[0]}:${cm(g.pitch)}`)
          .join(' '),
        title: 'Nested dikey adım (grup başına) = kesit/cos α — cm',
      },
      {
        label: 'Geçiş payı',
        value: `${cm(d.transitionGap)} cm`,
        title:
          p.transitionGapOverride === null
            ? 'Auto = maxKesit/cos α (SPEC §2.3). Grup sınırı başına kayıp.'
            : 'Kullanıcı override',
      },
      {
        label: 'Tavan',
        value: d.ceilingViolation ? '✗ deliyor' : '✓',
        bad: d.ceilingViolation,
        title:
          ceiling?.message ??
          `En üst raf arka ucu ${cm(d.topRowBackY)} cm ≤ izinli ${cm(d.ceilingLimit)} cm (SPEC §2.6)`,
      },
      {
        label: 'Eğim',
        value: `${p.tiltDeg.toFixed(1)}°`,
        warn: !!tiltDiag,
        title: tiltDiag?.message ?? 'Gravity-feed güvenli aralık: 20–30°',
      },
    ];
    if (p.columnMode === 'custom' && p.nColumns > 1) {
      const overflow2 = has('COLUMN_WIDTHS_OVERFLOW');
      chips.push({
        label: 'Kolonlar',
        value: d.columnWidths.map((w) => (w * 100).toFixed(0)).join('/') + ' cm',
        bad: !!overflow2,
        title: overflow2?.message ?? 'Özel kolon genişlikleri (son kolon = kalan)',
      });
    }
    if (medErr) {
      chips.push({ label: 'İlaç sığma', value: '✗', bad: true, title: medErr.message });
    }

    this.el.innerHTML = '';
    for (const c of chips) {
      const div = document.createElement('div');
      div.className = 'chip' + (c.bad ? ' chip-bad' : c.warn ? ' chip-warn' : '');
      if (c.title) div.title = c.title;
      div.innerHTML = `<span class="chip-label">${c.label}</span><span class="chip-value">${c.value}</span>`;
      this.el.appendChild(div);
    }

    // grup kırılımı satırı (SPEC §2.9: toplam + kırılım)
    const bk = document.createElement('div');
    bk.className = 'chip chip-breakdown';
    bk.title = 'Grup kırılımı: kanal (SKU) / ilaç';
    bk.innerHTML = d.groups
      .filter((g) => g.enabled && g.nRows > 0)
      .map((g) => `<span class="chip-label">${g.label}</span><span class="chip-value">${int(g.channels)}k/${int(g.meds)}i</span>`)
      .join(' · ');
    this.el.appendChild(bk);
  }
}

/** Üst bar durum rozetini günceller (✓ sığıyor / ✗ Xcm eksik). */
export function renderStatusChip(el: HTMLElement, d: Derived): void {
  if (d.totalRows === 0) {
    el.className = 'status warn';
    el.textContent = 'Aktif grup yok';
  } else if (d.fits && !d.ceilingViolation) {
    el.className = 'status ok';
    el.textContent = `✓ ${d.totalRows} raf sığıyor`;
  } else {
    el.className = 'status bad';
    el.textContent = `✗ ${d.totalRows} raf sığmıyor — eksik ${(d.deficit * 100).toFixed(0)} cm`;
  }
}

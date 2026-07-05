// Basılabilir rapor + kesim listesi (BOM): yeni sekmede açılır, "Yazdır" → PDF.
// Sigma iskelet ölçüleri CabinetBuilder.buildFrame ile aynı kabulleri kullanır (t = 45 mm).
import { buildGroupSection } from '../core/profile';
import type { CabinetParams, Derived, Diagnostic } from '../core/types';

const FRAME_T = 0.045; // m — 45 mm sigma profil (CabinetBuilder ile aynı)

const cm = (m: number): string => (m * 100).toFixed(1).replace(/\.0$/, '');
const int = (n: number): string => n.toLocaleString('tr-TR');
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface BomRow {
  kalem: string;
  olcu: string;
  adet: number;
  toplamBoy: number; // m — metraj (uzunluk × adet); levhalar için 0
}

/** Sigma iskelet kesim listesi — CabinetBuilder.buildFrame'deki parça düzeninin sayımı. */
function frameBom(p: CabinetParams): BomRow[] {
  const { W, H, D } = p;
  const dikme = H - 2 * FRAME_T;
  const rows: BomRow[] = [
    { kalem: 'Sigma 45×45 — dikey köşe', olcu: `${cm(H)} cm`, adet: 4, toplamBoy: 4 * H },
    { kalem: 'Sigma 45×45 — X kirişi (ön/arka, üst/alt)', olcu: `${cm(W - 2 * FRAME_T)} cm`, adet: 4, toplamBoy: 4 * (W - 2 * FRAME_T) },
    { kalem: 'Sigma 45×45 — Z kirişi (sol/sağ, üst/alt)', olcu: `${cm(D)} cm`, adet: 4, toplamBoy: 4 * D },
    {
      kalem: 'Sigma — kolon ayırıcı dikme (ön+arka)',
      olcu: `${cm(dikme)} cm`,
      adet: (p.nColumns + 1) * 2,
      toplamBoy: (p.nColumns + 1) * 2 * dikme,
    },
  ];
  return rows;
}

export function buildReportHtml(p: CabinetParams, d: Derived, diags: Diagnostic[]): string {
  const now = new Date().toLocaleString('tr-TR');
  const frame = frameBom(p);
  const frameTotal = frame.reduce((s, r) => s + r.toplamBoy, 0);

  // Raf U-profil kesim listesi: grup × (aynı oluk sayısına sahip kolon kümesi)
  const shelfRows: string[] = [];
  p.groups.forEach((g, gi) => {
    if (!g.enabled || g.nRows <= 0) return;
    const gd = d.groups[gi];
    const byCount = new Map<number, number[]>();
    gd.channelsPerColumn.forEach((cnt, c) => {
      if (cnt < 1) return;
      const list = byCount.get(cnt) ?? [];
      list.push(c);
      byCount.set(cnt, list);
    });
    for (const [cnt, cols] of byCount) {
      const sec = buildGroupSection(g, d.columnWidths[cols[0]]);
      shelfRows.push(
        `<tr><td>${esc(g.label)}</td><td>${cnt}</td><td>${cm(sec.totalWidth)} × ${cm(d.L)} cm</td>` +
          `<td>${cm(sec.sectionHeight)} cm</td><td class="r">${g.nRows * cols.length}</td></tr>`,
      );
    }
  });

  // Kapasite kırılımı
  const capRows = d.groups
    .filter((g) => g.enabled && g.nRows > 0)
    .map(
      (g) =>
        `<tr><td>${esc(g.label)}</td><td class="r">${g.nRows}</td><td class="r">${g.rowChannels}</td>` +
        `<td class="r">${int(g.channels)}</td><td class="r">${g.medsPerChannel}</td><td class="r">${int(g.meds)}</td></tr>`,
    )
    .join('');

  const issues = diags.filter((x) => x.level !== 'ok');
  const issuesHtml =
    issues.length === 0
      ? '<p class="ok">✓ Doğrulama temiz: fizik ihlali yok.</p>'
      : '<ul>' +
        issues
          .map((x) => `<li class="${x.level}">${x.level === 'error' ? '✗' : '⚠'} ${esc(x.message)}</li>`)
          .join('') +
        '</ul>';

  const kolonlar = d.columnWidths.map((w) => cm(w)).join(' / ');

  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<title>Eczane Kabin Raporu</title>
<style>
  body { font: 13px/1.5 system-ui, sans-serif; color: #1c2430; margin: 32px auto; max-width: 860px; padding: 0 16px; }
  h1 { font-size: 20px; margin-bottom: 2px; }
  h2 { font-size: 15px; margin: 22px 0 8px; border-bottom: 2px solid #1c2430; padding-bottom: 3px; }
  .meta { color: #6a7484; font-size: 12px; margin-bottom: 18px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
  th, td { border: 1px solid #c8cfd9; padding: 5px 8px; text-align: left; }
  th { background: #eef1f5; font-size: 12px; }
  td.r, th.r { text-align: right; }
  tfoot td { font-weight: 700; background: #f6f8fa; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px 18px; }
  .kv { display: flex; justify-content: space-between; border-bottom: 1px dotted #c8cfd9; padding: 3px 0; }
  .kv b { font-variant-numeric: tabular-nums; }
  .ok { color: #157a45; } .error { color: #b32222; } .warn { color: #8f6a10; }
  ul { padding-left: 20px; } li { margin-bottom: 3px; }
  .printbtn { position: fixed; top: 14px; right: 14px; background: #1c2430; color: #fff; border: 0; border-radius: 8px; padding: 9px 18px; font-size: 13px; cursor: pointer; }
  @media print { .printbtn { display: none; } body { margin: 0; } }
</style></head><body>
<button class="printbtn" onclick="window.print()">🖨 Yazdır / PDF</button>
<h1>Eczane İlaç Kabini — Tasarım Raporu</h1>
<div class="meta">Oluşturma: ${now} · 3D Parametrik Simülatör</div>

<h2>1. Kabin Özeti</h2>
<div class="grid">
  <div class="kv"><span>Genişlik (W)</span><b>${cm(p.W)} cm</b></div>
  <div class="kv"><span>Yükseklik (H)</span><b>${cm(p.H)} cm</b></div>
  <div class="kv"><span>Derinlik (D)</span><b>${cm(p.D)} cm</b></div>
  <div class="kv"><span>Eğim (α)</span><b>${p.tiltDeg.toFixed(1)}°</b></div>
  <div class="kv"><span>Kanal boyu (L)</span><b>${cm(d.L)} cm</b></div>
  <div class="kv"><span>Arka yükseliş</span><b>${cm(d.rise)} cm</b></div>
  <div class="kv"><span>Kolonlar (${p.nColumns})</span><b>${kolonlar} cm</b></div>
  <div class="kv"><span>Kullanılabilir Y×G</span><b>${cm(d.usableHeight)} × ${cm(d.usableWidth)} cm</b></div>
  <div class="kv"><span>Paylar (üst/alt/yan)</span><b>${cm(p.topMargin)}/${cm(p.bottomMargin)}/${cm(p.sideMargin)} cm</b></div>
  <div class="kv"><span>Servis kesimi</span><b>${cm(p.topServiceCut)} cm</b></div>
  <div class="kv"><span>Robot derinlik payı</span><b>${cm(p.robotDepthClearance)} cm</b></div>
  <div class="kv"><span>Geçiş payı</span><b>${cm(d.transitionGap)} cm</b></div>
</div>

<h2>2. Kapasite</h2>
<table>
  <thead><tr><th>Grup</th><th class="r">Raf</th><th class="r">Kanal/raf</th><th class="r">Kanal (SKU)</th><th class="r">İlaç/kanal</th><th class="r">İlaç</th></tr></thead>
  <tbody>${capRows}</tbody>
  <tfoot><tr><td>Toplam</td><td class="r">${d.totalRows}</td><td class="r">—</td><td class="r">${int(d.totalChannels)}</td><td class="r">—</td><td class="r">${int(d.totalMeds)}</td></tr></tfoot>
</table>
<p>İstif: <b>${cm(d.stackHeight)} cm</b> / kullanılabilir <b>${cm(d.usableHeight)} cm</b> — ${
    d.fits ? '<span class="ok">✓ sığıyor</span>' : `<span class="error">✗ ${cm(d.deficit)} cm taşıyor</span>`
  }${d.ceilingViolation ? ` · <span class="error">tavan +${cm(d.ceilingOverflow)} cm deliniyor</span>` : ''}</p>

<h2>3. Kesim Listesi — Sigma İskelet</h2>
<table>
  <thead><tr><th>Kalem</th><th>Kesim boyu</th><th class="r">Adet</th><th class="r">Metraj</th></tr></thead>
  <tbody>${frame
    .map(
      (r) =>
        `<tr><td>${esc(r.kalem)}</td><td>${r.olcu}</td><td class="r">${r.adet}</td><td class="r">${r.toplamBoy.toFixed(2)} m</td></tr>`,
    )
    .join('')}</tbody>
  <tfoot><tr><td colspan="3">Toplam sigma profil</td><td class="r">${frameTotal.toFixed(2)} m</td></tr></tfoot>
</table>

<h2>4. Kesim Listesi — Raf U-Profilleri (ekstrüzyon)</h2>
<table>
  <thead><tr><th>Grup</th><th>Oluk sayısı</th><th>Kesit genişliği × boy</th><th>Kesit yüksekliği</th><th class="r">Adet</th></tr></thead>
  <tbody>${shelfRows.join('')}</tbody>
</table>

<h2>5. Paneller</h2>
<table>
  <thead><tr><th>Panel</th><th>Ölçü</th><th class="r">Adet</th></tr></thead>
  <tbody>
    <tr><td>Arka panel</td><td>${cm(p.W)} × ${cm(p.H)} cm</td><td class="r">1</td></tr>
    <tr><td>Yan panel</td><td>${cm(p.D)} × ${cm(p.H)} cm</td><td class="r">2</td></tr>
  </tbody>
</table>

<h2>6. Doğrulama</h2>
${issuesHtml}
</body></html>`;
}

/** Raporu yeni sekmede açar. Popup engellenirse false döner. */
export function openReport(p: CabinetParams, d: Derived, diags: Diagnostic[]): boolean {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(buildReportHtml(p, d, diags));
  w.document.close();
  return true;
}

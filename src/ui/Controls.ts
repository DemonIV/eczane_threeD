// SPEC §5 — mobil-öncelikli sekmeli parametre panelleri + grup kartları (SVG kesit
// önizlemeli) + hedef paneli (çözücü önerileri, "Uygula" butonlu).
import { buildProfileShape } from '../core/profile';
import type {
  CabinetParams,
  Derived,
  Diagnostic,
  GroupParams,
  SolverReport,
} from '../core/types';

export interface ControlsCallbacks {
  /** rebuild=true: panel DOM'u yeniden kurulmalı (yapısal değişiklik / dış yama). */
  onPatch(patch: Partial<CabinetParams>, groups?: GroupParams[], opts?: { rebuild?: boolean }): void;
}

interface SliderOpts {
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  value: number;
  digits?: number;
}

function sliderRow(parent: HTMLElement, o: SliderOpts, onChange: (v: number) => void): void {
  const row = document.createElement('div');
  row.className = 'ctl-row';
  const digits = o.digits ?? (o.step < 1 ? 1 : 0);
  row.innerHTML =
    `<label>${o.label}</label>` +
    `<input type="range" min="${o.min}" max="${o.max}" step="${o.step}" value="${o.value}">` +
    `<input type="number" min="${o.min}" max="${o.max}" step="${o.step}" value="${o.value.toFixed(digits)}">` +
    `<span class="unit">${o.unit}</span>`;
  const range = row.querySelector('input[type=range]') as HTMLInputElement;
  const num = row.querySelector('input[type=number]') as HTMLInputElement;
  const emit = (v: number): void => {
    if (!Number.isFinite(v)) return;
    onChange(v);
  };
  range.addEventListener('input', () => {
    num.value = range.value;
    emit(parseFloat(range.value));
  });
  num.addEventListener('change', () => {
    range.value = num.value;
    emit(parseFloat(num.value));
  });
  parent.appendChild(row);
}

function section(parent: HTMLElement, title?: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ctl-section';
  if (title) {
    const h = document.createElement('h3');
    h.textContent = title;
    el.appendChild(h);
  }
  parent.appendChild(el);
  return el;
}

const TABS = [
  { id: 'kabin', label: 'Kabin' },
  { id: 'paylar', label: 'Paylar' },
  { id: 'gruplar', label: 'Gruplar' },
  { id: 'global', label: 'Global' },
  { id: 'hedef', label: 'Hedef' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export class Controls {
  private activeTab: TabId = 'kabin';
  private panes = new Map<TabId, HTMLElement>();
  private groupStatEls = new Map<string, HTMLElement>();
  private groupSvgEls = new Map<string, HTMLElement>();
  private groupDiagEls = new Map<string, HTMLElement>();
  private hedefStatusEl: HTMLElement | null = null;
  private diagListEl: HTMLElement | null = null;
  private suggestionsEl: HTMLElement | null = null;
  private gapAutoLabel: HTMLElement | null = null;

  constructor(
    private tabsEl: HTMLElement,
    private contentEl: HTMLElement,
    private getParams: () => CabinetParams,
    private getDerived: () => Derived,
    private cb: ControlsCallbacks,
  ) {}

  build(): void {
    const p = this.getParams();
    this.tabsEl.innerHTML = '';
    this.contentEl.innerHTML = '';
    this.panes.clear();
    this.groupStatEls.clear();
    this.groupSvgEls.clear();
    this.groupDiagEls.clear();

    for (const t of TABS) {
      const btn = document.createElement('button');
      btn.className = 'tab-btn' + (t.id === this.activeTab ? ' active' : '');
      btn.textContent = t.label;
      btn.addEventListener('click', () => {
        this.activeTab = t.id;
        this.tabsEl.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        for (const [id, pane] of this.panes) pane.style.display = id === t.id ? '' : 'none';
      });
      this.tabsEl.appendChild(btn);

      const pane = document.createElement('div');
      pane.className = 'tab-pane';
      pane.style.display = t.id === this.activeTab ? '' : 'none';
      this.contentEl.appendChild(pane);
      this.panes.set(t.id, pane);
    }

    this.buildKabin(this.panes.get('kabin')!, p);
    this.buildPaylar(this.panes.get('paylar')!, p);
    this.buildGruplar(this.panes.get('gruplar')!, p);
    this.buildGlobal(this.panes.get('global')!, p);
    this.buildHedef(this.panes.get('hedef')!, p);
  }

  // ---------- Kabin ----------
  private buildKabin(pane: HTMLElement, p: CabinetParams): void {
    const s = section(pane, 'Kabin ölçüleri');
    sliderRow(s, { label: 'Genişlik W', min: 100, max: 800, step: 5, unit: 'cm', value: p.W * 100 }, (v) =>
      this.cb.onPatch({ W: v / 100 }),
    );
    sliderRow(s, { label: 'Yükseklik H', min: 150, max: 350, step: 5, unit: 'cm', value: p.H * 100 }, (v) =>
      this.cb.onPatch({ H: v / 100 }),
    );
    sliderRow(s, { label: 'Derinlik D', min: 60, max: 200, step: 5, unit: 'cm', value: p.D * 100 }, (v) =>
      this.cb.onPatch({ D: v / 100 }),
    );
    sliderRow(s, { label: 'Kolon sayısı', min: 1, max: 6, step: 1, unit: 'adet', value: p.nColumns }, (v) =>
      this.cb.onPatch({ nColumns: Math.round(v) }),
    );

    const s2 = section(pane, 'Teslim varyantı');
    const sel = document.createElement('select');
    sel.innerHTML =
      `<option value="side_bin"${p.delivery === 'side_bin' ? ' selected' : ''}>Yan teslim haznesi</option>` +
      `<option value="conveyor"${p.delivery === 'conveyor' ? ' selected' : ''}>Alt konveyör bandı</option>`;
    sel.addEventListener('change', () => this.cb.onPatch({ delivery: sel.value as CabinetParams['delivery'] }));
    s2.appendChild(sel);
  }

  // ---------- Paylar ----------
  private buildPaylar(pane: HTMLElement, p: CabinetParams): void {
    const s = section(pane, 'Montaj payları');
    sliderRow(s, { label: 'Üst pay', min: 0, max: 80, step: 1, unit: 'cm', value: p.topMargin * 100 }, (v) =>
      this.cb.onPatch({ topMargin: v / 100 }),
    );
    sliderRow(s, { label: 'Alt pay', min: 0, max: 80, step: 1, unit: 'cm', value: p.bottomMargin * 100 }, (v) =>
      this.cb.onPatch({ bottomMargin: v / 100 }),
    );
    sliderRow(s, { label: 'Yan pay', min: 0, max: 80, step: 1, unit: 'cm', value: p.sideMargin * 100 }, (v) =>
      this.cb.onPatch({ sideMargin: v / 100 }),
    );

    const s2 = section(pane, 'Robot payları');
    sliderRow(
      s2,
      { label: 'Robot derinlik payı', min: 0, max: 40, step: 1, unit: 'cm', value: p.robotDepthClearance * 100 },
      (v) => this.cb.onPatch({ robotDepthClearance: v / 100 }),
    );
    sliderRow(
      s2,
      { label: 'Üst servis payı', min: 0, max: 30, step: 1, unit: 'cm', value: p.topServiceCut * 100 },
      (v) => this.cb.onPatch({ topServiceCut: v / 100 }),
    );

    const s3 = section(pane, 'Grup geçiş payı (SPEC §2.3)');
    const autoWrap = document.createElement('label');
    autoWrap.className = 'check-row';
    const auto = document.createElement('input');
    auto.type = 'checkbox';
    auto.checked = p.transitionGapOverride === null;
    autoWrap.appendChild(auto);
    const autoTxt = document.createElement('span');
    autoWrap.appendChild(autoTxt);
    this.gapAutoLabel = autoTxt;
    s3.appendChild(autoWrap);

    const gapHost = document.createElement('div');
    s3.appendChild(gapHost);
    const renderGapSlider = (): void => {
      gapHost.innerHTML = '';
      if (p.transitionGapOverride !== null) {
        sliderRow(
          gapHost,
          { label: 'Geçiş payı', min: 0, max: 25, step: 0.5, unit: 'cm', value: this.getParams().transitionGapOverride! * 100 },
          (v) => this.cb.onPatch({ transitionGapOverride: v / 100 }),
        );
      }
    };
    auto.addEventListener('change', () => {
      const d = this.getDerived();
      this.cb.onPatch(
        { transitionGapOverride: auto.checked ? null : d.transitionGap },
        undefined,
        { rebuild: true },
      );
    });
    renderGapSlider();
  }

  // ---------- Gruplar ----------
  private buildGruplar(pane: HTMLElement, p: CabinetParams): void {
    const info = document.createElement('p');
    info.className = 'hint';
    info.textContent = 'Sıra = fiziksel yerleşim (1 = en alt). Eğim globaldir; sıralama kapasiteyi değil erişim/stabiliteyi etkiler.';
    pane.appendChild(info);

    p.groups.forEach((g, gi) => {
      const card = document.createElement('div');
      card.className = 'gcard' + (g.enabled ? '' : ' gcard-off');
      pane.appendChild(card);

      // --- başlık ---
      const head = document.createElement('div');
      head.className = 'gcard-head';
      head.innerHTML =
        `<button class="gcaret">▸</button>` +
        `<span class="gdot" style="background:#${g.color.toString(16).padStart(6, '0')}"></span>` +
        `<span class="gname">${g.label}</span><span class="gpos">${gi + 1}${gi === 0 ? ' (en alt)' : gi === p.groups.length - 1 ? ' (en üst)' : ''}</span>` +
        `<span class="gstats"></span>`;
      card.appendChild(head);

      const stats = head.querySelector('.gstats') as HTMLElement;
      this.groupStatEls.set(g.id, stats);

      const tools = document.createElement('span');
      tools.className = 'gtools';
      const mkBtn = (txt: string, title: string, fn: () => void): void => {
        const b = document.createElement('button');
        b.textContent = txt;
        b.title = title;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          fn();
        });
        tools.appendChild(b);
      };
      if (gi > 0)
        mkBtn('▼', 'Aşağı taşı (alta)', () => {
          const gs = [...this.getParams().groups];
          [gs[gi - 1], gs[gi]] = [gs[gi], gs[gi - 1]];
          this.cb.onPatch({}, gs, { rebuild: true });
        });
      if (gi < p.groups.length - 1)
        mkBtn('▲', 'Yukarı taşı (üste)', () => {
          const gs = [...this.getParams().groups];
          [gs[gi], gs[gi + 1]] = [gs[gi + 1], gs[gi]];
          this.cb.onPatch({}, gs, { rebuild: true });
        });
      const sw = document.createElement('input');
      sw.type = 'checkbox';
      sw.checked = g.enabled;
      sw.title = 'Grubu aç/kapa';
      sw.addEventListener('click', (e) => e.stopPropagation());
      sw.addEventListener('change', () => {
        const gs = this.getParams().groups.map((x) => (x.id === g.id ? { ...x, enabled: sw.checked } : x));
        this.cb.onPatch({}, gs, { rebuild: true });
      });
      tools.appendChild(sw);
      head.appendChild(tools);

      // --- gövde ---
      const body = document.createElement('div');
      body.className = 'gcard-body';
      body.style.display = gi === 0 ? '' : 'none';
      card.appendChild(body);
      const caret = head.querySelector('.gcaret') as HTMLElement;
      caret.textContent = gi === 0 ? '▾' : '▸';
      head.addEventListener('click', () => {
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : '';
        caret.textContent = open ? '▸' : '▾';
      });

      const patchGroup = (field: keyof GroupParams | `med.${'w' | 'h' | 'len'}`, v: number): void => {
        const gs = this.getParams().groups.map((x) => {
          if (x.id !== g.id) return x;
          if (field.startsWith('med.')) {
            const key = field.slice(4) as 'w' | 'h' | 'len';
            return { ...x, med: { ...x.med, [key]: v } };
          }
          return { ...x, [field]: v };
        });
        this.cb.onPatch({}, gs);
      };

      const sp = section(body, 'Profil kesiti (cm)');
      sliderRow(sp, { label: 'Kanal iç genişliği', min: 2, max: 15, step: 0.1, unit: 'cm', value: g.channelInnerWidth * 100 }, (v) => patchGroup('channelInnerWidth', v / 100));
      sliderRow(sp, { label: 'Flanş yüksekliği', min: 2, max: 15, step: 0.1, unit: 'cm', value: g.flangeHeight * 100 }, (v) => patchGroup('flangeHeight', v / 100));
      sliderRow(sp, { label: 'Flanş kalınlığı', min: 0.1, max: 1, step: 0.05, unit: 'cm', digits: 2, value: g.flangeThickness * 100 }, (v) => patchGroup('flangeThickness', v / 100));
      sliderRow(sp, { label: 'Taban kalınlığı', min: 0.1, max: 1.5, step: 0.05, unit: 'cm', digits: 2, value: g.baseThickness * 100 }, (v) => patchGroup('baseThickness', v / 100));

      const sr = section(body, 'Raflar ve ilaç');
      sliderRow(sr, { label: 'Raf sayısı', min: 0, max: 40, step: 1, unit: 'adet', value: g.nRows }, (v) => patchGroup('nRows', Math.round(v)));
      sliderRow(sr, { label: 'İlaç eni', min: 1, max: 14, step: 0.1, unit: 'cm', value: g.med.w * 100 }, (v) => patchGroup('med.w', v / 100));
      sliderRow(sr, { label: 'İlaç yüksekliği', min: 1, max: 14, step: 0.1, unit: 'cm', value: g.med.h * 100 }, (v) => patchGroup('med.h', v / 100));
      sliderRow(sr, { label: 'İlaç boyu', min: 4, max: 30, step: 0.5, unit: 'cm', value: g.med.len * 100 }, (v) => patchGroup('med.len', v / 100));

      const svgHost = document.createElement('div');
      svgHost.className = 'gsvg';
      body.appendChild(svgHost);
      this.groupSvgEls.set(g.id, svgHost);

      const gdiag = document.createElement('div');
      gdiag.className = 'gdiag';
      body.appendChild(gdiag);
      this.groupDiagEls.set(g.id, gdiag);
    });
  }

  // ---------- Global ----------
  private buildGlobal(pane: HTMLElement, p: CabinetParams): void {
    const s = section(pane, 'Eğim (GLOBAL — tüm gruplar)');
    sliderRow(s, { label: 'Eğim α', min: 5, max: 45, step: 0.5, unit: '°', value: p.tiltDeg }, (v) =>
      this.cb.onPatch({ tiltDeg: v }),
    );
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Gravity-feed güvenli aralık 20–30°: altında sürtünme beslemeyi durdurur, üstünde arka baskı mandalı zorlar.';
    s.appendChild(hint);

    const s2 = section(pane, 'Robot');
    sliderRow(s2, { label: 'Servo hızı', min: 0.2, max: 3, step: 0.1, unit: 'm/s', value: p.robotSpeed }, (v) =>
      this.cb.onPatch({ robotSpeed: v }),
    );
  }

  // ---------- Hedef ----------
  private buildHedef(pane: HTMLElement, p: CabinetParams): void {
    const s = section(pane, 'Hedefler');
    sliderRow(s, { label: 'Hedef raf', min: 1, max: 60, step: 1, unit: 'adet', value: p.targetRows }, (v) =>
      this.cb.onPatch({ targetRows: Math.round(v) }),
    );
    sliderRow(s, { label: 'Hedef ilaç', min: 100, max: 40000, step: 100, unit: 'adet', value: p.targetMeds }, (v) =>
      this.cb.onPatch({ targetMeds: Math.round(v) }),
    );

    this.hedefStatusEl = section(pane, 'Durum');
    this.suggestionsEl = section(pane, 'Çözücü önerileri');
    this.diagListEl = section(pane, 'Tanılar');
  }

  // ---------- Canlı güncelleme (slider yeniden kurulmaz) ----------
  updateDerived(d: Derived, diags: Diagnostic[], report: SolverReport): void {
    const p = this.getParams();

    if (this.gapAutoLabel) {
      this.gapAutoLabel.textContent =
        p.transitionGapOverride === null
          ? `Otomatik: max(kesit)/cos α = ${(d.transitionGap * 100).toFixed(1)} cm`
          : 'Otomatik (işaretle) — şu an manuel';
    }

    p.groups.forEach((g, gi) => {
      const gd = d.groups[gi];
      const stats = this.groupStatEls.get(g.id);
      if (stats) {
        stats.textContent = g.enabled
          ? `${gd.nRows} raf · ${gd.channelsPerRow}k/raf · ${gd.channels} kanal · ${gd.meds.toLocaleString('tr-TR')} ilaç`
          : 'devre dışı';
      }
      const svgHost = this.groupSvgEls.get(g.id);
      if (svgHost) svgHost.innerHTML = sectionSvg(g, d, diags);
      const gdiag = this.groupDiagEls.get(g.id);
      if (gdiag) {
        const own = diags.filter((x) => x.groupId === g.id);
        gdiag.innerHTML = own
          .map((x) => `<div class="diag diag-${x.level}">${x.message}</div>`)
          .join('');
      }
    });

    if (this.hedefStatusEl) {
      const rowsCls = report.rowsTargetMet ? 'ok' : 'bad';
      const medsCls = report.medsTargetMet ? 'ok' : 'bad';
      this.hedefStatusEl.innerHTML =
        `<h3>Durum</h3>` +
        `<div class="target-line ${rowsCls}">Raf: ${report.rowsConfigured}/${report.rowsTarget} ` +
        (report.stackFits
          ? report.rowsTargetMet
            ? '✓ sığıyor ve hedefi karşılıyor'
            : `✗ sığıyor ama hedefin ${report.rowsTarget - report.rowsConfigured} raf altında`
          : `✗ sığmıyor — eksik ${report.deficitCm.toFixed(1)} cm`) +
        `</div>` +
        `<div class="target-line ${medsCls}">İlaç: ${report.medsCurrent.toLocaleString('tr-TR')}/${report.medsTarget.toLocaleString('tr-TR')} ` +
        (report.medsTargetMet ? '✓' : `✗ açık ${report.medsDeficit.toLocaleString('tr-TR')}`) +
        `</div>`;
    }

    if (this.suggestionsEl) {
      this.suggestionsEl.innerHTML = '<h3>Çözücü önerileri</h3>';
      if (report.suggestions.length === 0) {
        this.suggestionsEl.innerHTML += '<p class="hint">Öneri yok — mevcut yapılandırma hedefleri karşılıyor.</p>';
      }
      for (const sug of report.suggestions) {
        const card = document.createElement('div');
        card.className = 'sug';
        const applicable = sug.patch !== null || sug.groupsPatch !== undefined;
        card.innerHTML =
          `<div class="sug-label">${sug.label}</div>` +
          `<div class="sug-detail">${sug.detail}</div>` +
          `<div class="sug-side">Yan etki: ${sug.sideEffect}</div>`;
        const btn = document.createElement('button');
        btn.className = 'sug-apply';
        btn.textContent = applicable ? 'Uygula' : 'Uygulanamaz';
        btn.disabled = !applicable;
        btn.addEventListener('click', () => {
          this.cb.onPatch(sug.patch ?? {}, sug.groupsPatch, { rebuild: true });
        });
        card.appendChild(btn);
        this.suggestionsEl.appendChild(card);
      }
    }

    if (this.diagListEl) {
      this.diagListEl.innerHTML =
        '<h3>Tanılar</h3>' +
        diags.map((x) => `<div class="diag diag-${x.level}">${x.message}</div>`).join('');
    }
  }
}

// ---------- Grup kartı mini kesit SVG önizlemesi (SPEC §5, Image 2 tarzı) ----------
function sectionSvg(g: GroupParams, d: Derived, diags: Diagnostic[]): string {
  // okunabilirlik için en fazla 3 oluk çiz
  const xPitch = g.channelInnerWidth + 2 * g.flangeThickness;
  const previewW = Math.min(d.columnWidth, 3 * xPitch + 1e-6);
  const sec = buildProfileShape(
    {
      channelInnerWidth: g.channelInnerWidth,
      flangeHeight: g.flangeHeight,
      flangeThickness: g.flangeThickness,
      baseThickness: g.baseThickness,
    },
    previewW,
  );
  if (sec.channelCount === 0) return '<p class="hint">Kesit kolona sığmıyor.</p>';

  const W = 280;
  const scale = (W - 40) / sec.totalWidth;
  const H = sec.sectionHeight * scale + 46;
  const fy = (y: number): number => 8 + (sec.sectionHeight - y) * scale;
  const fx = (x: number): number => 20 + x * scale;
  const path =
    sec.points.map((q, i) => `${i === 0 ? 'M' : 'L'}${fx(q.x).toFixed(1)},${fy(q.y).toFixed(1)}`).join(' ') + ' Z';

  // orta oluğa ilaç silüeti
  const mid = Math.min(1, sec.channelCount - 1);
  const chLeft = mid * sec.xPitch + g.flangeThickness;
  const medX = chLeft + (g.channelInnerWidth - g.med.w) / 2;
  const bad = diags.some(
    (x) => x.groupId === g.id && (x.code === 'MED_TOO_WIDE' || x.code === 'MED_TOO_TALL'),
  );
  const medColor = bad ? '#e05555' : `#${g.color.toString(16).padStart(6, '0')}`;
  const medRect =
    `<rect x="${fx(medX).toFixed(1)}" y="${(fy(g.baseThickness + g.med.h)).toFixed(1)}" ` +
    `width="${(g.med.w * scale).toFixed(1)}" height="${(g.med.h * scale).toFixed(1)}" ` +
    `fill="${medColor}" opacity="0.85" rx="2"/>`;

  const dimY = 8 + sec.sectionHeight * scale + 14;
  return (
    `<svg viewBox="0 0 ${W} ${H.toFixed(0)}" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="${path}" fill="#7d838d" stroke="${bad ? '#e05555' : '#aab2bd'}" stroke-width="1"/>` +
    medRect +
    `<text x="${fx(g.flangeThickness + g.channelInnerWidth / 2)}" y="${dimY}" class="svgdim" text-anchor="middle">iç ${(g.channelInnerWidth * 100).toFixed(1)} cm</text>` +
    `<text x="${W - 6}" y="${fy(sec.sectionHeight / 2)}" class="svgdim" text-anchor="end">${((g.flangeHeight + g.baseThickness) * 100).toFixed(1)} cm</text>` +
    `<text x="${fx(sec.totalWidth / 2)}" y="${dimY + 16}" class="svgdim svgdim-sub" text-anchor="middle">ilaç ${(g.med.w * 100).toFixed(0)}×${(g.med.h * 100).toFixed(0)}×${(g.med.len * 100).toFixed(0)} cm ${bad ? '— SIĞMIYOR' : ''}</text>` +
    `</svg>`
  );
}

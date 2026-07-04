// AI Danışman sekmesi: Gemini'ye kabinin güncel durumu + kullanıcı sorusu gönderilir,
// yanıttaki somut öneriler tek tıkla uygulanabilir.
import {
  askGemini,
  buildContextJson,
  changesToPatch,
  DEFAULT_API_KEY,
  type AiReply,
  type AiTurn,
} from '../ai/gemini';
import type {
  CabinetParams,
  Derived,
  Diagnostic,
  GroupParams,
  SolverReport,
} from '../core/types';

const KEY_STORAGE = 'eczane_gemini_api_key';
const AUTO_STORAGE = 'eczane_gemini_auto_apply';

const EXAMPLES = [
  'Tüm payları 30 cm yapıp yine de 15.000 ilaca nasıl ulaşırım?',
  'Bu tasarımın zayıf noktaları neler? Neyi iyileştirmeliyim?',
  'Eğimi 22°ye düşürsem ne kazanır, ne kaybederim?',
  'SKU (kanal çeşidi) sayısını maksimuma çıkarmak için ne yapmalıyım?',
];

export interface AiPanelDeps {
  getParams(): CabinetParams;
  getDerived(): Derived;
  getDiags(): Diagnostic[];
  getReport(): SolverReport;
  onPatch(patch: Partial<CabinetParams>, groups?: GroupParams[], opts?: { rebuild?: boolean }): void;
}

interface LogEntry {
  q: string;
  reply?: AiReply;
  error?: string;
  pending?: boolean;
  /** Otomatik uygulanan önerinin indeksi (varsa). */
  autoAppliedIndex?: number;
}

export class AiPanel {
  private history: AiTurn[] = [];
  private log: LogEntry[] = [];
  private root: HTMLElement | null = null;
  private busy = false;

  constructor(private deps: AiPanelDeps) {}

  /** Controls.build() her çalıştığında yeni pane'e monte edilir; sohbet geçmişi korunur. */
  mount(el: HTMLElement): void {
    this.root = el;
    this.render();
  }

  /** Etkin anahtar: kullanıcının kendi anahtarı > site anahtarı (build'e gömülü). */
  private getKey(): string {
    return localStorage.getItem(KEY_STORAGE) || DEFAULT_API_KEY;
  }

  private isAutoApply(): boolean {
    const v = localStorage.getItem(AUTO_STORAGE);
    return v === null ? true : v === '1'; // varsayılan: açık (AI ölçüleri aktif uygular)
  }

  private render(): void {
    const el = this.root;
    if (!el) return;
    el.innerHTML = '';

    // --- API anahtarı ---
    const keySec = document.createElement('div');
    keySec.className = 'ctl-section';
    keySec.innerHTML =
      '<h3>Gemini API anahtarı</h3>' +
      (DEFAULT_API_KEY
        ? '<p class="hint">✓ Site anahtarı aktif — herkes doğrudan kullanabilir. İstersen aşağıya kendi anahtarını girerek onu kullanabilirsin.</p>'
        : '<p class="hint">Anahtar yalnızca bu tarayıcıda saklanır ve doğrudan Google\'a gönderilir. ' +
          'Ücretsiz anahtar: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a></p>');
    const keyRow = document.createElement('div');
    keyRow.className = 'ai-key-row';
    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.placeholder = DEFAULT_API_KEY ? 'Kendi anahtarın (opsiyonel)' : 'AIza...';
    keyInput.value = localStorage.getItem(KEY_STORAGE) ?? '';
    keyInput.autocomplete = 'off';
    const keySave = document.createElement('button');
    keySave.textContent = 'Kaydet';
    keySave.className = 'sug-apply';
    keySave.addEventListener('click', () => {
      localStorage.setItem(KEY_STORAGE, keyInput.value.trim());
      keySave.textContent = 'Kaydedildi ✓';
      setTimeout(() => (keySave.textContent = 'Kaydet'), 1500);
    });
    keyRow.append(keyInput, keySave);
    keySec.appendChild(keyRow);

    // --- otomatik uygulama: AI'nin ilk önerisindeki ölçüler anında sisteme işlenir ---
    const autoWrap = document.createElement('label');
    autoWrap.className = 'check-row';
    const auto = document.createElement('input');
    auto.type = 'checkbox';
    auto.checked = this.isAutoApply();
    auto.addEventListener('change', () => localStorage.setItem(AUTO_STORAGE, auto.checked ? '1' : '0'));
    autoWrap.appendChild(auto);
    const autoTxt = document.createElement('span');
    autoTxt.textContent = 'Önerileri otomatik uygula (AI ölçüleri doğrudan 3D sisteme işler)';
    autoWrap.appendChild(autoTxt);
    keySec.appendChild(autoWrap);
    el.appendChild(keySec);

    // --- örnek sorular ---
    const exSec = document.createElement('div');
    exSec.className = 'ai-examples';
    for (const ex of EXAMPLES) {
      const b = document.createElement('button');
      b.className = 'ai-example';
      b.textContent = ex;
      b.addEventListener('click', () => {
        input.value = ex;
        input.focus();
      });
      exSec.appendChild(b);
    }
    el.appendChild(exSec);

    // --- sohbet günlüğü ---
    const logEl = document.createElement('div');
    logEl.className = 'ai-log';
    el.appendChild(logEl);
    this.renderLog(logEl);

    // --- giriş ---
    const inRow = document.createElement('div');
    inRow.className = 'ai-input-row';
    const input = document.createElement('textarea');
    input.rows = 2;
    input.placeholder = 'Sorunuzu yazın… (ör. payları 30 cm yap ama kapasiteyi koru)';
    const send = document.createElement('button');
    send.className = 'sug-apply';
    send.textContent = this.busy ? '…' : 'Sor';
    send.disabled = this.busy;
    const doSend = (): void => {
      const q = input.value.trim();
      if (q) void this.ask(q);
    };
    send.addEventListener('click', doSend);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doSend();
    });
    inRow.append(input, send);
    el.appendChild(inRow);
  }

  private renderLog(logEl: HTMLElement): void {
    logEl.innerHTML = '';
    if (this.log.length === 0) {
      logEl.innerHTML =
        '<p class="hint">AI danışman, kabinin güncel tüm parametrelerini ve hesaplanmış metrikleri görür; ' +
        'sorularına buna göre sayısal tavsiye verir. Önerilerdeki değişiklikleri tek tıkla uygulayabilirsin.</p>';
      return;
    }
    for (const entry of this.log) {
      const q = document.createElement('div');
      q.className = 'ai-msg ai-msg-user';
      q.textContent = entry.q;
      logEl.appendChild(q);

      const a = document.createElement('div');
      a.className = 'ai-msg ai-msg-model';
      if (entry.pending) {
        a.innerHTML = '<span class="ai-thinking">Gemini düşünüyor…</span>';
      } else if (entry.error) {
        a.innerHTML = `<span class="ai-error">⚠ ${entry.error}</span>`;
      } else if (entry.reply) {
        const yorum = document.createElement('div');
        yorum.className = 'ai-yorum';
        yorum.textContent = entry.reply.yorum;
        a.appendChild(yorum);
        (entry.reply.oneriler ?? []).forEach((sug, idx) => {
          const card = document.createElement('div');
          card.className = 'sug ai-sug';
          card.innerHTML =
            `<div class="sug-label">${escapeHtml(sug.baslik)}</div>` +
            `<div class="sug-detail">${escapeHtml(sug.aciklama)}</div>` +
            (sug.yanEtki ? `<div class="sug-side">Yan etki: ${escapeHtml(sug.yanEtki)}</div>` : '');
          if (sug.degisiklikler && sug.degisiklikler.length > 0) {
            const btn = document.createElement('button');
            btn.className = 'sug-apply';
            if (entry.autoAppliedIndex === idx) {
              btn.textContent = '✓ Otomatik uygulandı';
              btn.disabled = true;
            } else {
              btn.textContent = `Uygula (${sug.degisiklikler.map((c) => `${c.alan}=${c.deger}`).join(', ')})`;
              btn.addEventListener('click', () => {
                const { patch, groups, skipped } = changesToPatch(
                  sug.degisiklikler!,
                  this.deps.getParams(),
                );
                this.deps.onPatch(patch, groups, { rebuild: true });
                btn.textContent = skipped.length > 0 ? `Uygulandı (atlanan: ${skipped.join(', ')})` : 'Uygulandı ✓';
                btn.disabled = true;
              });
            }
            card.appendChild(btn);
          }
          a.appendChild(card);
        });
      }
      logEl.appendChild(a);
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  private async ask(q: string): Promise<void> {
    if (this.busy) return;
    const key = this.getKey();
    if (!key) {
      this.log.push({ q, error: 'Önce Gemini API anahtarını girip kaydedin.' });
      this.render();
      return;
    }
    this.busy = true;
    const entry: LogEntry = { q, pending: true };
    this.log.push(entry);
    this.render();
    try {
      const ctx = buildContextJson(
        this.deps.getParams(),
        this.deps.getDerived(),
        this.deps.getDiags(),
        this.deps.getReport(),
      );
      const reply = await askGemini(key, q, ctx, this.history);
      entry.reply = reply;
      // Otomatik uygulama: ilk uygulanabilir önerinin ölçüleri anında 3D sisteme işlenir.
      if (this.isAutoApply()) {
        const idx = (reply.oneriler ?? []).findIndex(
          (s) => s.degisiklikler && s.degisiklikler.length > 0,
        );
        if (idx >= 0) {
          const { patch, groups } = changesToPatch(
            reply.oneriler[idx].degisiklikler!,
            this.deps.getParams(),
          );
          this.deps.onPatch(patch, groups, { rebuild: true });
          entry.autoAppliedIndex = idx;
        }
      }
      // geçmişe kısa haliyle ekle (bağlam JSON'u her turda taze gönderilir)
      this.history.push({ role: 'user', text: q });
      this.history.push({ role: 'model', text: JSON.stringify(reply) });
      if (this.history.length > 8) this.history = this.history.slice(-8);
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err);
    } finally {
      entry.pending = false;
      this.busy = false;
      this.render();
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

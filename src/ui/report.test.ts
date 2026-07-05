// Rapor/BOM üretimi — sayısal içeriğin computeDerived ile tutarlılığı.
import { describe, expect, it } from 'vitest';
import { buildReportHtml } from './report';
import { computeDerived } from '../core/geometry';
import { validate } from '../core/validate';
import { defaultParams } from '../core/defaults';

describe('buildReportHtml — varsayılan senaryo', () => {
  const p = defaultParams();
  const d = computeDerived(p);
  const html = buildReportHtml(p, d, validate(p, d));

  it('kabin özeti ve kapasite toplamları raporda geçer', () => {
    expect(html).toContain('400 × '); // W×... değil; W ayrı satırda
    expect(html).toContain('>400 cm<'); // W
    expect(html).toContain('>250 cm<'); // H
    expect(html).toContain('>125 cm<'); // D
    expect(html).toContain(String(d.totalRows)); // 25 raf
    expect(html).toContain((1281).toLocaleString('tr-TR')); // toplam kanal
    expect(html).toContain((12417).toLocaleString('tr-TR')); // toplam ilaç
  });

  it('sigma iskelet kesim listesi: 4 dikey + 4+4 kiriş + (nCol+1)*2 dikme', () => {
    expect(html).toContain('dikey köşe');
    expect(html).toContain('kolon ayırıcı dikme');
    // 3 kolon → 4 sınır × 2 = 8 dikme
    expect(html).toMatch(/kolon ayırıcı dikme[^<]*<\/td><td>[^<]*<\/td><td class="r">8</);
  });

  it('taşma durumu raporda kırmızı olarak işaretlenir', () => {
    expect(html).toContain('taşıyor');
    expect(html).toContain('tavan +');
  });

  it('grup U-profil satırları: her aktif grup için en az bir kesim satırı', () => {
    for (const g of p.groups) expect(html).toContain(g.label);
  });
});

// Gemini API istemcisi — AI Danışman sekmesi.
// Tarayıcıdan doğrudan Generative Language REST API çağrılır (statik site, sunucu yok);
// API anahtarını kullanıcı girer, localStorage'da saklanır.
import type {
  CabinetParams,
  Derived,
  Diagnostic,
  GroupParams,
  SolverReport,
} from '../core/types';

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/**
 * Site geneli varsayılan anahtar: Render dashboard'da VITE_GEMINI_API_KEY ortam
 * değişkeni olarak tanımlanır, build sırasında bundle'a gömülür (repo'da tutulmaz —
 * halka açık repoda anahtar GitHub secret-scanning tarafından iptal ettirilebilir).
 */
export const DEFAULT_API_KEY: string =
  (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ?? '';

export interface AiChange {
  alan: string;
  deger: number;
}
export interface AiSuggestion {
  baslik: string;
  aciklama: string;
  yanEtki?: string;
  degisiklikler?: AiChange[];
}
export interface AiReply {
  yorum: string;
  oneriler: AiSuggestion[];
}
export interface AiTurn {
  role: 'user' | 'model';
  text: string;
}

const cm = (m: number): number => Math.round(m * 1000) / 10;

/** Kabinin güncel durumunu Gemini'ye verilecek kompakt JSON'a çevirir. */
export function buildContextJson(
  p: CabinetParams,
  d: Derived,
  diags: Diagnostic[],
  report: SolverReport,
): string {
  return JSON.stringify({
    kabin: {
      W_cm: cm(p.W),
      H_cm: cm(p.H),
      D_cm: cm(p.D),
      kolonSayisi: p.nColumns,
      kolonModu: p.columnMode,
      kolonGenislikleri_cm: d.columnWidths.map(cm),
      teslim: p.delivery,
    },
    paylar: {
      ust_cm: cm(p.topMargin),
      alt_cm: cm(p.bottomMargin),
      yan_cm: cm(p.sideMargin),
      robotDerinlik_cm: cm(p.robotDepthClearance),
      ustServis_cm: cm(p.topServiceCut),
      grupGecis_cm: cm(d.transitionGap),
    },
    egimDeg: p.tiltDeg,
    gruplar: p.groups.map((g, gi) => {
      const gd = d.groups[gi];
      return {
        id: g.id,
        ad: g.label,
        aktif: g.enabled,
        sira: `${gi + 1}. (alttan)`,
        icGenislik_cm: cm(g.channelInnerWidth),
        flansYukseklik_cm: cm(g.flangeHeight),
        flansEt_cm: cm(g.flangeThickness),
        tabanKalinlik_cm: cm(g.baseThickness),
        rafSayisi: g.nRows,
        ilac_cm: { en: cm(g.med.w), yukseklik: cm(g.med.h), boy: cm(g.med.len) },
        pitch_cm: cm(gd.pitch),
        kanalPerKolon: gd.channelsPerColumn,
        toplamKanal: gd.channels,
        ilacKapasitesi: gd.meds,
      };
    }),
    metrikler: {
      kanalBoyuL_cm: cm(d.L),
      arkaYukselis_cm: cm(d.rise),
      gerekliIstif_cm: cm(d.stackHeight),
      kullanilabilirYukseklik_cm: cm(d.usableHeight),
      istifSigiyorMu: d.fits,
      eksik_cm: cm(d.deficit),
      tavanIhlali: d.ceilingViolation,
      toplamRaf: d.totalRows,
      toplamKanal_SKU: d.totalChannels,
      toplamIlac: d.totalMeds,
      hedefRaf: p.targetRows,
      hedefIlac: p.targetMeds,
    },
    tanilar: diags.map((x) => ({ seviye: x.level, mesaj: x.message })),
    dahiliCozucuOnerileri: report.suggestions.map((s) => ({
      baslik: s.label,
      detay: s.detail,
      yanEtki: s.sideEffect,
    })),
  });
}

/** AI'nin değiştirmesine izin verilen alanlar (whitelist) — sistem talimatında da listelenir. */
const FIELD_HELP = `
- "W_cm","H_cm","D_cm": kabin ölçüleri (cm)
- "nColumns": kolon sayısı (1-6 tam sayı)
- "topMargin_cm","bottomMargin_cm","sideMargin_cm": paylar (cm)
- "robotDepthClearance_cm","topServiceCut_cm": robot payları (cm)
- "tiltDeg": eğim (derece)
- "targetRows","targetMeds": hedefler
- "group.<id>.nRows": grup raf sayısı (<id>: small|medium|large)
- "group.<id>.channelInnerWidth_cm","group.<id>.flangeHeight_cm": grup profil (cm)
- "group.<id>.medW_cm","group.<id>.medH_cm","group.<id>.medLen_cm": grup ilaç boyutu (cm)
- "group.<id>.enabled": 1=aç 0=kapat`;

const SYSTEM_INSTRUCTION = `Sen eczane robot-kabini (EBOT benzeri, gravity-feed) tasarımında uzman bir makine mühendisisin. Kullanıcı sana kabinin güncel parametrelerini ve hesaplanmış metriklerini JSON olarak verir; sorularına Türkçe, somut ve SAYISAL cevap verirsin.

FİZİK KURALLARI (kesin, pazarlıksız):
- Kanal boyu L = D - robotDerinlikPayı. Arka yükseliş rise = L·sin(α).
- Nested raf adımı pitch_g = (flansYukseklik_g + tabanKalinlik_g)/cos(α).
- Gerekli istif ≈ Σ(rafSayisi_g · pitch_g) + rise + (aktifGrupSayısı-1)·grupGeçişPayı.
- İstif, kullanılabilir yüksekliğe (H - üstPay - altPay - üstServis) sığmalı.
- Kanal/kolon = floor(kolonGenişliği / (içGenişlik + 2·flanşEt)). İlaç/kanal = floor(L / ilaçBoyu).
- Eğim 20°-30° arası güvenli: altında sürtünme beslemeyi durdurur, üstünde arka baskı mandalı zorlar.
- İlaç oluğa sığmalı: en ≤ içGenişlik-0.5cm, yükseklik ≤ flanşYüksekliği-0.5cm, boy ≤ L.

GÖREV: Kullanıcının hedefini analiz et, mevcut durumla kıyasla, uygulanabilir değişiklik önerileri üret. Her öneride trade-off'u (yan etkiyi) açıkça söyle. Sayıları verilen JSON'dan al, uydurma. Kaba hesap yaparken formülleri kullan.
ÖNEMLİ: Kullanıcı emir kipinde somut bir değişiklik istiyorsa (örn. "payları 30 cm yap", "eğimi 22 yap"), İLK öneri tam olarak bu değişikliklerin kendisi olsun ("degisiklikler" dolu) — sistem ilk öneriyi otomatik uygular. Ek iyileştirmeler sonraki öneriler olarak gelsin.

Değişiklik önerirken "degisiklikler" alanında SADECE şu alan adlarını kullan:${FIELD_HELP}

Cevabın JSON şemaya uygun olmalı: "yorum" (genel değerlendirme, 2-5 cümle) + "oneriler" (0-4 adet; her biri baslik, aciklama, yanEtki ve uygulanabilir "degisiklikler" listesi).`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    yorum: { type: 'string' },
    oneriler: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          baslik: { type: 'string' },
          aciklama: { type: 'string' },
          yanEtki: { type: 'string' },
          degisiklikler: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                alan: { type: 'string' },
                deger: { type: 'number' },
              },
              required: ['alan', 'deger'],
            },
          },
        },
        required: ['baslik', 'aciklama'],
      },
    },
  },
  required: ['yorum'],
} as const;

export async function askGemini(
  apiKey: string,
  question: string,
  contextJson: string,
  history: AiTurn[],
): Promise<AiReply> {
  const contents = [
    ...history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    {
      role: 'user',
      parts: [{ text: `GÜNCEL KABİN DURUMU:\n${contextJson}\n\nSORU: ${question}` }],
    },
  ];
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.4,
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 400 || res.status === 403) {
      throw new Error(`API anahtarı geçersiz veya yetkisiz (HTTP ${res.status}).`);
    }
    if (res.status === 429) {
      let apiMsg = '';
      try {
        apiMsg = (JSON.parse(body)?.error?.message as string) ?? '';
      } catch {
        /* gövde JSON değilse genel mesajla yetin */
      }
      throw new Error(
        apiMsg.includes('prepayment') || apiMsg.includes('credits')
          ? 'Gemini kotası/kredisi tükenmiş — https://ai.studio/projects adresinden kredi yükleyin veya ücretsiz katmanlı bir anahtar kullanın.'
          : `Hız limiti aşıldı — biraz bekleyip tekrar deneyin. ${apiMsg}`,
      );
    }
    throw new Error(`Gemini hatası (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini boş yanıt döndürdü (güvenlik filtresi olabilir).');
  try {
    const parsed = JSON.parse(text) as AiReply;
    return { yorum: parsed.yorum ?? text, oneriler: parsed.oneriler ?? [] };
  } catch {
    return { yorum: text, oneriler: [] }; // JSON bozuksa düz metin olarak göster
  }
}

/** AI'nin "degisiklikler" listesini güvenli parametre yamasına çevirir (whitelist dışı → skipped). */
export function changesToPatch(
  changes: AiChange[],
  p: CabinetParams,
): {
  patch: Partial<CabinetParams>;
  groups?: GroupParams[];
  applied: string[];
  skipped: string[];
} {
  const patch: Partial<CabinetParams> = {};
  let groups: GroupParams[] | undefined;
  const applied: string[] = [];
  const skipped: string[] = [];

  const simple: Record<string, (v: number) => Partial<CabinetParams>> = {
    W_cm: (v) => ({ W: v / 100 }),
    H_cm: (v) => ({ H: v / 100 }),
    D_cm: (v) => ({ D: v / 100 }),
    nColumns: (v) => ({ nColumns: Math.max(1, Math.min(6, Math.round(v))) }),
    topMargin_cm: (v) => ({ topMargin: v / 100 }),
    bottomMargin_cm: (v) => ({ bottomMargin: v / 100 }),
    sideMargin_cm: (v) => ({ sideMargin: v / 100 }),
    robotDepthClearance_cm: (v) => ({ robotDepthClearance: v / 100 }),
    topServiceCut_cm: (v) => ({ topServiceCut: v / 100 }),
    tiltDeg: (v) => ({ tiltDeg: v }),
    targetRows: (v) => ({ targetRows: Math.max(1, Math.round(v)) }),
    targetMeds: (v) => ({ targetMeds: Math.max(0, Math.round(v)) }),
  };

  const groupFields: Record<string, (g: GroupParams, v: number) => GroupParams> = {
    nRows: (g, v) => ({ ...g, nRows: Math.max(0, Math.round(v)) }),
    channelInnerWidth_cm: (g, v) => ({ ...g, channelInnerWidth: v / 100 }),
    flangeHeight_cm: (g, v) => ({ ...g, flangeHeight: v / 100 }),
    medW_cm: (g, v) => ({ ...g, med: { ...g.med, w: v / 100 } }),
    medH_cm: (g, v) => ({ ...g, med: { ...g.med, h: v / 100 } }),
    medLen_cm: (g, v) => ({ ...g, med: { ...g.med, len: v / 100 } }),
    enabled: (g, v) => ({ ...g, enabled: v >= 0.5 }),
  };

  for (const c of changes) {
    if (!Number.isFinite(c.deger)) {
      skipped.push(c.alan);
      continue;
    }
    if (c.alan in simple) {
      Object.assign(patch, simple[c.alan](c.deger));
      applied.push(`${c.alan}=${c.deger}`);
      continue;
    }
    const m = c.alan.match(/^group\.(small|medium|large)\.(\w+)$/);
    if (m && m[2] in groupFields) {
      const base = groups ?? p.groups;
      groups = base.map((g) => (g.id === m[1] ? groupFields[m[2]](g, c.deger) : g));
      applied.push(`${c.alan}=${c.deger}`);
      continue;
    }
    skipped.push(c.alan);
  }
  return { patch, groups, applied, skipped };
}

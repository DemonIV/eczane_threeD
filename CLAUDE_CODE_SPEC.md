# EBOT-Benzeri Eczane İlaç Kabini — 3D Parametrik Simülatör

## Claude Code Görev Tanımı (SPEC)

Bu dosya, sıfırdan geliştirilecek bir web tabanlı 3D parametrik eczane robot-kabini
simülatörünün tam mühendislik spesifikasyonudur. Bir önceki prototipte çözülmüş olan
geometri/fizik kısıtları bu belgede kodlanmıştır — **bunları yeniden keşfetme, doğrudan uygula.**

---

## 0. TL;DR — Ne inşa ediyoruz

Servo-motorlu, yerçekimi-beslemeli (gravity-feed) bir eczane ilaç kabininin
gerçek-zamanlı, tarayıcıda çalışan, mobil-öncelikli 3D parametrik simülatörü.
Kullanıcı kabin/raf/eğim/pay ölçülerini canlı değiştirir; sistem **kaç raf, kaç kanal,
kaç ilaç sığdığını**, robot erişim payını ve fizik uygunluğunu anlık hesaplayıp render eder.
Amaç: müşteriye satış/mühendislik sunumu + tasarım doğrulama.

---

## 1. Fiziksel Sistem Tanımı

- **Kabin (dış şasi, varsayılan):** genişlik 4.00 m × yükseklik 2.50 m × derinlik 1.25 m. Hepsi parametrik.
- **Yapı:** alüminyum **sigma profil** iskelet + iç raflar (sigma profil taşıyıcı).
- **Raflar:** her raf, öne (robot/ön yüz tarafına) doğru eğimli bir yerçekimi-besleme kanalı düzlemidir.
  İlaç kutuları raf üzerindeki **kanallara** (dikey ayraçlarla ayrılmış oluklar) arkadan yüklenir,
  yerçekimiyle öne kayar, en öndeki kutu robot tarafından alınır.
- **Tahrik:** servo motorlu **kartezyen robot** — kabin ön yüzeyinde X (yatay) ve Y (dikey)
  eksenlerinde gezer. İlgili kanalın önüne gelir, en öndeki kutuyu serbest bırakır/alır.
- **Teslim akışı:** alınan ilaç → yan haznelere / alt konveyöre düşer → eczacının erişebileceği
  teslim noktasına gider. (İki varyant: alt konveyör bandı VEYA yan teslim haznesi — ikisi de modellenebilir olmalı.)
- **Yerçekimi beslemesi:** rafların eğimi kutuların öne kaymasını sağlamalı. Eğim çok düşükse
  besleme durur (sürtünme), çok yüksekse arka baskı kuvveti mandalı zorlar. Tipik aralık 20–30°.

---

## 2. KRİTİK GEOMETRİ & FİZİK KISITLARI (önceden çözülmüş — birebir uygula)

Bu bölüm pazarlık konusu değil; matematiksel gerçektir. Kod bunları **doğrulama katmanı**
olarak içermeli ve kullanıcı ihlal ettiğinde uyarmalı.

### 2.1 Eğimli kanalın dikey izdüşümü
Derinliği (kanal boyu) `L`, eğimi `α` olan bir kanalın arka ucu, ön ucuna göre şu kadar yükselir:
```
rise = L * sin(α)
```
Örnek: L=1.15 m (kabin derinliği − robot payı), α=27.5° → rise ≈ 0.58 m. Bu, tek bir eğimli
rafın **tek başına** dikeyde ~58 cm yer kaplaması demektir.

### 2.2 Nested (iç içe) raf istifi — TEK GEÇERLİ YÜKSEK KAPASİTE ÇÖZÜMÜ
Raflar bağımsız + aralarında hava boşluğu bırakılırsa, her raf `rise` kadar dikey yer yer ve
kabine sadece ~3 raf sığar. **Bunu YAPMA.** Bunun yerine raflar **iç içe/paralel** dizilir:
üst rafın eğimli tabanı (sigma profil taban levhası), alttakinin flanş üst kenarına oturur.

Her raf bir **sigma/U-kanal ekstrüzyon profili**dir (bkz §2.8, §2.9). Profil kesiti:
taban levhası (kalınlık `t_base`) + üzerinde flanş duvarları (yükseklik `flange_h`).
İlaç, iki flanş arasındaki U-oluğa oturur. Nested istifte AYNI GRUP içindeki ardışık iki rafın
taban levhaları arası dik mesafe = `flange_h + t_base`; dikey izdüşümü efektif pitch'i verir:
```
pitch = (flange_h + t_base) / cos(α)
```
Örnek: flange_h=6 cm, t_base=0.4 cm, α=27.5° → pitch = 6.4/cos27.5° ≈ 7.22 cm.

**NOT — taban levhası kalınlığı MUTLAKA sayılır** (§ Not test vektörlerine bak); ihmal edilirse
kat sayısı iyimser çıkar.

### 2.3 N raf için gereken toplam dikey yükseklik — GRUP-BAZLI (heterojen)
Sistem artık **küçük/orta/büyük** kat gruplarını destekler (§2.9). Her grup `g` kendi profil
kesitine (`sectionHeight_g`) ve dolayısıyla kendi nested pitch'ine sahiptir:
```
pitch_g = sectionHeight_g / cos(α)          // sectionHeight_g = flange_height_g + base_thickness_g
rise    = L * sin(α)                          // L global (kanal boyu), eğim global
```
Toplam istif yüksekliği, grupların dikey toplamı + grup-sınırı geçiş payları + en üst grubun rise'ı:
```
stack_height = Σ_g [ n_g * pitch_g ]  -  pitch_topmost  +  rise_topmost  +  Σ (group_transition_gap)
```
Sadeleştirilmiş güvenli üst-sınır (Claude Code bunu kullansın, sonra rafine etsin):
```
stack_height ≈ Σ_g (n_g * pitch_g) + rise + (n_groups - 1) * transition_gap
```
Bu değer `usable_height`'e sığmalı. Tek-grup özel durumu (n_groups=1) §2.2'ye indirgenir.

**Grup sınırı geçişi (`transition_gap`):** Farklı kesitli iki grup arasında nested binme kırılır
(kesitler uyumsuz). Varsayılan `transition_gap = max(sectionHeight_upper, sectionHeight_lower) * (1/cos α)`
kadar bir güvenli pay; kullanıcı override edebilir. Bu, heterojen istifin gerçek kapasite kaybıdır
ve solver/metriklerde AYRI gösterilmeli.

### 2.3 N raf için gereken toplam dikey yükseklik
```
stack_height(N) = (N - 1) * pitch + rise
                = (N - 1) * (channel_height / cos α) + L * sin α
```
Bu değer `usable_height` içine sığmalı:
```
usable_height = H - top_margin - bottom_margin - top_service_cut
```
Yerleşen maksimum raf:
```
N_max = floor( (usable_height - rise) / pitch ) + 1
```

### 2.4 Kanal sayısı (yatay, genişlik yönü) — sigma profil ekstrüzyonundan
Bir sigma profil, taban levhası üzerinde tekrar eden U-oluklar içerir (Image 2). Yatay adım:
```
channel_pitch_x = channel_inner_width + 2 * flange_thickness   // bir oluktan diğerine
usable_width    = W - 2 * side_margin
column_width    = usable_width / N_columns
channels_per_row = floor( column_width / channel_pitch_x )
```
Örnek: channel_inner_width=6 cm, flange_thickness=0.3 cm → channel_pitch_x=6.6 cm.
column_width=113 cm ise channels_per_row = floor(113/6.6) = 17.
(Bir "raf" = bir sigma profil = channels_per_row adet paralel U-oluk. Raf, kolon genişliğini kaplar.)

### 2.5 Kapasite
```
total_channels = N_rows * channels_per_row * N_columns          // = SKU / ilaç çeşidi
meds_per_channel = floor( L / med_length )
total_meds     = total_channels * meds_per_channel               // = toplam fiziksel stok
```

### 2.6 Robot payı (derinlik ve yükseklikten kısma)
Robot ön yüzeyde gezer ve mandala erişir. İki pay gerekir:
- **Derinlik payı (`robot_depth_clearance`):** robotun kafası + mandal itici mekanizması için
  kabin ön yüzünde bırakılan boşluk. Kanal boyu `L = D - robot_depth_clearance`. Varsayılan ~10 cm.
- **Üst servis payı / erişim (`top_service_cut`):** en üstteki rafın arka ucu (rise kadar yüksek)
  ile tavan arasında robotun ve mekaniğin sığması için gereken pay. DİKKAT: en üst rafın arka ucu
  `front_of_top_row + rise` yüksekliğindedir; bu tavanı aşmamalı. Kod bunu ayrıca kontrol etmeli:
  ```
  top_row_back_y = usable_bottom + (N_rows-1)*pitch + rise
  if (top_row_back_y > H - top_margin)  → UYAR: en üst raf tavanı deliyor
  ```

### 2.7 Bilinen çelişki (kullanıcıya gösterilecek)
"Uzun kanal (L büyük) + yüksek eğim (α) + sık raf (küçük pitch)" üçü aynı anda sağlanamaz.
Kullanıcı 3'ünü birden zorlarsa, sistem hangi kaldıracın ne kadar değişmesi gerektiğini
**sayısal olarak** önermeli (bkz. §4 hedef-çözücü).

### 2.8 Sigma / U-kanal profil geometrisi (raf = profil)
Her raf, alüminyum ekstrüzyon bir **sigma/U-kanal profili**dir (referans: Image 2). Kesit,
taban levhası üzerinde tekrar eden U-oluklardan oluşur. Tam parametrik kesit değişkenleri:

| Değişken | Anlam | Varsayılan |
|---|---|---|
| `channel_inner_width` | Tek U-oluğun iç genişliği (ilaç buraya girer) | 6.0 cm |
| `flange_height`       | Flanş (yan duvar) yüksekliği = kanal iç yüksekliği | 6.0 cm |
| `flange_thickness`    | Flanş duvar et kalınlığı | 0.3 cm |
| `base_thickness` (`t_base`) | Profil taban levhası kalınlığı | 0.4 cm |
| `channels_per_profile`| Bir profildeki paralel oluk sayısı (kolon genişliğinden türetilir, §2.4) | türev |
| `profile_length` (`L`)| Profilin arkadan öne uzunluğu = kanal boyu = `D - robot_depth_clearance` | türev |

Kesit yüksek profili (bir rafın dik yüksekliği) = `base_thickness + flange_height`.
Bu değer §2.2'deki nested pitch'e girer. `channel_inner_width` ilaç enini (≤ inner_width − tolerans),
`flange_height` ilaç yüksekliğini (≤ flange_height − tolerans) sınırlar.

**3D modelleme (CabinetBuilder):** Profil kesiti bir 2D `THREE.Shape` olarak tanımlanıp
`profile_length` boyunca **ExtrudeGeometry** ile üretilmeli (gerçek U-oluk kesiti, kutu-yaklaşımı değil).
Tüm raflar aynı kesittir → geometri bir kez üretilip **InstancedMesh** ile eğim/pozisyon
transformlarıyla çoğaltılmalı. Profil kesiti değişkenleri UI'da "Profil" sekmesinde canlı düzenlenebilir;
kesit değişince Shape yeniden üretilir (throttle).

**Profil kesiti üreten fonksiyon** `core/profile.ts` içinde saf olmalı:
`buildProfileShape(params) → {shape: Point[], sectionHeight, xPitch, channelCount}` — Three.js'siz,
sadece 2D nokta listesi döndürür; SceneManager bunu ExtrudeGeometry'ye çevirir. Böylece kesit
geometrisi de test edilebilir (oluk sayısı, kesit yüksekliği, toplam en doğrulaması).

### 2.9 Kat grupları — küçük / orta / büyük (çoklu profil)
Kabin dikeyde **gruplara** bölünür. Her grup, o gruptaki tüm raflar için ortak bir profil kesiti
ve ilaç boyutu tanımlar. Varsayılan 3 grup (alttan üste veya üstten alta — §sıralama):

| Grup | channel_inner_width | flange_height | ilaç (en×yük×boy) | tipik kullanım |
|---|---|---|---|---|
| **Büyük** | 8.5 cm | 8.5 cm | 7×7×16 cm | şurup, büyük kutu |
| **Orta**  | 6.5 cm | 6.5 cm | 5×5×12 cm | standart kutu |
| **Küçük** | 4.5 cm | 4.5 cm | 3×3×10 cm | blister, küçük kutu |

**Her grup için AYRI ayarlanabilir (UI'da santim bazında):**
`channel_inner_width_g`, `flange_height_g`, `flange_thickness_g`, `base_thickness_g`,
`n_rows_g` (o gruptaki raf sayısı), `med_w_g × med_h_g × med_len_g` (ilaç boyutu),
`enabled_g` (grup aktif mi). `flange_thickness` ve `base_thickness` grup başına override edilebilir
ama varsayılan globalden gelir.

**Veri modeli (`types.ts`):**
```ts
interface GroupParams {
  id: 'small'|'medium'|'large';
  enabled: boolean;
  channelInnerWidth: number;  // m
  flangeHeight: number;       // m
  flangeThickness: number;    // m
  baseThickness: number;      // m
  nRows: number;              // bu gruptaki raf sayısı
  med: { w:number; h:number; len:number }; // m
}
interface CabinetParams {
  W:number; H:number; D:number; nColumns:number;
  topMargin:number; bottomMargin:number; sideMargin:number;
  robotDepthClearance:number; topServiceCut:number;
  tilt:number;                // global eğim (rad veya deg — tek yerde tanımla)
  groups: GroupParams[];      // sıralı: dizi sırası = alttan üste yerleşim
  transitionGap:number;       // grup sınırı payı (override edilebilir)
  delivery:'side_bin'|'conveyor';
}
```

**Kapasite (grup-bazlı):**
```
Her grup g için:
  channels_per_row_g = floor(column_width / (channel_inner_width_g + 2*flange_thickness_g))
  meds_per_channel_g = floor(L / med_len_g)
  group_channels_g   = n_rows_g * channels_per_row_g * n_columns
  group_meds_g       = group_channels_g * meds_per_channel_g
Toplam:
  total_channels = Σ_g group_channels_g
  total_meds     = Σ_g group_meds_g
```
Metrikler hem **toplam** hem **grup kırılımı** göstermeli (Büyük: X kanal / Y ilaç, ...).

**Validasyon (grup başına):** `med_w_g ≤ channel_inner_width_g − tol`, `med_h_g ≤ flange_height_g − tol`,
`med_len_g ≤ L`. İhlalde o grup kırmızı + neden. Ayrıca Σ n_rows_g rafın §2.3 stack_height'ı
usable_height'e sığmalı; sığmıyorsa solver (§4) grup bazında da öneri üretmeli
("Küçük gruptan 3 raf çıkar" / "Büyük grubun flanşını 8→7 cm yap").

**Sıralama:** `groups` dizi sırası fiziksel alt→üst yerleşimdir. Varsayılan: Büyük (alt) → Orta → Küçük (üst).
Gerekçe: ağır/büyük kutular altta (düşük ağırlık merkezi, stabilite); ancak robot erişim ergonomisi
farklı isterse UI'dan sıra değiştirilebilir (drag-reorder). Eğim global olduğundan sıralama
gravity-feed'i etkilemez, sadece erişim/stabiliteyi.

---

## 3. Teknik Mimari

### 3.1 Stack
- **Saf frontend, build-tool'suz** başlanabilir (tek `index.html` + yerel `three.min.js`),
  ANCAK Claude Code bunu **Vite + TypeScript + modüler mimariye** yükseltmeli. Gerekçe:
  fizik/geometri katmanı test edilebilir olmalı, tek dosya sürdürülemez.
- **3D:** Three.js (r160+ ESM). OrbitControls ESM importuyla (r128 hack'lerine gerek yok).
- **Dağıtım:** Render.com static site (Vite `dist/` publish). `render.yaml` dahil et.
- **Mobil:** birinci sınıf. `touch-action: none`, pointer events, pinch-zoom, düşük-poli/InstancedMesh.

### 3.2 Katmanlar (kesin ayrım)
```
src/
  core/
    geometry.ts      // saf fonksiyonlar: stackHeight, nMax, channels, capacity, riseCheck
    profile.ts       // sigma/U-kanal kesiti: buildProfileShape → 2D nokta listesi (§2.8)
    solver.ts        // hedef-çözücü: "25 raf için ne değişmeli" (bkz §4)
    validate.ts      // fizik ihlali tespiti + insan-okur uyarılar
    types.ts         // CabinetParams, ProfileParams, ShelfParams, Capacity, Diagnostics
  scene/
    SceneManager.ts  // renderer, kamera, ışık, gölge, resize, kontrol
    CabinetBuilder.ts// sigma profil şasi + raflar (ExtrudeGeometry U-kesit) + kutular (InstancedMesh)
    RobotRig.ts      // kartezyen X-Y robot + dispense animasyonu (servo hareketi)
    Delivery.ts      // konveyör VEYA yan hazne teslim varyantı
  ui/
    Controls.ts      // parametrik paneller (sekmeler), hedef paneli
    Metrics.ts       // canlı metrik/diagnostic gösterimi
  main.ts
```
**`core/` Three.js'e bağımlı olmamalı** — saf, test edilebilir, headless çalışır. Vitest ile
§2 formüllerinin birim testleri yazılmalı (özellikle §2.3 ve §2.6 sınır durumları).

### 3.3 Performans
- Kutular ve kanal ayraçları **InstancedMesh** ile çizilmeli. Bir kabin kolayca
  25 raf × ~23 kanal × 3 kolon × ~12 kutu ≈ 20.000 mesh üretebilir; ayrı mesh = mobilde ölüm.
  Instancing ile tek draw-call'a indir.
- Parametre değişiminde tüm sahneyi yeniden kurma; sadece etkilenen instanced buffer'ları güncelle
  (debounce 16–32 ms). Geometri hesabı (`core/`) her frame değil, input'ta çalışsın.

---

## 4. Hedef-Çözücü (satış sunumunun kalbi)

Kullanıcı bir hedef girer (örn. "25 raf" veya "≥1500 ilaç"). Solver, mevcut ölçülerle hedefe
ulaşılıp ulaşılmadığını söyler; ulaşılamıyorsa **her serbest değişken için gereken tek-değişkenli
düzeltmeyi** hesaplar ve listeler:
- top/bottom/side margin'lardan kaç cm kısılmalı,
- kanal derinliği (L) kaç cm'e inmeli,
- eğim (α) kaç dereceye inmeli (sayısal tarama; pitch ve rise ikisi de α'ya bağlı),
- channel_height kaç cm'e inmeli.
Her öneri için **yan etkiyi** de belirt (örn. "L↓ → ilaç/kanal düşer → toplam stok −X%").
Uygulanabilir önerilere "Uygula" butonu koy (tek tıkla parametreyi set etsin).

---

## 5. UI / UX Gereksinimleri

- **Mobil-öncelikli**, tek ekran. Üstte 3D viewport, altında sekmeli paneller:
  **Kabin** (W/H/D, kolon sayısı, teslim tipi) · **Paylar** (üst/alt/yan/robot derinlik payı/üst servis/geçiş payı) ·
  **Gruplar** (küçük/orta/büyük — her biri katlanır kart) · **Global** (eğim°, robot hızı).
- **Gruplar sekmesi (kritik):** Küçük/Orta/Büyük için ayrı katlanabilir kartlar. Her kartta o gruba özel,
  **santim bazında** sliderlar + sayısal girişler: kanal iç genişliği, flanş yüksekliği, flanş kalınlığı,
  taban kalınlığı, raf sayısı (n_rows), ilaç en×yükseklik×boy, grup aç/kapa. Kartta anlık grup kapasitesi
  (kanal/ilaç) ve mini kesit SVG önizlemesi. Gruplar drag ile yeniden sıralanabilir (alt→üst).
- **Profil kesit önizleme:** Her grup kartında, seçili kesitin 2D SVG önizlemesi (U-oluklar, ölçüler,
  içine yerleşen ilaç silüeti) — Image 2 tarzı ölçülü çizim. İhlalde (ilaç sığmıyor) kırmızı.
- **Hedef paneli:** hedef raf/ilaç sayısı girişi + anlık ✓/✗ durum + eksik cm + çözücü önerileri.
- **Canlı metrikler:** sığan raf, kanal/raf, toplam kanal (SKU), toplam ilaç, robot payı,
  nested pitch, arka yükseliş, en-üst-raf-tavan kontrolü.
- **Kamera preset butonları:** Önden / Yandan (nested istifi görmek kritik) / Perspektif / İzometrik.
- **Robot animasyonu:** "İlaç getir" → robot doğru kanala X-Y hareket → mandal → kutu düşer →
  teslim noktasına akar. Hareket servo hızı parametresiyle ölçeklensin.
- **Sunum modu:** ölçü çizgileri (dimension lines) ve etiketler açılıp kapanabilsin; ekran görüntüsü
  / kısa döngü için temiz görünüm.
- Renk/uyarı: fizik ihlalinde ilgili metrik kırmızı + neden.

---

## 6. Varsayılan Parametreler (ilk açılış)
```
W=4.00 m, H=2.50 m, D=1.25 m, N_columns=3
top_margin=0.30, bottom_margin=0.30, side_margin=0.30   // müşteri örneği: yanlardan/yukarıdan 30 cm
robot_depth_clearance=0.10, top_service_cut=0.05, transition_gap=auto
tilt α=25°                                               // müşteri örneği: 25 derece, GLOBAL
delivery = side_bin                                      // yan hazne (konveyör alternatifi seçilebilir)

// KAT GRUPLARI (§2.9) — alttan üste sıralı. Her grup santim bazında ayrı ayarlanır.
groups (bottom→top):
  Büyük:  inner_w=8.5cm, flange_h=8.5cm, flange_t=0.3cm, base_t=0.4cm, n_rows=6,  med=7×7×16cm
  Orta:   inner_w=6.5cm, flange_h=6.5cm, flange_t=0.3cm, base_t=0.4cm, n_rows=9,  med=5×5×12cm
  Küçük:  inner_w=4.5cm, flange_h=4.5cm, flange_t=0.3cm, base_t=0.4cm, n_rows=10, med=3×3×10cm

// açılışta hesaplanır: her grubun pitch_g, channels_per_row_g, kapasitesi + toplam.
// hedef: total_rows = Σ n_rows_g = 25 (6+9+10). Solver 25'e sığıp sığmadığını gösterir.
target_rows = 25   // gruplar toplamı; grup başına hedef de girilebilir
```
Bu varsayılanlarla açılışta §2–§4'ün tümü hesaplanıp gösterilmeli; 25 rafın sığıp sığmadığı
ve sığmıyorsa çözücü önerileri ekranda olmalı.

---

## 7. Kabul Kriterleri
1. `core/` fonksiyonları Three.js'siz, saf ve Vitest ile test edilmiş (§2 formülleri + sınır durumları).
2. Parametre değişimi <32 ms'de 3D + metrik güncelliyor; 20k+ kutu InstancedMesh ile 60 fps hedefi.
3. Mobil (gerçek telefon Chrome/Safari): 1 parmak döndürme, 2 parmak pinch-zoom + pan, butonlar çalışıyor.
4. Hedef-çözücü, sığmayan senaryoda her kaldıraç için sayısal düzeltme + yan etki + "Uygula" veriyor.
5. En-üst-raf-tavan ihlali (§2.6) doğru tespit ediliyor ve uyarılıyor.
6. `npm run build` → Render.com static deploy çalışır; `render.yaml` mevcut.
7. Kod modüler, tipli, yorumlu; geometri katmanı UI'dan tamamen ayrık.

---

## 8. Yol Haritası (Claude Code bu sırayla ilerlesin)
1. Repo iskeleti + Vite+TS + Vitest + `render.yaml`.
2. `core/` (geometry, solver, validate, types) + testler. **Önce burası, UI'dan önce.**
3. `SceneManager` + boş kabin şasi (sigma profil) + kamera/kontrol (mobil dahil).
4. `CabinetBuilder`: nested eğimli raflar + kanallar (InstancedMesh) + kutular.
5. `ui/`: paneller + metrikler + hedef paneli, `core`'a bağlanır.
6. `RobotRig` + `Delivery` + animasyon.
7. Sunum modu (dimension lines) + cila + performans profili.
8. Deploy.

---

## 9. Açık Sorular (Claude Code başlarken kullanıcıya sormalı)
**Karar verilmiş — sormadan uygula:**
- **Eğim GLOBAL, tek α.** Grup başına farklı eğim YOK (bu sürümde). `rise = L·sin(α)` tüm gruplar için
  ortaktır; §2.3 stack matematiği bunu varsayar. İleride grup-eğimi gerekirse ayrı sürüm.

**Kullanıcıya sorulacak (varsayılanla ilerle, onay al):**
- Teslim: yan hazne mi, alt konveyör mü, ikisi de seçilebilir mi? (varsayılan: yan hazne — Image 1'de
  robot ortada dikey kolonda; teslim yana/alta olabilir.)
- Robot topolojisi: tek kartezyen (Image 1: tek dikey Y-kolon + üstte X-gantry) varsayılan; onayla.
- Grup sıralaması: Büyük altta (varsayılan, stabilite) mı, erişim ergonomisine göre farklı mı?
- `transition_gap`: auto (= maxSectionHeight/cos α) varsayılan; override gerekli mi?

## 10. Referans görseller (repoda `docs/` altına koy)
- **Image 1 (teknik çizim, yan+üst görünüş):** nested eğimli raf istifini, ortadaki dikey robot
  kolonunu (Y ekseni) ve üstteki gantry'yi (X ekseni) DOĞRULAR. RobotRig bu topolojiyi izlemeli:
  ortada dikey taşıyıcı kolon, tavanda yatay gantry kirişi, kolon boyunca gezen kafa.
  Sağdaki "100× Tepsi Yüksekliği" ve "Dikey Çekmece" detayları nested profil kesitini gösterir.
- **Image 2 (profil kesiti, izometrik):** sigma/U-kanal ekstrüzyonu — taban levhası + paralel U-oluklar.
  `channel_inner_width=6cm`, `flange_height=6cm`. CabinetBuilder'ın ExtrudeGeometry kesiti buna birebir
  benzemeli (kutu-yaklaşımı DEĞİL, gerçek U-oluk profili).
```
```

---

### Not — Doğrulanmış sayısal test vektörleri (solver/geometry birim testleri için)

**Tek-profil (homojen) — sectionHeight=6.4cm, rdc=10cm:**

| Senaryo | usableH | L | rise | pitch | **N_rows** |
|---|---|---|---|---|---|
| pay30/30/5, D1.25, 25° | 185cm | 115cm | 49cm | 7.06cm | **20** |
| pay40/25/5, D1.25, 27.5° | 180cm | 115cm | 53cm | 7.22cm | **18** |
| pay15/15/0, D0.9, 25° | 220cm | 80cm | 34cm | 7.06cm | **27** |
| (taban ihmal → yanlış) pay30/30/5, D1.25, 25° | 185 | 115 | 49 | 6.62 | 21 (İYİMSER, HATALI) |

**Grup-bazlı (heterojen) — Büyük(8.5/8.5)+Orta(6.5/6.5)+Küçük(4.5/4.5), base=0.4cm:**

| Senaryo | Gerekli istif | usableH | **Sığar?** | Toplam kanal | Toplam ilaç |
|---|---|---|---|---|---|
| n=6/9/10 (=25 raf), pay30/30/5, D1.25, 25° | **250cm** | 185cm | ✗ HAYIR | 1281 | 12.417 |
| Grup pitch'leri: Büyük 9.82cm · Orta 7.61cm · Küçük 5.41cm | | | | | |
| n=6/9/10, pay15/15/0, D0.95, 25° | 237cm | 220cm | ✗ hâlâ hayır | — | 9.195 |

**KRİTİK DERS (solver ve UI bunu açıkça göstermeli):** Heterojen gruplar, büyük grubun yüksek
pitch'i (9.82 cm) yüzünden homojen modelden ÇOK daha fazla dikey yer kaplar. "6 büyük + 9 orta +
10 küçük = 25 raf" varsayılanı 250 cm ister ama 185 cm vardır → **sığmaz**. Solver bunu tespit edip
grup bazında öneri üretmeli: "Büyük grubu 6→3 raf indir" veya "flanş yüksekliklerini azalt" veya
"eğimi düşür". Bu, satış sunumunun en öğretici anıdır: müşteri gruplar arası trade-off'u canlı görür.

**Grup kapasite kırılımı (n=6/9/10 senaryosu, referans):**
Büyük: 12 kanal/raf × 6 = 216 kanal, 1.512 ilaç · Orta: 15×9 = 405 kanal, 3.645 ilaç ·
Küçük: 22×10 = 660 kanal, 7.260 ilaç. Toplam 1.281 SKU / 12.417 ilaç.

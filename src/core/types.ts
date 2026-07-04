// Veri modeli — SPEC §2.9
// Tüm uzunluklar METRE, eğim DERECE (tek yerde tanım: CabinetParams.tiltDeg).

export type GroupId = 'small' | 'medium' | 'large';

export interface MedSize {
  w: number; // en (m)
  h: number; // yükseklik (m)
  len: number; // boy / kanal yönü (m)
}

export interface GroupParams {
  id: GroupId;
  label: string;
  enabled: boolean;
  channelInnerWidth: number; // m — U-oluk iç genişliği
  flangeHeight: number; // m — flanş (yan duvar) yüksekliği
  flangeThickness: number; // m — flanş et kalınlığı
  baseThickness: number; // m — taban levhası kalınlığı
  nRows: number; // bu gruptaki raf sayısı
  med: MedSize;
  color: number; // 0xRRGGBB — render/önizleme rengi
}

export type DeliveryKind = 'side_bin' | 'conveyor';

export type ColumnMode = 'equal' | 'custom';

export interface CabinetParams {
  W: number; // m
  H: number; // m
  D: number; // m
  nColumns: number;
  /** equal = kullanılabilir genişlik eşit bölünür; custom = ilk n-1 kolon elle, son kolon kalan. */
  columnMode: ColumnMode;
  /** m — custom modda ilk (nColumns-1) değer kullanılır; eksikse eşit pay varsayılır. */
  columnWidths: number[];
  topMargin: number; // m
  bottomMargin: number; // m
  sideMargin: number; // m
  robotDepthClearance: number; // m — kanal boyu L = D - bu
  topServiceCut: number; // m — üst servis payı
  tiltDeg: number; // GLOBAL eğim α (derece)
  groups: GroupParams[]; // dizi sırası = alttan üste fiziksel yerleşim
  transitionGapOverride: number | null; // m; null = auto (maxSection/cosα)
  delivery: DeliveryKind;
  robotSpeed: number; // m/s — servo hız (animasyon ölçeği)
  targetRows: number; // hedef toplam raf
  targetMeds: number; // hedef toplam ilaç
}

// ---- Türetilmiş değerler ----

export interface GroupDerived {
  id: GroupId;
  label: string;
  enabled: boolean;
  nRows: number;
  sectionHeight: number; // m — flangeHeight + baseThickness
  pitch: number; // m — sectionHeight / cosα (nested dikey adım)
  xPitch: number; // m — channelInnerWidth + 2*flangeThickness
  channelsPerColumn: number[]; // kolon başına oluk sayısı (kolon genişliği farklıysa farklı)
  rowChannels: number; // bir kat seviyesindeki toplam oluk = Σ channelsPerColumn
  medsPerChannel: number; // floor(L / med.len)
  channels: number; // nRows * rowChannels
  meds: number; // channels * medsPerChannel
  stackShare: number; // m — nRows * pitch (istifteki dikey pay)
}

export interface ShelfPlacement {
  groupIndex: number; // params.groups içindeki indeks
  groupId: GroupId;
  rowIndex: number; // grup içi sıra (0 = en alt)
  frontY: number; // m — raf ön ucu taban yüksekliği (zeminden)
}

export interface Derived {
  L: number; // m — kanal boyu
  rise: number; // m — L * sinα
  usableHeight: number; // m
  usableWidth: number; // m
  columnWidth: number; // m — ortalama (uW/n); önizleme/geri-uyumluluk için
  columnWidths: number[]; // m — her kolonun gerçek genişliği (equal modda hepsi eşit)
  columnLefts: number[]; // m — her kolonun sol kenarının x konumu (kabin merkezine göre)
  transitionGap: number; // m — grup sınırı geçiş payı (auto veya override)
  cosTilt: number;
  sinTilt: number;
  groups: GroupDerived[]; // params.groups ile aynı sırada (devre dışı olanlar dahil)
  totalRows: number;
  totalChannels: number;
  totalMeds: number;
  stackHeight: number; // m — sadeleştirilmiş güvenli üst-sınır (SPEC §2.3, sığma kontrolü)
  stackHeightExact: number; // m — fiziksel yerleşim yüksekliği (render)
  fits: boolean; // stackHeight <= usableHeight
  deficit: number; // m — sığmıyorsa eksik yükseklik (>0), sığıyorsa 0
  shelves: ShelfPlacement[]; // alttan üste tüm raflar (yalnız aktif gruplar)
  topRowBackY: number; // m — en üst rafın arka ucu (zeminden)
  ceilingLimit: number; // m — H - topMargin - topServiceCut
  ceilingViolation: boolean; // SPEC §2.6 en-üst-raf-tavan kontrolü
}

// ---- Diagnostik ----

export type DiagLevel = 'ok' | 'warn' | 'error';

export interface Diagnostic {
  level: DiagLevel;
  code: string;
  message: string; // insan-okur (TR)
  groupId?: GroupId;
}

// ---- Profil kesiti (SPEC §2.8) ----

export interface Pt2 {
  x: number;
  y: number;
}

export interface ProfileSection {
  points: Pt2[]; // kapalı poligon (saat yönü tersine), Three.js'siz
  sectionHeight: number; // m
  xPitch: number; // m
  channelCount: number;
  totalWidth: number; // m — channelCount * xPitch
}

// ---- Hedef-çözücü (SPEC §4) ----

export interface Suggestion {
  id: string;
  label: string; // kısa başlık ("Eğimi 25°→21.3° düşür")
  detail: string; // sayısal açıklama
  sideEffect: string; // yan etki
  /** Uygulanabilirse parametre yaması; değilse null (öneri yine listelenir). */
  patch: Partial<CabinetParams> | null;
  /** Grup değişikliği gerektiren yamalar için: groups dizisinin tamamı. */
  groupsPatch?: GroupParams[];
}

export interface SolverReport {
  rowsConfigured: number;
  rowsTarget: number;
  rowsTargetMet: boolean; // yapılandırılan raflar sığıyor VE hedefi karşılıyor
  stackFits: boolean;
  deficitCm: number; // sığmama açığı (cm, 0 = sığıyor)
  medsCurrent: number;
  medsTarget: number;
  medsTargetMet: boolean;
  medsDeficit: number;
  suggestions: Suggestion[]; // sığmama durumunda kaldıraç önerileri
}

# invoice-llm-benchmark — Kullanım ve Geliştirme Rehberi

Bu dosya projeyi devralan kişi için yazıldı. Kurulumdan başlayıp "yeni bir model nasıl
eklenir", "puanlama nasıl hesaplanır", "bir şey bozulursa nereye bakılır" sorularına kadar
her şeyi içerir.

Kısa tanıtım ve kurulum özeti için [README.md](README.md).

---

## İçindekiler

1. [15 dakikada ilk test](#1-15-dakikada-ilk-test)
2. [Çalışma mantığı](#2-çalışma-mantığı)
3. [Çıkarılan alanlar ve puanlama](#3-çıkarılan-alanlar-ve-puanlama)
4. [Test seti](#4-test-seti)
5. [Arayüzün kullanımı](#5-arayüzün-kullanımı)
6. [Raporlar](#6-raporlar)
7. [Yeni model ve sağlayıcı ekleme](#7-yeni-model-ve-sağlayıcı-ekleme)
8. [Model parametreleri](#8-model-parametreleri)
9. [Prompt'u değiştirme](#9-promptu-değiştirme)
10. [Mimari](#10-mimari)
11. [Sorun giderme](#11-sorun-giderme)
12. [Bilinen sınırlar ve yol haritası](#12-bilinen-sınırlar-ve-yol-haritası)
13. [Devir teslim kontrol listesi](#13-devir-teslim-kontrol-listesi)

---

## 1. 15 dakikada ilk test

### Kurulum

Gereksinim: Node.js 20.9+ (`.nvmrc` → 22). Başka hiçbir şey gerekmiyor.

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local` içine elinizdeki anahtarları yazın. Tek anahtar bile yeter; anahtarı olmayan
sağlayıcıların modelleri arayüzde "anahtar yok" rozetiyle pasif görünür, hata vermez.

> `.env.local` **asla** depoya girmez (`.gitignore` içinde). Anahtarlarınızı ekip arkadaşınıza
> Git üzerinden değil, kurumsal parola yöneticisi üzerinden aktarın.

Uygulama: **http://localhost:4123**

### Kurulumu doğrulama — API harcamadan

```
http://localhost:4123/api/selftest
```

21 kontrol çalışır: JSON ayrıştırma, markdown temizliği, Türkçe tarih/sayı normalizasyonu,
puanlama mantığı, açıklama alanının puanlanmadığı, tür sözlüğü, toplu test özeti, maliyet
hesabı, anahtar maskeleme, Gemini şema dönüşümü ve test setinin yüklenmesi.
`{"passed":21,"total":21,"failed":[]}` görüyorsanız kurulum sağlam.

**Kod değiştirdiğinizde önce buraya bakın.** Bir sayı bile tutmuyorsa hangi kontrolün
düştüğü `failed` dizisinde yazar.

### İlk gerçek test

1. **Toplu Test** sekmesine geçin.
2. Anahtarı olan bir model seçin (öneri: Gemini 2.5 Flash veya Claude Haiku 4.5).
3. Belge olarak `market` kategorisini seçin (7 belge — ucuz bir ilk tur).
4. Hız limiti panelindeki öneriyi olduğu gibi bırakın.
5. **Toplu testi başlat** → rapor birkaç dakikada dolar.

Sonra aynı seti başka bir modelle çalıştırıp iki raporun CSV'sini yan yana koyun.

---

## 2. Çalışma mantığı

Bir belgenin izlediği yol:

```
Görsel (base64)
   │
   ├─ /api/extract  ─ modelId + görsel
   │
   ├─ config.ts      → models.json + prompt.txt okunur, .env'den anahtar çözülür
   │                   (anahtar yalnızca sunucuda; istemciye asla gitmez)
   │
   ├─ providers/*    → sağlayıcının protokolüne uygun istek gövdesi kurulur
   │                   (temperature 0, token limiti, yapısal çıktı, model.extra)
   │                   geçici hatada üstel bekleme ile 3 deneme
   │
   ├─ normalize.ts   → dönen ham metinden JSON çıkarılır ve 6 alana oturtulur
   │                   yapılan her düzeltme "uyarı" olarak kaydedilir
   │
   ├─ cost.ts        → sağlayıcının raporladığı token × models.json fiyatı
   │
   └─ compare.ts     → ground-truth ile hoşgörülü karşılaştırma → puan
```

Tasarımın üç taşıyıcı fikri:

**1. Konfigürasyon tek gerçek kaynağı.** Model listesi, fiyatlar, hız limitleri ve prompt
kod içinde değil `config/` altında. Yeni model eklemek kod değişikliği değil, JSON
değişikliğidir. Geliştirme modunda dosya değişince otomatik yeniden okunur.

**2. Adaptörler ince, ortak katman kalın.** Sağlayıcıya özgü olan tek şey istek/yanıt
biçimi. Normalizasyon, maliyet, karşılaştırma ve raporlama tüm sağlayıcılar için aynı kodu
kullanır — böylece karşılaştırma adil olur.

**3. Model çıktısı asla "temiz" varsayılmaz.** `json_schema` destekleyen modellerde bile
normalize katmanı çalışır. Hiçbir düzeltme gerekmezse uyarı üretmez; bu sayede "hangi model
ham haliyle üretime daha yakın" sorusu da ölçülebilir hale gelir.

### Neden şema bu kadar katı?

`src/lib/schema.ts` içindeki şemada **nullable alan yok**, altı alan da zorunlu ve tekil
tipte. Sebebi: OpenAI strict mode, Anthropic structured outputs ve Gemini `responseSchema`
farklı JSON Schema alt kümelerini destekliyor. Ortak paydada kalınca **aynı şema üç
sağlayıcıda da değiştirilmeden** çalışıyor. Model okuyamadığı alana `""` (veya tutarda `0`)
yazar; prompt bunu açıkça söyler.

`tur` alanı `enum`. Serbest metin olsaydı "fatura" / "E-Fatura" / "Satış Faturası"
varyasyonları karşılaştırmayı anlamsız kılardı.

---

## 3. Çıkarılan alanlar ve puanlama

| Alan | Açıklama | Puanlanır mı? |
|---|---|---|
| `tarih` | Belgenin **düzenlenme** tarihi, `YYYY-MM-DD` | ✅ |
| `fatura_no` | Fatura / belge / fiş numarası | ✅ |
| `sirket_adi` | Belgeyi **düzenleyen** (satıcı) taraf | ✅ |
| `toplam_tutar` | Ödenecek genel toplam, sayı | ✅ |
| `tur` | Belge türü, sabit sözlükten | ✅ |
| `aciklama` | Belgenin ne için düzenlendiği, kısa serbest metin | ❌ |

Tür sözlüğü (`src/lib/schema.ts` → `BELGE_TURLERI`):
Market Fişi · E-Arşiv Fatura · e-Fatura · Abonelik Faturası · Fatura · Proforma Fatura ·
Teklif · POS Slip · İrsaliye · Serbest Meslek Makbuzu · Gider Pusulası · Diğer

> **`aciklama` neden puanlanmıyor?** Serbest metinde tek bir doğru cevap yoktur:
> "İnternet abonelik bedeli" ile "İnternet faturası" aynı derecede doğrudur. Birebir eşleşme
> aramak skoru gerçek okuma hatalarından uzaklaştırırdı. Alan yine isteniyor (modelin belgeyi
> anlamlandırdığını görmek değerli) ama raporda **bilgi** olarak gösteriliyor ve kaç belgede
> doldurulduğu ayrıca sayılıyor. Puanlanmayan alanların listesi tek yerde:
> `src/lib/schema.ts` → `UNSCORED_FIELDS`.

### Alan sonuçları

| Sonuç | Anlamı |
|---|---|
| **doğru** | Referansla (veya kabul edilen alternatiflerinden biriyle) eşleşti |
| **yanlış** | Referans var, model farklı bir değer yazdı |
| **eksik** | Referans var, model boş bıraktı |
| **uydurma** | Referansta alan `null` (belgede yok) ama model bir değer üretti |
| **bilgi** | Puanlanmayan alan (`aciklama`) |
| **—** | Referansta alan yok ve model de boş bıraktı (doğru davranış, puana girmez) |

**Doğruluk = doğru / (doğru + yanlış + eksik).** Uydurma bu paydaya girmez, ayrı raporlanır.
Bir belgede en fazla 5 puanlanabilir alan vardır.

Bu ayrım bilinçli: doğruluğu yüksek ama halüsinasyon eğilimi olan bir model, doğruluk oranına
bakarak fark edilemez. `web-10` (boş şablon) ve `efatura-08` (satıcı adı belgede yok) gibi
örnekler tam da bunu ölçmek için sette.

### Karşılaştırma toleransı

Ölçtüğümüz şey yazım farkı değil, gerçek okuma hatası:

| Alan | Tolerans |
|---|---|
| `tarih` | ISO'ya normalize edildikten sonra tam eşitlik |
| `fatura_no` | Baştaki sıfırlar, boşluk, büyük/küçük harf yok sayılır (`0037` = `37`) |
| `sirket_adi` | Türkçe karakterler + ünvan ekleri (A.Ş., Ltd. Şti., San., Tic.) sadeleştirilir; biri diğerini içeriyorsa doğru sayılır |
| `toplam_tutar` | ±0,005 (kuruş yuvarlaması) |
| `tur` | Sözlüğe oturtulmuş değerle eşitlik (büyük/küçük harf ve Türkçe karakter toleranslı) |

Ayrıca her alan için `ground-truth.json` içinde **alternatifler** tanımlanabilir; belgede
gerçekten iki makul cevap varsa (ör. logo bir firmayı, adres bloğu başka firmayı gösteriyorsa)
ikisi de doğru sayılır.

---

## 4. Test seti

`testset/images/` altında **25 belge**, referansları `testset/ground-truth.json` içinde.

| Grup | Adet | İçerik |
|---|---|---|
| `market-01…07` | 7 | Telefonla çekilmiş buruşuk/eğik/yan yatmış fişler: BİM & A101 e-arşiv faturaları, yazarkasa fişleri, bir POS slibi |
| `web-01…10` | 10 | Düzgün taranmış proforma faturalar, teklifler, ticari faturalar |
| `efatura-01…08` | 8 | Kurumsal e-Fatura / e-Arşiv çıktıları (GİB temel & ticari senaryo) ve elektrik / su / doğalgaz faturaları |

### Setteki tuzaklar

- `market-01` — POS slibi; **fatura numarası yok**. Model işyeri/onay numarasını fatura no sanarsa *uydurma*.
- `market-03` — A101 "bilgi fişi" ama üzerinde *E-Arşiv Fatura* yazıyor; tür ayrımı.
- `market-04` — çok buruşuk ve lekeli; setin en zor OCR örneği.
- `web-05` — satıcı üst bilgide, alıcı gövde başlığında; model alıcıyı yazarsa hata.
- `web-06` — teklif belgesi, **numarası yok**.
- `web-08` / `web-09` — **aynı fatura numarası** (PF-2024-001), farklı firmalar.
- `web-10` — boş şablon: "Tarih:" ve "Fatura No:" etiketleri var, karşıları **boş**.
- `efatura-01` — logo bir firmaya, adres bloğu başka firmaya ait; ikisi de kabul edilir.
- `efatura-03` — e-belge görüntüleyici **ekran görüntüsü**: pencere çerçevesi ve düğmeler belge verisi değil.
- `efatura-04` — "Fatura No" etiketi var, **karşısı boş**; ayrıca çok küçük tutar (2,36).
- `efatura-05` — **İrsaliye No, fatura numarasıyla aynı**.
- `efatura-06` — 2002 tarihli **nokta vuruşlu** doğalgaz faturası; binlik ayırıcı virgül (`45,750,000`), eski TL.
- `efatura-07` — su faturası; sayfada **blog filigranı** var, şirket adı sanılmamalı.
- `efatura-08` — üstü kesilmiş elektrik faturası: **satıcı adı belgede yok**, isim yazarsa *uydurma*.

### Yeni örnek ekleme

1. Görseli `testset/images/` içine koyun (JPEG / PNG / WebP / GIF).
2. `testset/ground-truth.json` → `items` altına **aynı dosya adıyla** kayıt ekleyin:

```json
"market-08.jpeg": {
  "kategori": "market",
  "not": "İnsan için açıklama; karşılaştırmada kullanılmaz.",
  "tarih": "2026-03-07",
  "fatura_no": null,
  "sirket_adi": "Örnek Market A.Ş.",
  "toplam_tutar": 1234.56,
  "tur": "Market Fişi",
  "aciklama": "Market alışverişi",
  "alternatifler": { "sirket_adi": ["ORNEK MARKET", "Örnek Market"] }
}
```

- **`null` = alan belgede gerçekten yok.** Skora girmez; model değer yazarsa *uydurma* sayılır.
  Alanı okuyamadığınız için değil, belgede **olmadığı** için `null` yazın.
- `kategori` arayüzdeki gruplama düğmelerini oluşturur; yeni bir isim yazarsanız yeni grup açılır.
- `aciklama` puanlanmadığı için buradaki değer sadece insan içindir.
- Sunucuyu yeniden başlatmak gerekmez.

Referansı olmayan görseller de listelenir, sadece puanlanmaz ("referans yok" rozeti).

> **Kişisel veri uyarısı.** Test setine gerçek fatura koyarken üzerindeki ad, adres, TCKN,
> abone numarası gibi bilgileri kontrol edin. Depo şu an private; public'e çevrilirse bu
> görseller de herkese açık olur.

---

## 5. Arayüzün kullanımı

### Tekli Test (`/`)

| Adım | Ne yapılır |
|---|---|
| **1 · Fatura görseli** | Sürükle-bırak, tıkla-seç veya **Ctrl+V** ile yapıştır. JPEG/PNG/WebP/GIF, maks. 15 MB. |
| **2 · Modeller** | Karşılaştırmak istediklerinizi işaretleyin. "Anahtarı olanların hepsi" ile tek tıkla seçin. |
| **3 · Çalıştır** | Tüm modeller **paralel** çağrılır; her kart bittiği anda dolar. |
| **4 · Doğrula** | Her modelin çıktısı düzenlenebilir bir formda gelir (human-in-the-loop). Düzelttiğiniz alanlar sarı kenarlıkla işaretlenir. |
| **5 · Puanla** | Doğru değerleri **Referans değerler** panosuna yazın (veya bir sonucun üstündeki *Referans kabul et* düğmesini kullanın). Boş bıraktığınız alanlar puanlamaya girmez. |
| **6 · Dışa aktar** | Karşılaştırma tablosundan **CSV indir**. |

### Toplu Test (`/toplu`)

| Adım | Ne yapılır |
|---|---|
| **1 · Model** | Tek model seçilir. Yanındaki `rpm` rozeti dakikalık istek limitini gösterir. |
| **2 · Faturalar** | **Test seti**nden seçin (kategori düğmeleriyle toplu seçim) veya **Kendi dosyalarım** ile görsel yükleyin. Yüklediğiniz dosyanın adı ground-truth'ta varsa otomatik puanlanır. |
| **3 · Hız limiti** | Belgeler arası bekleme (aşağıya bakın). |
| **4 · Çalıştır** | Belgeler **sırayla** gönderilir; ilerleme ve geri sayım canlı akar. *Durdur* ile yarıda kesebilirsiniz, o ana kadarki sonuçlar korunur. |
| **5 · Rapor** | Özet kartları + alan bazlı hata dökümü + belge tablosu. Satıra tıklayınca görsel, alan karşılaştırması ve ham istek/yanıt açılır. |
| **6 · Dışa aktar** | Tam rapor (CSV) · Belge tablosu (CSV) · JSON. |

### Hız limiti (free tier)

Ücretsiz hesaplarda RPM limitleri düşüktür (ör. Gemini 2.5 Flash free tier: 10 istek/dakika).

- Model seçince `config/models.json` içindeki `rpm` değerinden **otomatik öneri** uygulanır
  (`60 / rpm` × %10 pay).
- Hazır düğmeler (beklemesiz / 2 / 4 / 6 / 10 / 15 sn) veya kutuya doğrudan yazarak değiştirin.
- Seçiminiz tarayıcıda saklanır; model değiştirseniz de korunur. *Öneriyi uygula* ile modelin
  önerisine dönersiniz.
- Panel, o ayarla dakikada kaç istek gideceğini ve toplam süre tahminini gösterir.

`rpm` değerleri config'te ücretsiz kademe tahminidir — **kendi hesabınızın limitine göre
güncelleyin**. `rpm: 0` → limit yok (yerel modeller).

### Otomatik yeniden deneme

Geçici hatalar (429, 500, 502, 503, 504 …) **üstel bekleme ile 3 kez** denenir; ayar
`config/models.json` → `defaults.retry`. Kalıcı kota/bakiye hataları ("exceeded your current
quota", "billing", "insufficient_quota") **tekrar denenmez** — toplu testte onlarca boşuna
çağrı ve dakikalarca gecikme olmasın diye. Kaç denemede sonuç alındığı hem tabloda hem
raporda (`Deneme` sütunu) görünür.

### Panelde gördükleriniz

- **Süre** — Sadece ağ çağrısının saf süresi (sunucuda `performance.now()` ile ölçülür).
- **Token (g/ç)** — Sağlayıcının raporladığı giriş/çıkış token'ı; görsel token'ları girişin içindedir. Sağlayıcı raporlamazsa `~` ile tahmin gösterilir.
- **Maliyet** — `config/models.json` içindeki 1M token fiyatlarına göre hesaplanır.
- **1000 belge** — Ölçekleme kararı için en pratik sayı.
- **Uyarılar (⚠)** — Normalize katmanının düzeltmek zorunda kaldığı şeyler. Bu da bir kalite metriğidir.
- **Ham istek / yanıt** — API'ye giden gövde (base64 kısaltılmış, anahtar maskelenmiş) ve dönen ham JSON.

---

## 6. Raporlar

Rapor panelinin sağ üstünde üç indirme düğmesi var:

| Düğme | Dosya | Ne zaman |
|---|---|---|
| **Tam rapor (CSV)** | `<model>-rapor-<zaman>.csv` | Dört tablo tek dosyada; paylaşmak/arşivlemek için |
| **Belge tablosu (CSV)** | `<model>-rapor-<zaman>-belgeler.csv` | Tek başlık satırı + belge başına bir satır; Excel'de filtre/pivot için |
| **JSON** | `<model>-rapor-<zaman>.json` | Ham sonuçlar; kendi analizinizi yazacaksanız |

CSV biçimi Türkçe Excel'e göre ayarlıdır: **noktalı virgül ayırıcı + BOM**, ondalık ayırıcı
**virgül**. Hücrelere `$`, `%`, `sn` gibi birim yazılmaz — birim sütun başlığındadır, böylece
sayılar Excel'de metin değil **sayı** olarak açılır. Satırlar en geniş tabloya göre doldurulur;
dosya düzgün bir ızgara olarak açılır (`pandas.read_csv(..., sep=";")` de sorunsuz okur).

Tam rapordaki tablolar:

1. **KÜNYE** — rapor tarihi, model adı/ID, sağlayıcı, yapısal çıktı modu, fiyatlar, rpm, kullanılan bekleme, belge sayısı.
2. **ÖZET** — `Metrik · Değer · Birim`: alan doğruluğu, tam doğru belge, uydurma, açıklama doldurma sayısı, toplam/ortalama maliyet, 1000 belge projeksiyonu, süreler, token.
3. **ALAN BAZLI HATA DÖKÜMÜ** — puanlanan her alan için doğru/yanlış/eksik/uydurma ve doğruluk %.
4. **BELGE BAZLI SONUÇLAR** — belge başına bir satır: her alan için *model değeri · referans · sonuç*, modelin yazdığı açıklama, skor kırılımı, süre, deneme, token, maliyet, uyarılar, hata, referans notu.

**Modelleri karşılaştırma yöntemi:** her model için ayrı rapor alın, 2. tablodaki *alan
doğruluğu* ile *1000 belge maliyeti*ni iki eksen olarak kullanın. Aynı seti aynı prompt'la
çalıştırdığınız sürece karşılaştırma adildir.

---

## 7. Yeni model ve sağlayıcı ekleme

**Kod değişikliği gerekmez.** `config/models.json` düzenlenir; geliştirme sunucusu dosya
değişikliğini algılayıp yeniden okur.

### Mevcut sağlayıcıya model eklemek

`models` dizisine bir kayıt:

```json
{
  "id": "openai-gpt-4o",
  "label": "GPT-4o",
  "provider": "openai",
  "model": "gpt-4o",
  "rpm": 500,
  "structuredOutput": "json_schema",
  "pricing": { "inputPer1M": 2.5, "outputPer1M": 10.0 },
  "notes": "Neden eklendiğini buraya yazın.",
  "enabled": true
}
```

`id` benzersiz olmalı (arayüz ve localStorage bununla çalışır), `model` sağlayıcının
beklediği model kimliğidir.

### Yeni sağlayıcı eklemek

OpenAI uyumlu bir API ise (Together, Fireworks, xAI, DeepInfra, vLLM, LM Studio…) **sadece
konfigürasyon** yeterli:

```json
"together": {
  "label": "Together AI",
  "kind": "openai",
  "baseUrl": "https://api.together.xyz/v1",
  "apiKeyEnv": "TOGETHER_API_KEY",
  "pricingUrl": "https://www.together.ai/pricing"
}
```

Ardından `.env.local` içine `TOGETHER_API_KEY=...` ekleyin ve `.env.example`'a da boş
satırını ekleyin ki ekipteki diğer kişiler eksik olduğunu görsün.

Kendine özgü protokolü olan bir sağlayıcı için `src/lib/providers/` altına bir adaptör yazıp
`providers/index.ts` içindeki haritaya ekleyin. Adaptör sözleşmesi:

```ts
(model, provider, apiKey, input) => Promise<ProviderCallResult>
```

`ProviderCallResult`; URL, HTTP durumu, **maskelenmiş** istek başlıkları, base64'ü
kısaltılmış istek gövdesi, ham yanıt, modelin ürettiği metin ve token kullanımını döner.
Mevcut üç adaptör (~120 satır) örnek teşkil eder.

### Yerel model (veri dışarı çıkmasın senaryosu)

`config/models.json` içindeki `ollama` sağlayıcısı ve `ollama-local-vision` modeli şablon
olarak hazır (`enabled: false`):

```bash
ollama pull llama3.2-vision
```

sonra `enabled: true` yapın. Maliyet 0 görünür (donanım maliyeti dahil değil).

---

## 8. Model parametreleri

### Her isteğe otomatik giden parametreler

| Parametre | Değer | Nerede |
|---|---|---|
| `temperature` | `0` | **OpenAI uyumlu ve Gemini** adaptörlerinde sabit. Anthropic adaptörü temperature göndermez → API varsayılanı geçerlidir (aşağıdaki nota bakın). |
| Token limiti | `model.maxTokens` ?? `defaults.maxTokens` (1024) | Alan adı sağlayıcıya göre değişir (`max_tokens` / `max_completion_tokens` / `maxOutputTokens`) |
| Yapısal çıktı | `model.structuredOutput` | `json_schema` / `json_object` / `none` |
| Görsel ayrıntısı | `detail: "high"` | OpenAI uyumlu adaptörde sabit — fiş/fatura küçük yazıları için gerekli |
| Zaman aşımı | `defaults.timeoutMs` (120 sn) | `fetchWithTimeout` |

> **Anthropic ve temperature.** `src/lib/providers/anthropic.ts` bilerek `temperature`
> göndermiyor: Claude'un düşünme (thinking/effort) modu açıkken API `temperature`'ı
> reddediyor, `config/models.json` içindeki Sonnet 5 ve Opus 5 kayıtları da
> `output_config.effort` kullanıyor. Düşünmesi kapalı bir Claude modelinde ölçümü
> sabitlemek isterseniz kod değiştirmenize gerek yok, kayda ekleyin:
> `"extra": { "temperature": 0 }`. Hata alırsanız (400) o model düşünme modundadır,
> satırı geri çıkarın. **Karşılaştırma raporlarınızda bu farkı not edin:** Claude
> sonuçları API varsayılan sıcaklığıyla üretilmiştir, tekrar çalıştırınca birebir aynı
> çıktıyı vermeyebilir.

### Model kaydının alanları

| Alan | Açıklama |
|---|---|
| `id` | Benzersiz kimlik. Arayüz seçimleri ve rapor dosya adı bununla ilişkilidir. |
| `label` | Arayüzde ve raporda görünen ad. |
| `provider` | `providers` altındaki anahtar. |
| `model` | Sağlayıcının model kimliği. **Ölçüm yapacaksanız sürümü sabitleyin** (ör. `gpt-4o-mini-2024-07-18`); alias sürümler zamanla değişir ve eski raporlarınızla kıyas bozulur. |
| `structuredOutput` | `json_schema` → şema API tarafından zorlanır (en güvenilir). `json_object` → sadece "JSON üret" denir. `none` → serbest metin; normalize katmanı toparlar. |
| `pricing` | `inputPer1M` / `outputPer1M`, USD. Yanlış girilirse **tüm maliyet sayıları yanlış olur**. |
| `rpm` | Dakikadaki istek limiti. Toplu testte önerilen bekleme buradan hesaplanır (`60/rpm`). `0` → limitsiz. |
| `maxTokens` | Modele özel çıktı sınırı. Yazılmazsa `defaults.maxTokens`. |
| `tokenParam` | OpenAI uyumlu API'lerde `max_tokens` yerine `max_completion_tokens` gerekiyorsa. |
| `omit` | İstek gövdesinden **silinecek** üst seviye alanlar. Örn. bazı reasoning modelleri `temperature` kabul etmez → `["temperature"]`. |
| `extra` | Gövdeye **derin birleştirilecek** ek alanlar. Sağlayıcıya özgü her ayar buradan geçer. |
| `notes` | Arayüzde ipucu olarak görünür. Modeli neden eklediğinizi yazın. |
| `enabled` | `false` ise arayüzde hiç görünmez. |

### `extra` ile sık kullanılan ayarlar

```jsonc
// Anthropic — düşünme maliyetini kısmak
"extra": { "output_config": { "effort": "low" } }

// Gemini — düşünmeyi tamamen kapatmak
"extra": { "generationConfig": { "thinkingConfig": { "thinkingBudget": 0 } } }

// OpenAI — tekrarlanabilirlik
"extra": { "seed": 42 }
```

### Bir modelin parametrelerini ayarlarken sırayla sorun

1. **Reasoning modeli mi?** Öyleyse genelde `temperature` kabul etmez → `"omit": ["temperature"]`,
   ve çoğu zaman `"tokenParam": "max_completion_tokens"` ister.
2. **Yapısal çıktıyı gerçekten destekliyor mu?** Desteklemiyorsa `json_schema` verdiğinizde
   HTTP 400 alırsınız → `json_object`'e düşün. Hiç JSON modu yoksa `none`.
3. **Düşünme/effort ayarı var mı?** Varsayılan açıksa maliyet ve gecikme birkaç katına
   çıkabilir; `extra` ile kısın.
4. **Token limiti yetiyor mu?** 6 alan için 1024 fazlasıyla yeter; reasoning modelleri
   düşünme token'ını da bu limitten yediği için gerekirse `maxTokens` yükseltin.
5. **Fiyat ve rpm doğru mu?** `pricingUrl`'den teyit edin.

> ⚠️ **Fiyatlar değişir.** `config/models.json` içindeki değerler eklendikleri tarihteki
> tahminlerdir. Ölçüm almadan önce her sağlayıcının fiyat sayfasından teyit edip config'i
> güncelleyin — yanlış fiyat, raporun maliyet bölümünü tamamen yanlış yapar.

### Hangi modellerle başlamalı?

Config'te hazır gelen 11 aktif model üç segmenti temsil eder. Sıfırdan bir karşılaştırma
turuna çıkıyorsanız verimli sıra şudur:

1. **Orta segmentten bir model** ile tüm seti çalıştırın (ör. Gemini 2.5 Flash veya
   Claude Haiku 4.5). Bu, "bu iş LLM ile yapılabilir mi" sorusunun cevabıdır.
2. Doğruluk yeterliyse **ucuz segmente inin** (Gemini 2.5 Flash-Lite, GPT-4o mini) ve
   doğruluk kaybının maliyet kazancına değip değmediğine bakın.
3. Doğruluk yetmiyorsa **üst segmente çıkın** (Gemini 2.5 Pro, Claude Sonnet 5, Opus 5) —
   ama önce hatanın kaynağına bakın: alan bazlı dökümde hata tek bir alanda toplanıyorsa
   çözüm daha pahalı model değil, `config/prompt.txt` içindeki o alanın kuralıdır.
4. Yapısal çıktı desteklemeyen açık modelleri (`json_object` / `none`) denerken **uyarı
   sayısına** bakın: doğruluk benzer olsa bile ham çıktısı sürekli düzeltme gerektiren bir
   model üretimde daha kırılgandır.

Görsel genelde 1.000–2.500 giriş token'ı tutar, çıktı 40–60 token — yani maliyeti neredeyse
tamamen **giriş fiyatı** belirler. Raporun "1000 belge" satırı bu hesabı kendi belgelerinizle
otomatik yapar.

---

## 9. Prompt'u değiştirme

`config/prompt.txt` — sistem prompt'u burada, Türkçe ve yorumlu. Altı alanın tanımı, ayrım
kuralları (ör. "ETTN fatura no değildir", "alıcıyı değil satıcıyı yaz", "son ödeme tarihi
değil düzenlenme tarihi") ve tür sözlüğünün ipuçları bu dosyada.

A/B denemesi: dosyayı değiştirin, aynı seti aynı modelle tekrar çalıştırın, iki raporu
karşılaştırın. Sunucuyu yeniden başlatmaya gerek yok.

**Şema ile prompt'u birlikte güncelleyin.** Yeni bir `tur` değeri eklerken:

1. `src/lib/schema.ts` → `BELGE_TURLERI` dizisine ekleyin (şema `enum`'u buradan üretilir).
2. `config/prompt.txt` → 5. maddeye değeri ve onu ayırt eden ipucunu yazın.
3. Gerekirse `testset/ground-truth.json` içinde ilgili belgelere `alternatifler.tur` ekleyin.

Alan eklemek/çıkarmak isterseniz dokunulacak yerler: `schema.ts` (şema + `FIELD_ORDER` +
`FIELD_LABELS`), `types.ts` (`ReceiptFields`, `GroundTruthEntry`), `normalize.ts`,
`compare.ts`, `ReceiptForm.tsx`, `prompt.txt` ve `ground-truth.json`.

---

## 10. Mimari

```
config/
  models.json          sağlayıcı + model + fiyat + hız limiti tanımları
  prompt.txt           sistem prompt'u

testset/
  images/              25 belge
  ground-truth.json    referans değerler, alternatifler, tuzak notları

src/lib/
  config.ts            config yükleme, anahtar çözümleme (anahtar asla istemciye gitmez)
  schema.ts            ortak JSON şeması, tür sözlüğü, alan sırası, puanlanmayan alanlar
  types.ts             tüm sözleşmeler tek dosyada
  providers/
    index.ts           adaptör kayıt defteri (kind → adaptör)
    openai.ts          OpenAI / Groq / OpenRouter / xAI / Ollama / vLLM …
    anthropic.ts       Anthropic Messages API
    google.ts          Gemini generateContent + şema dönüştürücü
  normalize.ts         ham metin → 6 alan (markdown, TR tarih/sayı, etiket temizliği)
  compare.ts           referansla hoşgörülü karşılaştırma ve alan sonuçları
  batch.ts             toplu test özeti + CSV/JSON rapor tabloları
  cost.ts              token → maliyet, 1000 belge projeksiyonu
  csv.ts               Excel-TR uyumlu CSV üretimi ve indirme
  testset.ts           test seti listeleme, güvenli dosya çözümleme

src/app/
  page.tsx             Tekli Test
  toplu/page.tsx       Toplu Test
  api/extract          tek model çağrısı: adaptör → normalize → maliyet
  api/models           model listesi (anahtarın VARLIĞINI döner, değerini değil)
  api/testset          test seti + referanslar
  api/selftest         dış çağrı yapmadan mantık testi (21 kontrol)
```

**Güvenlik.** API anahtarları yalnızca sunucuda okunur. `/api/models` sadece
`hasApiKey: true/false` döndürür. Debug panelindeki istek gövdesinde `Authorization` /
`x-api-key` başlıkları maskelenir (`Bearer sk-abc...1234`), base64 görsel verisi boyut
özetiyle değiştirilir. Gemini anahtarı sorgu parametresiyle değil `x-goog-api-key`
başlığıyla gider — URL'ye ve loglara sızmaz.

### Bilinçli tasarım kararları

- **Şemada nullable alan yok** — üç sağlayıcının ortak paydası (bkz. bölüm 2).
- **`tur` alanı `enum`** — karşılaştırma anlamlı olsun diye.
- **Referansta `null` ≠ boş** — `null` "belge bu alanı içermiyor" demektir; halüsinasyon
  eğilimini doğruluk oranından ayrı ölçebilmek için bu ayrım korunuyor.
- **`aciklama` puanlanmıyor** — serbest metinde tek doğru cevap yok (bkz. bölüm 3).
- **Normalize katmanı her zaman devrede** — "hangi model ham haliyle temiz çıktı veriyor"
  ölçülebilsin diye.
- **Hatalar HTTP 200 ile döner** — bir modelin patlaması diğerlerinin sonucunu gizlemesin;
  karşılaştırma tablosunda hata da bir sonuçtur.
- **Sonuçlar kalıcı değil** — bu bir ölçüm aracı, veri tabanı değil. Raporu CSV/JSON olarak
  indirin.

---

## 11. Sorun giderme

| Belirti | Sebep / çözüm |
|---|---|
| Tüm modeller "anahtar yok" | `.env.local` yok veya sunucu yeniden başlatılmadı. `.env` değişikliği için `npm run dev`'i durdurup yeniden başlatın. |
| `config/models.json bulunamadi` | Sunucuyu proje kökünden çalıştırın veya `INVOICE_LAB_CONFIG_DIR` ortam değişkenini ayarlayın. |
| `Konfigürasyon okunamadi: Unexpected token` | JSON dosyasının başına BOM eklenmiş (PowerShell `Set-Content -Encoding UTF8` bunu yapar). Sistem BOM'u temizler ama yine de alıyorsanız dosyayı **UTF-8 (BOM'suz)** kaydedin. |
| `HTTP 404: model not found` | Model kimliği sağlayıcıda yok veya yeniden adlandırılmış. Sağlayıcının model listesinden doğrulayın. |
| `HTTP 400: temperature` benzeri | Reasoning modeli bu parametreyi kabul etmiyor → `"omit": ["temperature"]`. |
| `HTTP 400: max_tokens` | `"tokenParam": "max_completion_tokens"` ekleyin. |
| `HTTP 400` + şema hatası | Model `json_schema` desteklemiyor → `"structuredOutput": "json_object"` deneyin. |
| "Model yanıtı fatura verisine çevrilemedi" | Debug panelinden ham yanıta bakın. Genelde yapısal çıktı fazla iyimser ayarlanmıştır. |
| Toplu testte sürekli `HTTP 429` | Free tier hız limiti. **3 · Hız limiti** panelinden beklemeyi artırın. |
| `HTTP 429: exceeded your current quota` | Hız limiti değil, **bakiye/kota bitmiş**. Bu hata yeniden denenmez. |
| Token/maliyet `~` ile gösteriliyor | Sağlayıcı `usage` döndürmedi, değerler tahmin. O satırın maliyetine temkinli yaklaşın. |
| Sayfa 404 / garip derleme hatası | Turbopack önbelleği bozulmuş olabilir: `.next` klasörünü silip yeniden başlatın. |
| `npm run build` sırasında "Dynamic filesystem access" uyarısı | Beklenen. Test seti görselleri çalışma anında diskten okunuyor; yerel araç için sorun değil, build başarıyla tamamlanır. |
| CSV Excel'de tek sütuna düşüyor | Windows bölge ayarı liste ayırıcısı `;` değil. Excel → Veri → Metni Sütunlara Dönüştür ile `;` seçin. |

---

## 12. Bilinen sınırlar ve yol haritası

Bilerek yapılmayanlar — üretime geçerken gündeme alınmalı:

- **Kalıcılık yok.** Sonuçlar sayfa yenilenince kaybolur; raporu indirin.
- **Modeller arası otomatik karşılaştırma yok.** Toplu test tek model çalıştırır; kıyas için
  raporları yan yana koyun. (Doğal bir sonraki adım: aynı seti N modelde çalıştırıp tek
  karşılaştırma tablosu üreten bir mod.)
- **Kimlik doğrulama yok.** Yalnızca yerel geliştirme için. Bir sunucuya koyacaksanız önüne
  auth koyun — aksi halde API anahtarlarınızı herkese açmış olursunuz.
- **Batch API kullanılmıyor.** Senkron çağrı; üretimde OpenAI/Anthropic'in asenkron batch
  API'si %50 indirim sağlar.
- **Prompt önbelleği kullanılmıyor.** Sistem prompt'u sabit olduğu için üretimde kayda değer
  tasarruf sağlayabilir.
- **Şema sabit** (6 alan). Genişletmek için bölüm 9'daki listeye bakın.
- **Ground truth elle hazırlandı.** 25 belgenin referansları görsellerden okunarak girildi;
  hatalı bulduğunuz bir değeri `testset/ground-truth.json` içinde düzeltin — ve düzeltmeyi
  commit edin ki ekipteki herkes aynı referansla ölçsün.

### Maliyeti düşürme taktikleri

1. **Görseli küçültün.** Metin okunaklı kaldığı sürece 1000–1200 px genişlik yeter; giriş
   token'ı doğrudan düşer. Maliyeti neredeyse tamamen giriş fiyatı belirler (çıktı 40–60 token).
2. **Kademeli (cascade) mimari.** Ucuz modelle başlayın; model boş alan döndürdüğünde veya
   insan düzeltmesi gerektiğinde aynı belgeyi pahalı modele gönderin.
3. **Batch API + prompt önbelleği** (yukarıda).

---

## 13. Devir teslim kontrol listesi

Projeyi devralırken:

- [ ] `npm install` → `npm run dev` → `http://localhost:4123/api/selftest` **21/21** geçiyor mu?
- [ ] `.env.local` kendi anahtarlarınızla dolu mu? (Depoda **olmamalı**.)
- [ ] `config/models.json` içindeki **fiyatlar ve model kimlikleri** hâlâ geçerli mi?
      Sağlayıcıların `pricingUrl` bağlantılarından teyit edin — bu, raporun doğruluğunu
      doğrudan etkileyen tek konfigürasyondur.
- [ ] `rpm` değerleri **sizin hesabınızın** limitine göre güncellendi mi?
- [ ] Kendi belgelerinizi test setine eklemeden önce kişisel veri kontrolü yapıldı mı?
- [ ] Depo private; ekip arkadaşlarınız collaborator olarak eklendi mi?

Kod değiştirdikten sonra:

```bash
npm run typecheck   # tip kontrolü
npm run verify      # typecheck + production build
```

ve tarayıcıdan `/api/selftest`. Bu üçü geçiyorsa ölçüm mantığına dokunmamışsınızdır.

import type { NextConfig } from "next";

/**
 * Uygulama tarayicidan gelen gorseli base64 olarak Route Handler'a POST eder.
 * Route Handler'larda Next.js govde boyutu sinirlamaz (Server Action'lardaki
 * 1 MB limiti buraya islemez), bu yuzden ek bir ayar gerekmiyor. Ust sinir
 * arayuzde tutuluyor: src/components/ImageUploader.tsx -> MAX_BYTES (15 MB).
 *
 * Uygulamayi serverless bir platforma (Vercel vb.) tasirsaniz platformun kendi
 * istek govdesi limitine takilabilirsiniz; o durumda gorseli kucultun veya
 * dosyayi dogrudan sunucuya yukleyip yolunu gonderin.
 */
const nextConfig: NextConfig = {
  // Sunucu imzasini gizle — yerel arac, ekstra bilgi sizdirmasina gerek yok.
  poweredByHeader: false,
};

export default nextConfig;

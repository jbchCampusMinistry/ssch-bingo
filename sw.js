/* ==========================================================
   '즐거이' 하계수양회 BINGO — 서비스워커
   전략: 앱 셸(문서/JS/CSS 등)은 network-first + 캐시 폴백.
         Firebase/구글 도메인은 절대 가로채지도, 캐시하지도 않음.
   ========================================================== */

const CACHE_NAME = "haggye-bingo-shell-v1";

/* 미리 캐시할 앱 셸 */
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./firebase.js",
  "./manifest.json",
  "./icon.svg"
];

/* 절대 건드리면 안 되는 호스트 (인증/DB 실시간 통신) */
const BYPASS_HOSTS = [
  "firebaseio.com",
  "firebasedatabase.app",
  "googleapis.com",
  "gstatic.com",
  "google.com",
  "firebaseapp.com",
  "googleusercontent.com"
];

/* 설치: 앱 셸 미리 캐시 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* 활성화: 옛 캐시 정리 */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* 요청 처리 */
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // GET만 처리
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Firebase/구글 도메인은 서비스워커가 관여하지 않음 (캐시 금지!)
  if (BYPASS_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith("." + h))) {
    return;
  }

  // Pretendard CDN 폰트는 cache-first (변하지 않는 리소스)
  if (url.hostname === "cdn.jsdelivr.net") {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  // 같은 출처(앱 셸): network-first → 실패 시 캐시 폴백
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => {
            if (cached) return cached;
            // 오프라인에서 페이지 이동 시 index.html 폴백
            if (req.mode === "navigate") return caches.match("./index.html");
            return Response.error();
          })
        )
    );
  }
});

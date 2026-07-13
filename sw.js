/* ==========================================================
   '즐거이' 하계수양회 BINGO — 서비스워커
   전략: 앱 셸(문서/JS/CSS 등)은 network-first + 캐시 폴백.
         Firebase/구글 도메인은 절대 가로채지도, 캐시하지도 않음.
   + 웹 푸시(FCM): 앱이 닫혀 있을 때 공지 푸시를 받아 알림 표시.
   ========================================================== */

/* ---------- 웹 푸시(FCM) — 같은 SW(스코프)가 백그라운드 푸시도 처리 ---------- */
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");
try {
  firebase.initializeApp({
    apiKey: "AIzaSyCGilIGtjzagJMJgYxc4Zvfn3ThTyeA-Yk",
    authDomain: "ssch-bingo.firebaseapp.com",
    projectId: "ssch-bingo",
    messagingSenderId: "869664164731",
    appId: "1:869664164731:web:3e3da300fa3238c5f7cbde"
  });
  var _msg = firebase.messaging();
  // 데이터 전용(data-only) 메시지 → 여기서 직접 알림 표시 (중복 표시 방지 설계)
  _msg.onBackgroundMessage(function (payload) {
    var d = payload.data || {};
    self.registration.showNotification(d.title || "📢 공지", {
      body: d.body || "",
      icon: "./icon.svg",
      badge: "./icon.svg",
      tag: "ssch-announcement",
      data: { url: "./" }
    });
  });
} catch (e) { /* messaging 미지원 브라우저 등 — 캐시 SW 기능은 계속 동작 */ }

/* 알림 클릭 → 열린 앱 창 포커스, 없으면 새로 열기 */
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ("focus" in list[i]) return list[i].focus(); }
    if (clients.openWindow) return clients.openWindow("./");
  }));
});

const CACHE_NAME = "haggye-bingo-shell-v2"; // FCM 추가로 버전 올림 → 새 SW 활성화

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

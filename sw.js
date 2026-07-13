/* ==========================================================
   '즐거이' 하계수양회 BINGO — 서비스워커
   전략: 앱 셸(문서/JS/CSS 등)은 network-first + 캐시 폴백.
         Firebase/구글 도메인은 절대 가로채지도, 캐시하지도 않음.
   + 웹 푸시(FCM): 앱이 닫혀 있을 때 공지 푸시를 받아 알림 표시.
   ========================================================== */

/* ---------- 웹 푸시(FCM) ----------
   앱에서 토큰 발급(getToken) 호환을 위해 messaging 초기화는 유지하되,
   실제 알림 "표시"는 아래 raw push 핸들러가 담당한다.
   (firebase의 onBackgroundMessage가 일부 기기/브라우저 — 특히 iOS — 에서
    발화하지 않아 "이 사이트가 백그라운드에서 업데이트되었습니다" 기본 문구만 뜨는 문제 방지) */
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
  firebase.messaging(); // 토큰 발급 호환용 (알림 표시는 아래 push 핸들러가 담당)
} catch (e) { /* messaging 미지원 브라우저 등 — 캐시 SW 기능은 계속 동작 */ }

/* 푸시 수신 → 항상 알림을 직접 표시 (data/notification 어느 형태든 방어적으로 파싱).
   event.waitUntil로 표시가 끝날 때까지 대기 → 브라우저 기본 문구가 뜨지 않음. */
self.addEventListener("push", function (event) {
  var title = "📢 공지";
  var body = "";
  try {
    var payload = event.data ? event.data.json() : {};
    var d = payload.data || payload || {};
    var n = payload.notification || {};
    title = n.title || d.title || payload.title || "📢 공지";
    body = n.body || d.body || payload.body || "";
  } catch (e) { /* 파싱 실패 시 기본 문구로 표시 */ }

  // 포그라운드/백그라운드 상관없이 "항상" 알림 표시 → 브라우저 기본 문구가 절대 안 뜸
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: "./icon.svg",
      badge: "./icon.svg",
      tag: "ssch-announcement",
      renotify: true,
      data: { url: "./" }
    })
  );
});

/* 알림 클릭 → 열린 앱 창 포커스, 없으면 새로 열기 */
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ("focus" in list[i]) return list[i].focus(); }
    if (clients.openWindow) return clients.openWindow("./");
  }));
});

const CACHE_NAME = "haggye-bingo-shell-v4"; // 알림 항상 표시로 수정 → 새 SW 활성화

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

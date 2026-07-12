/* ==========================================================
   '즐거이' 하계수양회 BINGO — firebase.js (ES 모듈)
   역할: 구글 로그인, 닉네임 저장, 제출(인증샷) 동기화,
         갤러리/순위 실시간 구독, 관리자 체크 해제.
   app.js(일반 스크립트)와는 window 전역 함수로 연결.
   ========================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

/* ----------------------------------------------------------
   Firebase 설정
   // TODO: Firebase 콘솔의 firebaseConfig로 교체
   (콘솔 → 프로젝트 설정 → 일반 → 내 앱 → SDK 설정 및 구성)
   ※ databaseURL 반드시 포함! (Realtime Database 주소)
   ---------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyCGilIGtjzagJMJgYxc4Zvfn3ThTyeA-Yk",
  authDomain: "ssch-bingo.firebaseapp.com",
  databaseURL: "https://ssch-bingo-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ssch-bingo",
  storageBucket: "ssch-bingo.firebasestorage.app",
  messagingSenderId: "869664164731",
  appId: "1:869664164731:web:3e3da300fa3238c5f7cbde",
  measurementId: "G-G1M2LHF60F"
};

/* 마스터 관리자 이메일 — DB의 admins 노드가 없어도 항상 관리자
   ※ 그 외 사용자는 DB의 admins/<uid> = true 로 관리자 지정 (관리자 패널에서 in-app 부여 가능) */
const ADMIN_EMAILS = ["tjswp757@gmail.com", "tjswo757@gmail.com"];

/* ---------- 설정 미완료 감지 (자리표시자 그대로면 친절히 안내) ---------- */
const configReady = !/^YOUR_/.test(firebaseConfig.apiKey || "YOUR_");

let app = null;
let auth = null;
let db = null;

/* ---------- 모듈 내부 상태 ---------- */
let currentUser = null;      // firebase User
let currentNick = "";
let currentIsAdmin = false;
let mySubs = {};             // { mid: {...} } 내 제출 캐시
let mySubUnsubs = [];        // 내 제출 25개 리스너 해제 함수들
let lbUnsub = null;          // 순위 리스너 해제 함수
let galleryUnsub = null;     // 갤러리 리스너 해제 함수
let galleryMid = null;
let usersUnsub = null;       // 관리자 패널 회원 목록 리스너 해제 함수
let lastLBKey = null;        // 마지막으로 기록한 "checks:bingos" (불필요한 재기록 방지)
let lbReady = false;         // 내 기존 leaderboard 값을 읽었는지
let emitTimer = null;        // 제출 갱신 디바운스

/* ==========================================================
   초기화
   ========================================================== */
if (configReady) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getDatabase(app);

    // 리다이렉트 로그인 폴백 결과 처리 (팝업 차단 환경)
    getRedirectResult(auth).catch((err) => {
      console.warn("리다이렉트 로그인 결과 오류:", err);
    });

    // 로그인 상태 감시 — 앱의 진입점
    onAuthStateChanged(auth, (user) => {
      if (user) {
        handleSignedIn(user);
      } else {
        cleanupSubscriptions();
        currentUser = null;
        currentNick = "";
        currentIsAdmin = false;
        window.showLogin();
      }
    });
  } catch (err) {
    console.error("Firebase 초기화 실패:", err);
    window.setConfigNotice("Firebase 초기화에 실패했어요. firebase.js의 설정값을 확인해 주세요.");
  }
} else {
  // config가 자리표시자 그대로 → 로그인 화면에 안내만 표시
  window.setConfigNotice(
    "아직 Firebase 설정 전이에요. firebase.js 파일 상단의 firebaseConfig를 " +
    "Firebase 콘솔 값으로 교체해 주세요. (SETUP.md 참고)"
  );
}

/* ==========================================================
   로그인 처리
   ========================================================== */

/** 로그인 후: 관리자 판정 → 프로필 확인 → 닉네임 모달 or 메인 진입 */
async function handleSignedIn(user) {
  currentUser = user;
  window.showLoading();

  try {
    // 1) users/$uid 프로필 읽기
    const userSnap = await get(ref(db, "users/" + user.uid));
    const profile = userSnap.exists() ? userSnap.val() : {};

    // 2) 관리자 판정: 이메일 화이트리스트 OR DB의 admins/$uid
    let adminNode = false;
    try {
      const adminSnap = await get(ref(db, "admins/" + user.uid));
      adminNode = adminSnap.exists() && adminSnap.val() === true;
    } catch (e) { /* 규칙상 읽기 실패해도 무시 */ }
    currentIsAdmin = ADMIN_EMAILS.includes(user.email || "") || adminNode;

    // 3) 프로필 기본 정보 기록 (닉네임은 건드리지 않음)
    await update(ref(db, "users/" + user.uid), {
      email: user.email || "",
      isAdmin: currentIsAdmin,
      ts: Date.now()
    });

    // 4) 닉네임 유무로 분기
    if (profile.nick) {
      currentNick = profile.nick;
      await enterMain();
    } else {
      window.showNickModal(); // 첫 로그인 → "자기 이름으로 입력해 주세요"
    }
  } catch (err) {
    console.error("로그인 후 초기화 실패:", err);
    window.hideLoading();
    window.showToast("데이터를 불러오지 못했어요. 새로고침해 주세요.");
  }
}

/** 메인 화면 진입 + 실시간 구독 시작 */
async function enterMain() {
  // 내 기존 leaderboard 값 읽기 (같은 값 재기록으로 ts가 바뀌는 것 방지)
  lbReady = false;
  lastLBKey = null;
  try {
    const lbSnap = await get(ref(db, "leaderboard/" + currentUser.uid));
    if (lbSnap.exists()) {
      const v = lbSnap.val();
      lastLBKey = (v.checks || 0) + ":" + (v.bingos || 0);
    }
  } catch (e) { /* 무시 */ }
  lbReady = true;

  window.showMain({ uid: currentUser.uid, email: currentUser.email }, currentNick, currentIsAdmin);
  subscribeMySubmissions();
  subscribeLeaderboard();
}

/* ==========================================================
   window로 노출: 로그인/로그아웃
   ========================================================== */

/** 구글 로그인 (팝업 → 차단 시 리다이렉트 폴백) */
window.fbLogin = async function () {
  if (!configReady || !auth) {
    window.showToast("Firebase 설정이 필요해요. SETUP.md를 확인해 주세요.");
    return;
  }
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err && (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment")) {
      // 팝업이 막힌 환경(일부 모바일 브라우저) → 리다이렉트 방식
      await signInWithRedirect(auth, provider);
    } else if (err && err.code === "auth/unauthorized-domain") {
      window.showToast("이 도메인이 Firebase 승인 도메인에 없어요. 콘솔에서 추가해 주세요.");
    } else if (err && err.code !== "auth/popup-closed-by-user" && err.code !== "auth/cancelled-popup-request") {
      console.warn("로그인 실패:", err);
      window.showToast("로그인에 실패했어요. 다시 시도해 주세요.");
    }
  }
};

/** 로그아웃 */
window.fbLogout = async function () {
  if (!auth) return;
  try {
    await signOut(auth); // onAuthStateChanged가 showLogin() 호출
  } catch (err) {
    console.warn("로그아웃 실패:", err);
  }
};

/* ==========================================================
   window로 노출: 닉네임 저장 (중복 검사 포함)
   ========================================================== */
window.fbSaveNickname = async function (nick) {
  if (!currentUser) throw new Error("로그인이 필요해요.");

  // 1) 중복 검사
  const nickRef = ref(db, "nicknames/" + nick);
  const snap = await get(nickRef);
  if (snap.exists() && snap.val() !== currentUser.uid) {
    throw new Error("이미 사용 중인 닉네임이에요. 다른 이름을 입력해 주세요.");
  }

  // 2) nicknames/$nick = $uid (보안규칙이 경쟁 상황도 차단)
  try {
    await set(nickRef, currentUser.uid);
  } catch (e) {
    throw new Error("이미 사용 중인 닉네임이에요. 다른 이름을 입력해 주세요.");
  }

  // 3) users/$uid.nick 기록
  await update(ref(db, "users/" + currentUser.uid), { nick: nick });

  currentNick = nick;
  await enterMain();
};

/* ==========================================================
   내 제출(인증샷) 실시간 구독 — submissions/$mid/$uid × 25
   ========================================================== */
function subscribeMySubmissions() {
  unsubscribeMySubmissions();
  mySubs = {};

  for (let mid = 0; mid < 25; mid++) {
    const r = ref(db, "submissions/" + mid + "/" + currentUser.uid);
    const unsub = onValue(r, (snap) => {
      if (snap.exists()) {
        mySubs[mid] = snap.val();
      } else {
        delete mySubs[mid];
      }
      scheduleEmitMySubs();
    }, (err) => {
      console.warn("내 제출 구독 오류(mid=" + mid + "):", err);
    });
    mySubUnsubs.push(unsub);
  }
}

/** 25개 리스너가 연달아 발화하므로 짧게 디바운스 후 한 번에 렌더 */
function scheduleEmitMySubs() {
  if (emitTimer) clearTimeout(emitTimer);
  emitTimer = setTimeout(() => {
    emitTimer = null;
    window.onMySubmissions(Object.assign({}, mySubs));
  }, 60);
}

function unsubscribeMySubmissions() {
  mySubUnsubs.forEach((fn) => { try { fn(); } catch (e) {} });
  mySubUnsubs = [];
  if (emitTimer) { clearTimeout(emitTimer); emitTimer = null; }
}

/* ==========================================================
   window로 노출: 인증샷 업로드 / 삭제
   ========================================================== */

/** 인증샷 업로드 (재업로드 시 덮어쓰기 → 해제 기록도 초기화됨) */
window.fbUploadSubmission = async function (mid, dataUrl) {
  if (!currentUser) throw new Error("로그인이 필요해요.");
  await set(ref(db, "submissions/" + mid + "/" + currentUser.uid), {
    nick: currentNick,
    photo: dataUrl,
    ts: Date.now(),
    revoked: false
  });
};

/** 내 인증샷 삭제 */
window.fbDeleteSubmission = async function (mid) {
  if (!currentUser) throw new Error("로그인이 필요해요.");
  await remove(ref(db, "submissions/" + mid + "/" + currentUser.uid));
};

/* ==========================================================
   window로 노출: 미션 갤러리 실시간 구독 (모달 열릴 때만)
   ========================================================== */
window.fbWatchGallery = function (mid) {
  window.fbUnwatchGallery();
  galleryMid = mid;
  const r = ref(db, "submissions/" + mid);
  galleryUnsub = onValue(r, (snap) => {
    const items = [];
    if (snap.exists()) {
      const val = snap.val();
      Object.keys(val).forEach((uid) => {
        const s = val[uid] || {};
        items.push({
          uid: uid,
          nick: s.nick || "",
          photo: s.photo || "",
          ts: s.ts || 0,
          test: s.test === true,
          revoked: s.revoked === true,
          revokeComment: s.revokeComment || ""
        });
      });
    }
    window.renderGallery(mid, items);
  }, (err) => {
    console.warn("갤러리 구독 오류:", err);
  });
};

window.fbUnwatchGallery = function () {
  if (galleryUnsub) { try { galleryUnsub(); } catch (e) {} galleryUnsub = null; }
  galleryMid = null;
};

/* ==========================================================
   window로 노출: 순위(leaderboard)
   ========================================================== */

/** 전체 순위 실시간 구독 → app.js가 정렬/렌더 */
function subscribeLeaderboard() {
  if (lbUnsub) { try { lbUnsub(); } catch (e) {} }
  lbUnsub = onValue(ref(db, "leaderboard"), (snap) => {
    const entries = [];
    if (snap.exists()) {
      const val = snap.val();
      Object.keys(val).forEach((uid) => {
        const e = val[uid] || {};
        entries.push({
          uid: uid,
          nick: e.nick || "",
          checks: e.checks || 0,
          bingos: e.bingos || 0,
          ts: e.ts || 0
        });
      });
    }
    window.renderLeaderboard(entries);
  }, (err) => {
    console.warn("순위 구독 오류:", err);
  });
}

/** 내 순위 데이터 갱신 (app.js의 refreshBoard가 호출) */
window.fbUpdateLeaderboard = function (checks, bingos) {
  if (!currentUser || !currentNick || !lbReady) return;
  const key = checks + ":" + bingos;
  if (key === lastLBKey) return; // 값이 같으면 재기록 안 함 (동점 ts 보존)
  lastLBKey = key;
  set(ref(db, "leaderboard/" + currentUser.uid), {
    nick: currentNick,
    checks: checks,
    bingos: bingos,
    ts: Date.now()
  }).catch((err) => {
    console.warn("순위 기록 실패:", err);
    lastLBKey = null; // 실패 시 다음에 재시도
  });
};

/* ==========================================================
   window로 노출: 관리자 체크 해제
   ※ 보안규칙상 DB에 admins/<내 uid> = true 가 있어야 성공
   ========================================================== */
window.fbRevoke = async function (mid, uid, comment) {
  if (!currentUser || !currentIsAdmin) throw new Error("관리자만 사용할 수 있어요.");
  await update(ref(db, "submissions/" + mid + "/" + uid), {
    revoked: true,
    revokeComment: comment,
    revokeBy: currentNick,
    revokeTs: Date.now()
  });
};

/* ==========================================================
   window로 노출: 관리자 패널 (권한 지정/해제, 회원 목록, 회원 미션 조회)
   ========================================================== */

/** 관리자 권한 지정/해제 — admins/<uid> 노드 + users/<uid>.isAdmin 동기화
    ※ 보안규칙상 관리자(마스터 이메일 또는 admins 노드)만 성공 */
window.fbSetAdmin = async function (uid, makeAdmin) {
  if (!currentUser || !currentIsAdmin) throw new Error("관리자만 사용할 수 있어요.");
  if (makeAdmin) {
    await set(ref(db, "admins/" + uid), true);
    await update(ref(db, "users/" + uid), { isAdmin: true });
  } else {
    await remove(ref(db, "admins/" + uid));
    await update(ref(db, "users/" + uid), { isAdmin: false });
  }
};

/** 회원 목록 실시간 구독 → app.js의 renderAdminUsers가 렌더 */
window.fbWatchUsers = function () {
  window.fbUnwatchUsers();
  usersUnsub = onValue(ref(db, "users"), (snap) => {
    const list = [];
    if (snap.exists()) {
      const val = snap.val();
      Object.keys(val).forEach((uid) => {
        const u = val[uid] || {};
        list.push({
          uid: uid,
          nick: u.nick || "",
          email: u.email || "",
          isAdmin: u.isAdmin === true
        });
      });
    }
    // 닉네임 기준 정렬 (닉네임 없으면 이메일로)
    list.sort((a, b) => (a.nick || a.email || "").localeCompare(b.nick || b.email || "", "ko"));
    if (typeof window.renderAdminUsers === "function") window.renderAdminUsers(list);
  }, (err) => {
    console.warn("회원 목록 구독 오류:", err);
  });
};

/** 회원 목록 구독 해제 (관리자 패널 닫을 때) */
window.fbUnwatchUsers = function () {
  if (usersUnsub) { try { usersUnsub(); } catch (e) {} usersUnsub = null; }
};

/** 특정 유저의 25칸 제출 일괄 조회 → { mid: sub } (사진 포함 가능) */
window.fbGetUserSubs = async function (uid) {
  const gets = [];
  for (let mid = 0; mid < 25; mid++) {
    gets.push(get(ref(db, "submissions/" + mid + "/" + uid)));
  }
  const snaps = await Promise.all(gets);
  const map = {};
  snaps.forEach((snap, mid) => {
    if (snap.exists()) map[mid] = snap.val();
  });
  return map;
};

/* ==========================================================
   window로 노출: 관리자 테스트 체크 (사진 없이 내 칸 체크/해제)
   ========================================================== */
window.fbTestCheck = async function (mid, on) {
  if (!currentUser || !currentIsAdmin) throw new Error("관리자만 사용할 수 있어요.");
  if (on) {
    await set(ref(db, "submissions/" + mid + "/" + currentUser.uid), {
      nick: currentNick,
      ts: Date.now(),
      test: true,
      revoked: false
    });
  } else {
    await remove(ref(db, "submissions/" + mid + "/" + currentUser.uid));
  }
};

/* ==========================================================
   구독 정리 (로그아웃 시)
   ========================================================== */
function cleanupSubscriptions() {
  unsubscribeMySubmissions();
  window.fbUnwatchGallery();
  window.fbUnwatchUsers();
  if (lbUnsub) { try { lbUnsub(); } catch (e) {} lbUnsub = null; }
  mySubs = {};
  lastLBKey = null;
  lbReady = false;
}

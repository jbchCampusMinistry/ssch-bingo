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
  onValue,
  push,
  query,
  limitToLast,
  onChildAdded
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import {
  getStorage,
  ref as sRef,
  uploadBytes,
  getBlob,
  deleteObject,
  listAll
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

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
let storage = null;          // Cloud Storage — 원본 사진 아카이브용 (없어도 앱은 정상 동작)

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

/* ---------- 중고등부(팀 빙고) 상태 ---------- */
let currentMgRole = false;            // 내 중고등부 권한 (mgRoles/$uid)
let currentMgTeam = null;             // 내 소속 팀 "A"|"B" (mgTeams/$uid)
let mgBoardUnsubs = [];               // A/B 두 팀 보드 리스너 해제 함수들
let mgBoardCache = { A: null, B: null }; // 팀별 mgSubmissions 스냅샷 캐시
let mgGalleryUnsub = null;            // 중고등부 갤러리 리스너 해제 함수
let mgGalleryKey = null;              // "팀/미션번호" (뒤늦은 응답 무시용)

/* ---------- 채팅 상태 ---------- */
let chatUnsub = null;                 // 채팅 리스너 해제 함수

/* ==========================================================
   초기화
   ========================================================== */
if (configReady) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getDatabase(app);

    // Cloud Storage 초기화 — 실패해도 storage=null로 두고 앱은 계속 (원본 아카이브만 비활성)
    try {
      storage = getStorage(app);
    } catch (e) {
      storage = null;
      console.warn("Storage 초기화 실패(원본 아카이브 비활성):", e);
    }

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

    // 2-1) 중고등부 권한/팀 읽기 (mgRoles / mgTeams 노드가 권위 데이터)
    await refreshMgState();

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
  window.fbChatWatch(); // 청년회 메인 채팅 실시간 구독 시작
}

/** 내 중고등부 권한(mgRoles)/팀(mgTeams) 최신값 읽기 — 로그인 시 + 중고등부 입장 시 */
async function refreshMgState() {
  if (!currentUser) { currentMgRole = false; currentMgTeam = null; return; }
  try {
    const roleSnap = await get(ref(db, "mgRoles/" + currentUser.uid));
    currentMgRole = roleSnap.exists() && roleSnap.val() === true;
  } catch (e) { currentMgRole = false; }
  try {
    const teamSnap = await get(ref(db, "mgTeams/" + currentUser.uid));
    currentMgTeam = teamSnap.exists() ? teamSnap.val() : null;
  } catch (e) { currentMgTeam = null; }
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
   사진 배열 정규화 — 예전 단일 사진 데이터와의 하위 호환
   ========================================================== */

/** 어떤 형태(문자열=예전 단일 사진 / 배열 / {0:..} 객체)든 dataURL 배열로 통일 */
function toPhotoArray(val) {
  if (!val) return [];
  if (typeof val === "string") return [val];
  const arr = Array.isArray(val)
    ? val
    : Object.keys(val).sort((a, b) => Number(a) - Number(b)).map((k) => val[k]);
  return arr.filter((p) => typeof p === "string" && p.length > 0);
}

/** 제출 객체에서 사진 배열 추출 — photos 배열 우선, 없으면 예전 photo 단일값 */
function photosOf(sub) {
  if (!sub) return [];
  const arr = toPhotoArray(sub.photos);
  if (arr.length) return arr;
  return sub.photo ? [sub.photo] : [];
}

/* ==========================================================
   원본 사진 아카이브 (Cloud Storage) — best-effort 헬퍼
   ※ 압축본은 지금처럼 RTDB에 저장(무료·빠른 표시)하고,
     원본은 보존용으로 Storage에 "추가로" 올린다.
     Storage가 실패해도(Blaze 미설정/오프라인/용량 초과 등)
     압축본 저장은 반드시 계속돼야 함 — 게임이 멈추면 안 됨!
   ========================================================== */

/** 원본 파일 이름용 고유 ID */
function newPhotoId() {
  return Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

/** origs 값(배열/객체/누락)을 photos와 같은 길이로 정규화 — 빈 값은 null
    ※ 예전 데이터(origs 없음)는 전부 null로 채워 하위 호환 */
function toOrigArray(val, len) {
  let arr = [];
  if (val) {
    if (Array.isArray(val)) {
      arr = val.slice();
    } else if (typeof val === "object") {
      Object.keys(val).forEach((k) => { arr[Number(k)] = val[k]; });
    }
  }
  const out = [];
  for (let i = 0; i < len; i++) {
    const p = arr[i];
    out.push(typeof p === "string" && p.length > 0 ? p : null);
  }
  return out;
}

/** 저장용 변환 — null → ""(빈 문자열). RTDB는 배열 안의 null을 저장하지 않아
    인덱스가 어긋나므로 빈 자리는 ""로 기록 (읽을 땐 toOrigArray가 null로 통일) */
function origsForWrite(origs) {
  return origs.map((p) => (typeof p === "string" && p ? p : ""));
}

/** 원본 업로드 (best-effort) — 성공 시 Storage 경로, 실패/불가 시 null */
async function uploadOriginal(path, originalFile) {
  if (!storage || !originalFile) return null;
  try {
    await uploadBytes(sRef(storage, path), originalFile, {
      contentType: originalFile.type || "image/jpeg"
    });
    return path;
  } catch (e) {
    console.warn("원본 저장 실패(압축본만 저장):", e);
    return null;
  }
}

/** 원본 삭제 (best-effort) — 실패해도 무시.
    ※ 호출부는 await 하지 말 것! (DELETE 요청이라 네트워크/CORS 지연 시 최대 2분 재시도 →
      기다리면 UI가 멈춘 것처럼 보임. RTDB 반영은 먼저 끝내고 이건 백그라운드로 던진다.) */
async function deleteOriginal(path) {
  if (!storage || typeof path !== "string" || !path) return;
  try {
    await deleteObject(sRef(storage, path));
  } catch (e) {
    console.warn("원본 삭제 실패:", path, e);
  }
}

/** 폴더 이하 모든 원본 재귀 삭제 (best-effort, 백그라운드 — 계정 삭제 시 사용) */
async function deleteFolderRecursive(path) {
  if (!storage) return;
  try {
    const res = await listAll(sRef(storage, path));
    await Promise.all(res.items.map((it) => deleteObject(it).catch(() => {})));
    await Promise.all(res.prefixes.map((pre) => deleteFolderRecursive(pre.fullPath)));
  } catch (e) {
    console.warn("원본 폴더 정리 실패:", path, e);
  }
}

/* ==========================================================
   window로 노출: 인증샷 업로드 / 삭제
   ※ 한 칸에 최대 3장 — 첫 번째 사진이 대표 사진(photo 필드)
   ========================================================== */

/** 인증샷 업로드 — 기존 사진 뒤에 이어붙임 (3장 초과 시 MAX_PHOTOS, 재업로드 시 해제 기록 초기화)
    원본 파일(originalFile)은 Cloud Storage에 보존용으로 추가 저장 (best-effort — 실패해도 압축본은 저장) */
window.fbUploadSubmission = async function (mid, dataUrl, originalFile) {
  if (!currentUser) throw new Error("로그인이 필요해요.");
  const r = ref(db, "submissions/" + mid + "/" + currentUser.uid);
  const snap = await get(r);
  const cur = snap.exists() ? snap.val() : null;
  const photos = photosOf(cur);
  if (photos.length >= 3) throw new Error("MAX_PHOTOS");
  const origs = toOrigArray(cur ? cur.origs : null, photos.length); // photos와 같은 인덱스로 유지

  // 원본 아카이브 (Storage) — 어떤 이유로 실패해도 아래 압축본 저장은 계속
  const origPath = await uploadOriginal(
    "originals/" + currentUser.uid + "/yc/" + mid + "/" + newPhotoId() + ".jpg",
    originalFile
  );

  photos.push(dataUrl);
  origs.push(origPath);
  await set(r, {
    nick: currentNick,
    photo: photos[0],  // 대표 사진 (보드/썸네일의 기존 sub.photo 코드 호환)
    photos: photos,
    origs: origsForWrite(origs), // 각 사진의 원본 Storage 경로 (없으면 "")
    ts: Date.now(),
    revoked: false
  });
};

/** 내 인증샷 1장 삭제 — 남은 사진이 없으면 제출 노드 전체 삭제, 있으면 첫 장을 대표로 재지정
    Storage에 원본이 있으면 함께 삭제 (best-effort) */
window.fbDeletePhoto = async function (mid, index) {
  if (!currentUser) throw new Error("로그인이 필요해요.");
  const r = ref(db, "submissions/" + mid + "/" + currentUser.uid);
  const snap = await get(r);
  if (!snap.exists()) return;
  const cur = snap.val() || {};
  const photos = photosOf(cur);
  const origs = toOrigArray(cur.origs, photos.length);
  const removedOrig = origs[index] || null;
  photos.splice(index, 1); // 해당 장만 빼고 배열 재구성 → 자동 재정렬
  origs.splice(index, 1);  // 원본 경로도 같은 인덱스로 정렬 유지
  if (photos.length === 0) {
    await remove(r);
  } else {
    await set(r, Object.assign({}, cur, {
      photo: photos[0],
      photos: photos,
      origs: origsForWrite(origs)
    }));
  }
  deleteOriginal(removedOrig); // 원본은 백그라운드 정리 (await 금지 — UI 멈춤 방지)
};

/** 내 인증샷 전체 삭제 (칸 통째로 — 예전 호환용) */
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
        const ps = photosOf(s); // 예전 단일 photo 데이터도 배열로 통일
        items.push({
          uid: uid,
          nick: s.nick || "",
          photo: ps[0] || "",
          photos: ps,
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
          isAdmin: u.isAdmin === true,
          mgRole: u.mgRole === true,
          mgTeam: u.mgTeam === "A" || u.mgTeam === "B" ? u.mgTeam : ""
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
   window로 노출: 관리자 갤러리 — 행사 전체 사진 일괄 조회
   ※ 읽기 비용이 커서 관리자 패널의 [사진 불러오기] 버튼에서만 호출
   ========================================================== */
window.fbAdminLoadAllPhotos = async function () {
  if (!currentUser || !currentIsAdmin) throw new Error("관리자만 사용할 수 있어요.");
  // 각 읽기를 개별 catch — 규칙 미배포 등으로 일부 노드를 못 읽어도
  // 나머지(예: 청년회 사진)는 정상적으로 불러오도록 (전체 실패 방지)
  const [subSnap, metaA, metaB, phA, phB, ogA, ogB] = await Promise.all([
    get(ref(db, "submissions")).catch(() => null),
    get(ref(db, "mgSubmissions/A")).catch(() => null),
    get(ref(db, "mgSubmissions/B")).catch(() => null),
    get(ref(db, "mgPhotos/A")).catch(() => null),
    get(ref(db, "mgPhotos/B")).catch(() => null),
    get(ref(db, "mgOrigs/A")).catch(() => null),
    get(ref(db, "mgOrigs/B")).catch(() => null)
  ]);
  const ok = (snap) => snap && snap.exists();
  const subs = ok(subSnap) ? subSnap.val() : {};
  const mgMeta = { A: ok(metaA) ? metaA.val() : {}, B: ok(metaB) ? metaB.val() : {} };
  const mgPh = { A: ok(phA) ? phA.val() : {}, B: ok(phB) ? phB.val() : {} };
  const mgOg = {
    A: ogA && ogA.exists() ? ogA.val() : {},
    B: ogB && ogB.exists() ? ogB.val() : {}
  };

  const missions = [];
  for (let mid = 0; mid < 25; mid++) {
    const groups = [];

    // 청년회 — 사진이 1장 이상인 제출만 (테스트 체크 제외, 해제된 건 표시용으로 포함)
    // origs = 각 사진의 원본 Storage 경로 배열 (photos와 같은 인덱스, 원본 없으면 null)
    const yEntries = [];
    const ySubs = subs[mid] || {};
    Object.keys(ySubs).forEach((uid) => {
      const s = ySubs[uid] || {};
      const photos = photosOf(s);
      if (photos.length === 0) return;
      yEntries.push({
        uid: uid,
        nick: s.nick || "",
        photos: photos,
        origs: toOrigArray(s.origs, photos.length),
        revoked: s.revoked === true
      });
    });
    groups.push({ source: "청년회", entries: yEntries });

    // 중고등부 A/B팀
    ["A", "B"].forEach((team) => {
      const entries = [];
      const metas = (mgMeta[team] && mgMeta[team][mid]) || {};
      const photosNode = (mgPh[team] && mgPh[team][mid]) || {};
      const origsNode = (mgOg[team] && mgOg[team][mid]) || {};
      Object.keys(metas).forEach((uid) => {
        const m = metas[uid] || {};
        const photos = toPhotoArray(photosNode[uid]);
        if (photos.length === 0) return;
        entries.push({
          uid: uid,
          nick: m.nick || "",
          photos: photos,
          origs: toOrigArray(origsNode[uid], photos.length),
          revoked: m.revoked === true
        });
      });
      groups.push({ source: "중고등부 " + team + "팀", entries: entries });
    });

    missions.push({
      mid: mid,
      title: (window.MISSIONS && window.MISSIONS[mid]) || "",
      groups: groups
    });
  }
  return { missions: missions };
};

/** 원본 사진 Blob 다운로드 (관리자 원본 ZIP용) — 실패/미설정 시 null (best-effort) */
window.fbFetchOriginalBlob = async function (path) {
  if (!storage) return null;
  try {
    return await getBlob(sRef(storage, path));
  } catch (e) {
    console.warn("원본 다운로드 실패:", path, e);
    return null;
  }
};

/* ==========================================================
   window로 노출: 관리자 — 사진 하드 삭제 / 계정 삭제
   ========================================================== */

/** 관리자: 회원의 인증샷 1장 완전 삭제 — scope: "yc"(청년회) | "A" | "B"(중고등부 팀)
    RTDB의 참조(사진·경로)를 먼저 제거한 뒤, Storage 원본은 백그라운드로 삭제(best-effort).
    ※ Storage 규칙이 "로그인 사용자 삭제 허용"이면 원본도 함께 지워짐. */
window.fbAdminDeletePhoto = async function (scope, mid, uid, index) {
  if (!currentUser || !currentIsAdmin) throw new Error("관리자만 사용할 수 있어요.");

  if (scope === "yc") {
    // 청년회 — submissions/$mid/$uid 의 photos/origs 배열에서 해당 장만 제거
    const r = ref(db, "submissions/" + mid + "/" + uid);
    const snap = await get(r);
    if (!snap.exists()) return;
    const cur = snap.val() || {};
    const photos = photosOf(cur);
    const origs = toOrigArray(cur.origs, photos.length);
    const removedOrig = origs[index] || null;
    photos.splice(index, 1); // 해당 장만 빼고 배열 재구성 → 자동 재정렬
    origs.splice(index, 1);  // 원본 경로도 같은 인덱스로 정렬 유지
    if (photos.length === 0) {
      await remove(r);
    } else {
      await set(r, Object.assign({}, cur, {
        photo: photos[0],
        photos: photos,
        origs: origsForWrite(origs)
      }));
    }
    if (typeof removedOrig === "string" && removedOrig) deleteOriginal(removedOrig); // 백그라운드 정리 (await 금지)
    return;
  }

  // 중고등부 — scope 가 곧 팀("A" | "B")
  const team = scope;
  const pr = ref(db, "mgPhotos/" + team + "/" + mid + "/" + uid);
  const or = ref(db, "mgOrigs/" + team + "/" + mid + "/" + uid);
  const mr = ref(db, "mgSubmissions/" + team + "/" + mid + "/" + uid);
  const snap = await get(pr);
  const photos = snap.exists() ? toPhotoArray(snap.val()) : [];

  // 원본 경로도 같은 인덱스로 정렬 유지 (못 읽어도 삭제는 계속)
  let origs = toOrigArray(null, photos.length);
  try {
    const oSnap = await get(or);
    if (oSnap.exists()) origs = toOrigArray(oSnap.val(), photos.length);
  } catch (e) { /* 무시 */ }

  const removedOrig = origs[index] || null;
  photos.splice(index, 1);
  origs.splice(index, 1);
  if (photos.length === 0) {
    await remove(mr); // 메타 먼저 지워 완료 상태부터 해제
    await remove(pr);
    await remove(or);
  } else {
    await set(pr, photos);
    await set(or, origsForWrite(origs));
    await update(mr, { photoCount: photos.length });
  }
  if (typeof removedOrig === "string" && removedOrig) deleteOriginal(removedOrig); // 백그라운드 정리 (await 금지)
};

/** 관리자: 회원 계정 삭제 — 프로필/닉네임 예약/순위/권한/모든 제출을 멀티 경로 업데이트로 한 번에(원자적) 제거
    ※ Firebase 인증(AUTH) 계정 자체는 클라이언트 SDK로는 지울 수 없어 남는다
      → 그 사람이 다시 로그인하면 새 사용자로 취급되어 닉네임부터 다시 설정하게 됨.
    ※ Storage 원본(originals/{uid}/...)은 삭제 후 백그라운드로 재귀 정리(best-effort). */
window.fbAdminDeleteUser = async function (uid) {
  if (!currentUser || !currentIsAdmin) throw new Error("관리자만 사용할 수 있어요.");
  if (uid === currentUser.uid) throw new Error("본인 계정은 삭제할 수 없어요.");

  // 프로필 확인 — 마스터 관리자 보호 + 닉네임 예약 해제용 nick 확보
  const userSnap = await get(ref(db, "users/" + uid));
  const profile = userSnap.exists() ? userSnap.val() : {};
  if (ADMIN_EMAILS.includes(profile.email || "")) {
    throw new Error("마스터 관리자 계정은 삭제할 수 없어요.");
  }
  const nick = profile.nick || "";

  // 멀티 경로 업데이트 (null = 삭제) — 하나라도 실패하면 전체 롤백
  const updates = {};
  updates["users/" + uid] = null;
  updates["leaderboard/" + uid] = null;
  updates["admins/" + uid] = null;
  updates["mgRoles/" + uid] = null;
  updates["mgTeams/" + uid] = null;
  if (nick) updates["nicknames/" + nick] = null;
  for (let mid = 0; mid < 25; mid++) {
    updates["submissions/" + mid + "/" + uid] = null;
  }
  ["A", "B"].forEach((team) => {
    for (let mid = 0; mid < 25; mid++) {
      updates["mgSubmissions/" + team + "/" + mid + "/" + uid] = null;
      updates["mgPhotos/" + team + "/" + mid + "/" + uid] = null;
      updates["mgOrigs/" + team + "/" + mid + "/" + uid] = null;
    }
  });
  await update(ref(db), updates);

  // Storage 원본 폴더도 백그라운드 정리 (best-effort — 규칙상 로그인 사용자면 삭제 가능)
  deleteFolderRecursive("originals/" + uid);
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
   중고등부(팀 빙고) — 입장/팀 선택
   ※ A·B 두 팀이 하나의 보드를 함께 채우는 팀전.
     메타(mgSubmissions)와 사진(mgPhotos)을 분리 저장해 보드 구독을 가볍게 유지.
   ========================================================== */

/** 중고등부 입장 판정: 권한 없음 → denied / 팀 미선택 → needTeam / 입장 → 보드 구독 시작 */
window.fbMgEnter = async function () {
  if (!currentUser) return { denied: true };
  await refreshMgState(); // 관리자가 방금 권한/팀을 바꿨을 수 있으니 최신화
  if (!currentIsAdmin && !currentMgRole) return { denied: true };
  if (!currentIsAdmin && !currentMgTeam) return { needTeam: true };
  window.fbMgWatchBoard();
  return { team: currentMgTeam, isAdmin: currentIsAdmin };
};

/** 내 팀 최초 선택 — 보안규칙상 최초 1회만 성공 (이후엔 관리자만 변경 가능) */
window.fbMgSetMyTeam = async function (team) {
  if (!currentUser) throw new Error("로그인이 필요해요.");
  if (team !== "A" && team !== "B") throw new Error("잘못된 팀이에요.");
  await set(ref(db, "mgTeams/" + currentUser.uid), team);
  try {
    await update(ref(db, "users/" + currentUser.uid), { mgTeam: team }); // 표시용 미러
  } catch (e) { /* 미러 실패는 무시 (권위 데이터는 mgTeams) */ }
  currentMgTeam = team;
};

/* ==========================================================
   중고등부 — 보드/순위 실시간 구독 (A·B 두 팀 모두)
   ========================================================== */

/** A·B 두 팀의 mgSubmissions를 구독 → window.onMgData({A:{done,counts,mine}, B:{...}}, 내팀) */
window.fbMgWatchBoard = function () {
  window.fbMgUnwatchBoard();
  ["A", "B"].forEach((team) => {
    const unsub = onValue(ref(db, "mgSubmissions/" + team), (snap) => {
      mgBoardCache[team] = snap.exists() ? snap.val() : {};
      emitMgData();
    }, (err) => {
      console.warn("중고등부 보드 구독 오류(" + team + "팀):", err);
    });
    mgBoardUnsubs.push(unsub);
  });
};

window.fbMgUnwatchBoard = function () {
  mgBoardUnsubs.forEach((fn) => { try { fn(); } catch (e) {} });
  mgBoardUnsubs = [];
  mgBoardCache = { A: null, B: null };
};

/** 두 팀 캐시가 모두 준비되면 완료 맵/인원수/내 제출 메타를 계산해 app.js로 전달 */
function emitMgData() {
  if (mgBoardCache.A === null || mgBoardCache.B === null) return; // 둘 다 도착 후 렌더
  const out = {};
  ["A", "B"].forEach((team) => {
    const raw = mgBoardCache[team] || {};
    const done = {};   // { mid: true } — 유효 제출이 1명이라도 있으면 완료
    const counts = {}; // { mid: 유효 제출 인원수 }
    const mine = {};   // { mid: 내 제출 메타 }
    Object.keys(raw).forEach((mid) => {
      const subs = raw[mid] || {};
      let c = 0;
      Object.keys(subs).forEach((uid) => {
        const s = subs[uid] || {};
        const valid = (s.hasPhoto === true || s.test === true) && s.revoked !== true;
        if (valid) c++;
        if (currentUser && uid === currentUser.uid) mine[mid] = s;
      });
      if (c > 0) done[mid] = true;
      if (c > 0) counts[mid] = c;
    });
    out[team] = { done: done, counts: counts, mine: mine };
  });
  if (typeof window.onMgData === "function") window.onMgData(out, currentMgTeam);
}

/* ==========================================================
   중고등부 — 갤러리 (메타 구독 + 사진은 개별 get)
   ========================================================== */
window.fbMgWatchGallery = function (team, mid) {
  window.fbMgUnwatchGallery();
  mgGalleryKey = team + "/" + mid;
  const key = mgGalleryKey;
  const r = ref(db, "mgSubmissions/" + team + "/" + mid);
  mgGalleryUnsub = onValue(r, async (snap) => {
    const items = [];
    const photoGets = [];
    if (snap.exists()) {
      const val = snap.val();
      Object.keys(val).forEach((uid) => {
        const s = val[uid] || {};
        const item = {
          uid: uid,
          nick: s.nick || "",
          photo: "",
          photos: [],
          ts: s.ts || 0,
          test: s.test === true,
          revoked: s.revoked === true,
          revokeComment: s.revokeComment || ""
        };
        items.push(item);
        if (s.hasPhoto === true) {
          photoGets.push(
            get(ref(db, "mgPhotos/" + team + "/" + mid + "/" + uid))
              .then((ps) => {
                if (!ps.exists()) return;
                item.photos = toPhotoArray(ps.val()); // 예전 단일 문자열도 배열로 통일
                item.photo = item.photos[0] || "";
              })
              .catch(() => { /* 사진 못 읽어도 목록은 표시 */ })
          );
        }
      });
    }
    await Promise.all(photoGets);
    if (mgGalleryKey !== key) return; // 그 사이 다른 미션/팀으로 이동 → 무시
    window.renderMgGallery(mid, items);
  }, (err) => {
    console.warn("중고등부 갤러리 구독 오류:", err);
  });
};

window.fbMgUnwatchGallery = function () {
  if (mgGalleryUnsub) { try { mgGalleryUnsub(); } catch (e) {} mgGalleryUnsub = null; }
  mgGalleryKey = null;
};

/** 사진 배열 조회 (미션 모달의 "내 인증" 표시용 — 예전 단일 문자열 데이터도 배열로 통일) */
window.fbMgGetPhotos = async function (team, mid, uid) {
  const snap = await get(ref(db, "mgPhotos/" + team + "/" + mid + "/" + uid));
  return snap.exists() ? toPhotoArray(snap.val()) : [];
};

/** 사진 1장(대표) 조회 — 예전 호환용 */
window.fbMgGetPhoto = async function (team, mid, uid) {
  const photos = await window.fbMgGetPhotos(team, mid, uid);
  return photos[0] || "";
};

/* ==========================================================
   중고등부 — 업로드 / 삭제 / 테스트 체크 / 체크 해제
   ※ 한 칸에 최대 3장 — mgPhotos/$team/$mid/$uid 는 사진 배열
   ========================================================== */

/** 인증샷 업로드 — 사진(mgPhotos) 먼저, 메타(mgSubmissions)는 나중에 (사진 없는 완료 순간 방지)
    기존 사진 뒤에 이어붙임 (3장 초과 시 MAX_PHOTOS)
    원본 파일(originalFile)은 Storage에 보존용으로 추가 저장, 경로는 mgOrigs에 기록 (모두 best-effort) */
window.fbMgUpload = async function (team, mid, dataUrl, originalFile) {
  if (!currentUser) throw new Error("로그인이 필요해요.");
  const pr = ref(db, "mgPhotos/" + team + "/" + mid + "/" + currentUser.uid);
  const or = ref(db, "mgOrigs/" + team + "/" + mid + "/" + currentUser.uid);
  const snap = await get(pr);
  const photos = snap.exists() ? toPhotoArray(snap.val()) : [];
  if (photos.length >= 3) throw new Error("MAX_PHOTOS");

  // 기존 원본 경로 읽기 — 실패해도 업로드는 계속 (photos와 같은 인덱스로 유지)
  let origs = toOrigArray(null, photos.length);
  try {
    const oSnap = await get(or);
    if (oSnap.exists()) origs = toOrigArray(oSnap.val(), photos.length);
  } catch (e) { /* 원본 경로 못 읽어도 무시 */ }

  // 원본 아카이브 (Storage) — 어떤 이유로 실패해도 아래 압축본 저장은 계속
  const origPath = await uploadOriginal(
    "originals/" + currentUser.uid + "/mg/" + team + "/" + mid + "/" + newPhotoId() + ".jpg",
    originalFile
  );

  photos.push(dataUrl);
  origs.push(origPath);
  await set(pr, photos);
  try {
    await set(or, origsForWrite(origs)); // 원본 경로 기록 실패해도 게임 진행에는 영향 없음
  } catch (e) { console.warn("원본 경로 기록 실패:", e); }
  await set(ref(db, "mgSubmissions/" + team + "/" + mid + "/" + currentUser.uid), {
    nick: currentNick,
    hasPhoto: true,
    photoCount: photos.length,
    ts: Date.now(),
    revoked: false
  });
};

/** 내 인증샷 1장 삭제 — 남은 사진이 없으면 메타 먼저 지워 완료 상태부터 해제
    Storage에 원본이 있으면 함께 삭제 (best-effort) */
window.fbMgDeletePhoto = async function (team, mid, index) {
  if (!currentUser) throw new Error("로그인이 필요해요.");
  const pr = ref(db, "mgPhotos/" + team + "/" + mid + "/" + currentUser.uid);
  const or = ref(db, "mgOrigs/" + team + "/" + mid + "/" + currentUser.uid);
  const mr = ref(db, "mgSubmissions/" + team + "/" + mid + "/" + currentUser.uid);
  const snap = await get(pr);
  const photos = snap.exists() ? toPhotoArray(snap.val()) : [];

  // 원본 경로도 같은 인덱스로 정렬 유지 (못 읽어도 삭제는 계속)
  let origs = toOrigArray(null, photos.length);
  try {
    const oSnap = await get(or);
    if (oSnap.exists()) origs = toOrigArray(oSnap.val(), photos.length);
  } catch (e) { /* 무시 */ }

  const removedOrig = origs[index] || null;
  photos.splice(index, 1); // 해당 장만 빼고 배열 재구성 → 자동 재정렬
  origs.splice(index, 1);
  if (photos.length === 0) {
    await remove(mr);
    await remove(pr);
    try { await remove(or); } catch (e) { /* 무시 */ }
  } else {
    await set(pr, photos);
    try { await set(or, origsForWrite(origs)); } catch (e) { /* 무시 */ }
    await update(mr, { photoCount: photos.length });
  }
  deleteOriginal(removedOrig); // 원본은 백그라운드 정리 (await 금지 — UI 멈춤 방지)
};

/** 내 인증샷 전체 삭제 (칸 통째로 — 예전 호환용, 메타 먼저 지워 완료 상태부터 해제) */
window.fbMgDelete = async function (team, mid) {
  if (!currentUser) throw new Error("로그인이 필요해요.");
  await remove(ref(db, "mgSubmissions/" + team + "/" + mid + "/" + currentUser.uid));
  await remove(ref(db, "mgPhotos/" + team + "/" + mid + "/" + currentUser.uid));
};

/** 관리자 테스트 체크 — 사진 없이 메타만 기록 (mgPhotos에는 아무것도 안 씀) */
window.fbMgTestCheck = async function (team, mid, on) {
  if (!currentUser || !currentIsAdmin) throw new Error("관리자만 사용할 수 있어요.");
  if (on) {
    await set(ref(db, "mgSubmissions/" + team + "/" + mid + "/" + currentUser.uid), {
      nick: currentNick,
      ts: Date.now(),
      test: true,
      revoked: false
    });
  } else {
    await remove(ref(db, "mgSubmissions/" + team + "/" + mid + "/" + currentUser.uid));
    await remove(ref(db, "mgPhotos/" + team + "/" + mid + "/" + currentUser.uid));
  }
};

/** 관리자 체크 해제 (중고등부) */
window.fbMgRevoke = async function (team, mid, uid, comment) {
  if (!currentUser || !currentIsAdmin) throw new Error("관리자만 사용할 수 있어요.");
  await update(ref(db, "mgSubmissions/" + team + "/" + mid + "/" + uid), {
    revoked: true,
    revokeComment: comment,
    revokeBy: currentNick,
    revokeTs: Date.now()
  });
};

/* ==========================================================
   중고등부 — 관리자: 권한 부여/해제, 팀 변경
   ========================================================== */

/** 중고등부 권한 지정/해제 — mgRoles 노드 + users 미러 동기화 (해제 시 팀도 초기화) */
window.fbSetMgRole = async function (uid, on) {
  if (!currentUser || !currentIsAdmin) throw new Error("관리자만 사용할 수 있어요.");
  if (on) {
    await set(ref(db, "mgRoles/" + uid), true);
    await update(ref(db, "users/" + uid), { mgRole: true });
  } else {
    await remove(ref(db, "mgRoles/" + uid));
    await remove(ref(db, "mgTeams/" + uid));
    await update(ref(db, "users/" + uid), { mgRole: false, mgTeam: null });
  }
  if (currentUser.uid === uid) await refreshMgState();
};

/** 관리자의 팀 변경 (멤버 본인은 최초 1회만, 관리자는 언제든) */
window.fbAdminSetMgTeam = async function (uid, team) {
  if (!currentUser || !currentIsAdmin) throw new Error("관리자만 사용할 수 있어요.");
  if (team !== "A" && team !== "B") throw new Error("잘못된 팀이에요.");
  await set(ref(db, "mgTeams/" + uid), team);
  await update(ref(db, "users/" + uid), { mgTeam: team });
  if (currentUser.uid === uid) currentMgTeam = team;
};

/* ==========================================================
   채팅 (청년회 메인) — chat/$pushId = { uid, nick, text, ts }
   ========================================================== */

/** 최근 200개 + 신규 메시지 실시간 구독 → window.onChatMessage(msg) */
window.fbChatWatch = function () {
  window.fbChatUnwatch();
  if (typeof window.clearChat === "function") window.clearChat(); // 재구독 시 중복 방지
  const q = query(ref(db, "chat"), limitToLast(200));
  chatUnsub = onChildAdded(q, (snap) => {
    const v = snap.val() || {};
    if (typeof window.onChatMessage === "function") {
      window.onChatMessage({
        id: snap.key,
        uid: v.uid || "",
        nick: v.nick || "",
        text: typeof v.text === "string" ? v.text : "",
        ts: v.ts || 0
      });
    }
  }, (err) => {
    console.warn("채팅 구독 오류:", err);
  });
};

/** 메시지 전송 (빈 문자열 무시, 500자 제한) */
window.fbChatSend = async function (text) {
  if (!currentUser || !currentNick) throw new Error("로그인이 필요해요.");
  const trimmed = String(text || "").trim();
  if (!trimmed) return;
  await push(ref(db, "chat"), {
    uid: currentUser.uid,
    nick: currentNick,
    text: trimmed.slice(0, 500),
    ts: Date.now()
  });
};

window.fbChatUnwatch = function () {
  if (chatUnsub) { try { chatUnsub(); } catch (e) {} chatUnsub = null; }
};

/* ==========================================================
   구독 정리 (로그아웃 시)
   ========================================================== */
function cleanupSubscriptions() {
  unsubscribeMySubmissions();
  window.fbUnwatchGallery();
  window.fbUnwatchUsers();
  window.fbMgUnwatchBoard();
  window.fbMgUnwatchGallery();
  window.fbChatUnwatch();
  if (lbUnsub) { try { lbUnsub(); } catch (e) {} lbUnsub = null; }
  mySubs = {};
  lastLBKey = null;
  lbReady = false;
  currentMgRole = false;
  currentMgTeam = null;
}

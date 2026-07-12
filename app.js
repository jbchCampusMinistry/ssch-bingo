/* ==========================================================
   '즐거이' 하계수양회 BINGO — app.js (일반 스크립트)
   역할: 빙고판 렌더링/판정, 사진 압축, 모달/토스트 등 UI 로직,
         순위 렌더링. firebase.js(ES 모듈)와는 window 전역 함수로 연결.
   ========================================================== */

"use strict";

/* ---------- 25개 미션 (index 0~24, 행 우선 = 좌→우, 위→아래) ---------- */
var MISSIONS = [
  "두 렙돈 헌금하기",
  "새참자에게 간식 사주기",
  "봉사자분들과 사진찍기",
  "새 영혼을 위해 기도하기 (톡방에 기도했습니다)",
  "하계수양회 or 그리스도인 5행시 카톡방 올리기",
  "청년회 푯대말씀 암송 영상 인증 (고전 15:58)",
  "부서 형제 자매 4인 이상 모여서 사진찍기",
  "침례현장에 함께하기 (인증샷)",
  "자기 이름 스크랩해서 인증샷",
  "포토존에서 청년회 슬로건 외치기 (영상 촬영)",
  "서점에 들려 마음을 울리는 말씀, 글귀 공유",
  "소망의 동산 가서 동상 포즈 따라하기",
  "잃어진 영혼에게 하계 권유하기",   // 12번: 중앙 하트 강조 칸 (실제 미션, 프리칸 아님)
  "말씀현장 인증하기",
  "상담 받기 or 인도하기",
  "잔반 남기지 않기 (3번 이상)",
  "오전중에 매일 큐티 인증하기",
  "설교 중에 와닿는 말씀 or 내용 공유하기",
  "떨어진 쓰레기 줍고 인증하기",
  "한 차수 동안 SNS하지 않기 (스크린 타임 인증, 카톡 제외)",
  "기념품 사기",
  "한 차수 전참하기",
  "한 영혼 인도하기",
  "매점음식 인증샷",
  "다른 차수 참석하기"
];

/* ---------- 빙고 줄 정의: 5행 + 5열 + 2대각 = 12줄 ---------- */
var BINGO_LINES = (function () {
  var lines = [];
  var r, c;
  for (r = 0; r < 5; r++) {                       // 가로 5줄
    lines.push([r * 5, r * 5 + 1, r * 5 + 2, r * 5 + 3, r * 5 + 4]);
  }
  for (c = 0; c < 5; c++) {                       // 세로 5줄
    lines.push([c, c + 5, c + 10, c + 15, c + 20]);
  }
  lines.push([0, 6, 12, 18, 24]);                 // 대각 ↘
  lines.push([4, 8, 12, 16, 20]);                 // 대각 ↙
  return lines;
})();

/* ---------- 앱 상태 ---------- */
var APP_STATE = {
  user: null,          // { uid, email }
  nick: "",
  isAdmin: false,
  mySubs: {},          // { mid: { photo, ts, revoked, revokeComment, revokeBy, ... } }
  gallery: {},         // { mid: [ { uid, nick, photo, ts, revoked, ... } ] }
  currentMid: null,    // 열려 있는 미션 상세 모달의 미션 번호
  revokeTarget: null,  // { mid, uid, nick } 체크 해제 대상
  adminDetail: null,   // { uid, nick } 관리자 패널에서 보고 있는 회원
  uploading: false
};

/* 마스터 관리자 이메일 (firebase.js의 ADMIN_EMAILS와 동일 — UI 표시용) */
var MASTER_EMAILS = ["tjswp757@gmail.com", "tjswo757@gmail.com"];

/* ==========================================================
   초기화 (body onload + 스크립트 하단에서 호출, 중복 방지)
   ========================================================== */
function initApp() {
  if (window.__appInited) return;
  window.__appInited = true;

  buildBoard();

  // 화면 크기 변화/폰트 로드 시 빙고 줄 다시 그리기(칸 위치 재측정 → 어긋남 방지)
  var _rzTimer = null;
  window.addEventListener("resize", function () {
    if (_rzTimer) clearTimeout(_rzTimer);
    _rzTimer = setTimeout(drawBingoLines, 120);
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { drawBingoLines(); });
  }

  // 닉네임 입력에서 Enter로 저장
  var nickInput = document.getElementById("nickInput");
  nickInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") handleSaveNick();
  });

  // 서비스워커 등록 (지원 브라우저 + http(s) 환경에서만)
  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
    navigator.serviceWorker.register("./sw.js").catch(function (err) {
      console.warn("서비스워커 등록 실패:", err);
    });
  }
}

/* ==========================================================
   빙고판 렌더링
   ========================================================== */

/** 5×5 칸 DOM 생성 (1회) */
function buildBoard() {
  var board = document.getElementById("board");
  if (!board || board.childElementCount > 0) return;

  var i;
  for (i = 0; i < 25; i++) {
    var cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cell" + (i === 12 ? " center" : "");
    cell.dataset.mid = String(i);
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("aria-label", (i + 1) + "번 미션: " + MISSIONS[i]);

    // 중앙 칸은 핑크 하트 배경 SVG
    if (i === 12) {
      cell.innerHTML =
        '<svg class="heart-bg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
        '<path d="M50 92 C20 70 4 52 4 32 C4 16 16 6 29 6 C38 6 46 11 50 19 C54 11 62 6 71 6 C84 6 96 16 96 32 C96 52 80 70 50 92 Z"/>' +
        "</svg>";
    }

    var label = document.createElement("span");
    label.className = "cell-label";
    label.textContent = MISSIONS[i];
    cell.appendChild(label);

    var check = document.createElement("span");
    check.className = "check-mark";
    check.textContent = "✓";
    cell.appendChild(check);

    var dot = document.createElement("span");
    dot.className = "revoke-dot";
    cell.appendChild(dot);

    cell.addEventListener("click", (function (mid) {
      return function () { openMissionModal(mid); };
    })(i));

    board.appendChild(cell);
  }
}

/** mid 칸이 "체크됨" 상태인지 (사진 인증 or 관리자 테스트 체크 && 해제 안 됨) */
function isChecked(mid) {
  var sub = APP_STATE.mySubs[mid];
  return !!(sub && (sub.photo || sub.test) && sub.revoked !== true);
}

/** 내 제출 상태를 빙고판에 반영 (칠하기 + 빨간 줄 + 요약 숫자) */
function refreshBoard() {
  buildBoard(); // 안전장치 (렌더 전 호출 대비)

  var checks = 0;
  var i;
  for (i = 0; i < 25; i++) {
    var cell = document.querySelector('.cell[data-mid="' + i + '"]');
    if (!cell) continue;
    var sub = APP_STATE.mySubs[i];
    var done = isChecked(i);
    var revoked = !!(sub && sub.revoked === true);
    cell.classList.toggle("done", done);
    cell.classList.toggle("revoked", revoked);
    if (done) checks++;
  }

  var bingos = countBingos();
  drawBingoLines();

  var elB = document.getElementById("statBingos");
  var elC = document.getElementById("statChecks");
  if (elB) elB.textContent = String(bingos);
  if (elC) elC.textContent = String(checks);

  // 내 순위 데이터(leaderboard) 갱신 요청 → firebase.js
  if (APP_STATE.user && APP_STATE.nick && typeof window.fbUpdateLeaderboard === "function") {
    window.fbUpdateLeaderboard(checks, bingos);
  }
}

/** 완성된 빙고 줄 수 */
function countBingos() {
  var count = 0;
  BINGO_LINES.forEach(function (line) {
    if (line.every(isChecked)) count++;
  });
  return count;
}

/** 완성된 줄 위에 빨간 반투명 선 오버레이 (여러 줄 동시 표시) */
function drawBingoLines() {
  var svg = document.getElementById("lineOverlay");
  var wrap = document.querySelector(".board-wrap");
  if (!svg || !wrap) return;
  svg.innerHTML = "";

  // 실제 렌더된 칸 위치를 픽셀로 측정 → 칸 높이가 제각각이어도 줄이 정확히 정렬됨
  var W = wrap.clientWidth, H = wrap.clientHeight;
  if (!W || !H) return;
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);

  function center(idx) {
    var cell = document.querySelector('.cell[data-mid="' + idx + '"]');
    if (!cell) return null;
    return { x: cell.offsetLeft + cell.offsetWidth / 2, y: cell.offsetTop + cell.offsetHeight / 2 };
  }

  BINGO_LINES.forEach(function (line) {
    if (!line.every(isChecked)) return;
    var a = center(line[0]), b = center(line[4]);
    if (!a || !b) return;
    var el = document.createElementNS("http://www.w3.org/2000/svg", "line");
    el.setAttribute("x1", a.x); el.setAttribute("y1", a.y);
    el.setAttribute("x2", b.x); el.setAttribute("y2", b.y);
    svg.appendChild(el);
  });
}

/* ==========================================================
   화면 전환 (firebase.js가 호출)
   ========================================================== */

/** 로그인 화면 표시 */
window.showLogin = function () {
  APP_STATE.user = null;
  APP_STATE.nick = "";
  APP_STATE.isAdmin = false;
  APP_STATE.mySubs = {};
  APP_STATE.gallery = {};
  document.getElementById("mainView").classList.add("hidden");
  document.getElementById("loginView").classList.remove("hidden");
  closeMissionModal();
  closeRevokeModal();
  closeAdminPanel();
  document.getElementById("nickModal").classList.add("hidden");
  hideLoading();
};

/** 메인(빙고) 화면 표시 */
window.showMain = function (user, nick, isAdmin) {
  APP_STATE.user = user;
  APP_STATE.nick = nick;
  APP_STATE.isAdmin = !!isAdmin;

  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("mainView").classList.remove("hidden");
  document.getElementById("nickModal").classList.add("hidden");

  // 관리자면 헤더의 자기 이름 클릭 → 관리자 패널
  var nickEl = document.getElementById("userNick");
  if (APP_STATE.isAdmin) {
    nickEl.textContent = nick + " 님 ⚙";
    nickEl.classList.add("admin-clickable");
    nickEl.onclick = openAdminPanel;
    nickEl.title = "관리자 패널 열기";
  } else {
    nickEl.textContent = nick + " 님";
    nickEl.classList.remove("admin-clickable");
    nickEl.onclick = null;
    nickEl.title = "";
  }
  document.getElementById("adminBadge").classList.toggle("hidden", !isAdmin);

  buildBoard();
  refreshBoard();
  hideLoading();
};

/** 닉네임 설정 모달 표시 (첫 로그인) */
window.showNickModal = function () {
  hideLoading();
  document.getElementById("nickError").classList.add("hidden");
  document.getElementById("nickInput").value = "";
  document.getElementById("nickModal").classList.remove("hidden");
  setTimeout(function () { document.getElementById("nickInput").focus(); }, 100);
};

/** Firebase 설정이 아직 자리표시자일 때 안내 (firebase.js가 호출) */
window.setConfigNotice = function (msg) {
  var el = document.getElementById("configNotice");
  el.textContent = msg;
  el.classList.remove("hidden");
  document.getElementById("btnLogin").disabled = true;
};

/* ==========================================================
   데이터 수신 콜백 (firebase.js가 호출)
   ========================================================== */

/** 내 제출 전체(25칸) 갱신 */
window.onMySubmissions = function (subsMap) {
  APP_STATE.mySubs = subsMap || {};
  refreshBoard();
  // 미션 상세 모달이 열려 있으면 내 인증 영역도 다시 그림
  if (APP_STATE.currentMid !== null) renderMyProof(APP_STATE.currentMid);
};

/** 특정 미션의 갤러리 갱신 */
window.renderGallery = function (mid, items) {
  APP_STATE.gallery[mid] = items || [];
  if (APP_STATE.currentMid !== mid) return;

  var grid = document.getElementById("galleryGrid");
  grid.innerHTML = "";

  var visible = (items || []).slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
  if (visible.length === 0) {
    var p = document.createElement("p");
    p.className = "gallery-empty";
    p.textContent = "아직 인증한 사람이 없어요. 첫 번째가 되어 보세요!";
    grid.appendChild(p);
    return;
  }

  visible.forEach(function (item) {
    var revoked = item.revoked === true;
    var div = document.createElement("div");
    div.className = "gallery-item" + (revoked ? " revoked" : "");

    if (item.photo) {
      var img = document.createElement("img");
      img.src = item.photo;
      img.alt = item.nick + " 님의 인증샷";
      img.loading = "lazy";
      img.addEventListener("click", function () { openLightbox(item.photo); });
      div.appendChild(img);
    } else if (item.test) {
      // 관리자 테스트 체크 (사진 없음) → 플레이스홀더 타일
      var ph = document.createElement("div");
      ph.className = "gi-test-ph";
      ph.textContent = "🧪 테스트 체크";
      div.appendChild(ph);
    }

    var nickEl = document.createElement("div");
    nickEl.className = "gi-nick";
    nickEl.textContent = item.nick || "(닉네임 없음)";
    div.appendChild(nickEl);

    if (revoked) {
      var tag = document.createElement("div");
      tag.className = "gi-revoked-tag";
      tag.textContent = "체크 해제됨";
      div.appendChild(tag);
    } else if (APP_STATE.isAdmin && APP_STATE.user && item.uid !== APP_STATE.user.uid) {
      // 관리자: 타인의 유효한 인증에 [체크 해제] 버튼
      var actions = document.createElement("div");
      actions.className = "gi-actions";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-revoke";
      btn.textContent = "체크 해제";
      btn.addEventListener("click", function () {
        openRevokeModal(mid, item.uid, item.nick);
      });
      actions.appendChild(btn);
      div.appendChild(actions);
    }

    grid.appendChild(div);
  });
};

/** 순위 리스트 렌더링 — 빙고 줄 수 → 체크 수 내림차순 */
window.renderLeaderboard = function (entries) {
  var list = document.getElementById("rankList");
  if (!list) return;
  list.innerHTML = "";

  var arr = (entries || []).slice();
  arr.sort(function (a, b) {
    if ((b.bingos || 0) !== (a.bingos || 0)) return (b.bingos || 0) - (a.bingos || 0);
    if ((b.checks || 0) !== (a.checks || 0)) return (b.checks || 0) - (a.checks || 0);
    return (a.ts || 0) - (b.ts || 0); // 동점이면 먼저 달성한 사람이 위
  });

  if (arr.length === 0) {
    var li = document.createElement("li");
    li.className = "rank-empty";
    li.textContent = "아직 참가자가 없어요";
    list.appendChild(li);
    return;
  }

  var medals = ["🥇", "🥈", "🥉"];
  var prevKey = null, prevRank = 0;

  arr.forEach(function (e, i) {
    var key = (e.bingos || 0) + ":" + (e.checks || 0);
    var rank = (key === prevKey) ? prevRank : i + 1; // 동점 공동 순위
    prevKey = key; prevRank = rank;

    var li = document.createElement("li");
    if (APP_STATE.user && e.uid === APP_STATE.user.uid) li.classList.add("me");

    var no = document.createElement("span");
    no.className = "rank-no";
    no.textContent = rank <= 3 ? medals[rank - 1] : String(rank);

    var nick = document.createElement("span");
    nick.className = "rank-nick";
    nick.textContent = e.nick || "(닉네임 없음)";

    var bingo = document.createElement("span");
    bingo.className = "rank-bingo";
    bingo.textContent = "빙고 " + (e.bingos || 0) + "줄";

    var checks = document.createElement("span");
    checks.className = "rank-checks";
    checks.textContent = "체크 " + (e.checks || 0) + "개";

    li.appendChild(no); li.appendChild(nick); li.appendChild(bingo); li.appendChild(checks);
    list.appendChild(li);
  });
};

/* ==========================================================
   로그인 / 로그아웃 / 닉네임 (버튼 핸들러)
   ========================================================== */

function handleLogin() {
  if (typeof window.fbLogin !== "function") {
    showToast("Firebase 모듈을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
    return;
  }
  window.fbLogin();
}

function handleLogout() {
  if (typeof window.fbLogout === "function") window.fbLogout();
}

function handleSaveNick() {
  var input = document.getElementById("nickInput");
  var errEl = document.getElementById("nickError");
  var nick = (input.value || "").trim();

  // 2~12자, 한글/영문/숫자만 (Firebase 키 금지문자 . # $ [ ] / 차단)
  if (nick.length < 2 || nick.length > 12) {
    errEl.textContent = "닉네임은 2~12자로 입력해 주세요.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!/^[가-힣a-zA-Z0-9]+$/.test(nick)) {
    errEl.textContent = "한글, 영문, 숫자만 사용할 수 있어요.";
    errEl.classList.remove("hidden");
    return;
  }
  errEl.classList.add("hidden");

  if (typeof window.fbSaveNickname !== "function") return;
  showLoading();
  window.fbSaveNickname(nick)
    .then(function () {
      hideLoading();
    })
    .catch(function (err) {
      hideLoading();
      errEl.textContent = err && err.message ? err.message : "닉네임 저장에 실패했어요.";
      errEl.classList.remove("hidden");
    });
}

/* ==========================================================
   미션 상세 모달
   ========================================================== */

function openMissionModal(mid) {
  if (!APP_STATE.user) return;
  APP_STATE.currentMid = mid;

  document.getElementById("missionNo").textContent = "MISSION " + (mid + 1) + " / 25";
  document.getElementById("missionText").textContent = MISSIONS[mid];
  renderMyProof(mid);

  // 갤러리는 캐시 먼저 보여주고 실시간 구독 시작
  window.renderGallery(mid, APP_STATE.gallery[mid] || []);
  if (typeof window.fbWatchGallery === "function") window.fbWatchGallery(mid);

  document.getElementById("missionModal").classList.remove("hidden");
}

function closeMissionModal() {
  APP_STATE.currentMid = null;
  if (typeof window.fbUnwatchGallery === "function") window.fbUnwatchGallery();
  document.getElementById("missionModal").classList.add("hidden");
}

/** 오버레이(바깥) 클릭 시에만 닫기 */
function closeMissionModalFromOverlay(e) {
  if (e.target === document.getElementById("missionModal")) closeMissionModal();
}

/** 미션 상세 모달의 "내 인증" 영역 렌더링 */
function renderMyProof(mid) {
  var box = document.getElementById("myProof");
  box.innerHTML = "";

  var label = document.createElement("div");
  label.className = "my-proof-label";
  label.textContent = "내 인증";
  box.appendChild(label);

  var sub = APP_STATE.mySubs[mid];

  // 관리자에게 해제된 경우 → 코멘트 표시 (빨간 글씨, 사진/테스트 공통)
  if (sub && sub.revoked === true) {
    var cmt = document.createElement("div");
    cmt.className = "admin-comment";
    var lb = document.createElement("span");
    lb.className = "ac-label";
    lb.textContent = "⚠ 관리자에 의해 체크가 해제되었어요";
    cmt.appendChild(lb);
    var txt = document.createElement("span");
    txt.textContent = "관리자 코멘트: " + (sub.revokeComment || "(코멘트 없음)") +
      (sub.revokeBy ? " — " + sub.revokeBy : "");
    cmt.appendChild(txt);
    box.appendChild(cmt);
  }

  if (sub && sub.photo) {
    var img = document.createElement("img");
    img.src = sub.photo;
    img.alt = "내 인증샷";
    img.addEventListener("click", function () { openLightbox(sub.photo); });
    box.appendChild(img);

    var btns = document.createElement("div");
    btns.className = "my-proof-btns";

    var reBtn = document.createElement("button");
    reBtn.type = "button";
    reBtn.className = "btn btn-primary btn-sm";
    reBtn.textContent = "다시 올리기";
    reBtn.addEventListener("click", pickPhoto);
    btns.appendChild(reBtn);

    var delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-ghost btn-sm";
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", function () {
      if (!confirm("인증사진을 삭제할까요? 칸 체크도 함께 사라져요.")) return;
      if (typeof window.fbDeleteSubmission === "function") {
        showLoading();
        window.fbDeleteSubmission(mid)
          .then(function () { hideLoading(); showToast("삭제했어요."); })
          .catch(function () { hideLoading(); showToast("삭제에 실패했어요. 다시 시도해 주세요."); });
      }
    });
    btns.appendChild(delBtn);

    box.appendChild(btns);
  } else if (sub && sub.test) {
    // 관리자 테스트 체크 상태 (사진 없음)
    var testInfo = document.createElement("p");
    testInfo.className = "test-check-info";
    testInfo.textContent = "🧪 테스트 체크로 완료된 칸이에요 (사진 없음)";
    box.appendChild(testInfo);

    if (APP_STATE.isAdmin) {
      var offBtn = document.createElement("button");
      offBtn.type = "button";
      offBtn.className = "btn btn-ghost btn-sm btn-test";
      offBtn.textContent = "🧪 테스트 체크 해제";
      offBtn.addEventListener("click", function () { handleTestCheck(mid, false); });
      box.appendChild(offBtn);
    }
  } else {
    var upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "btn btn-primary";
    upBtn.textContent = "📷 내 인증사진 올리기";
    upBtn.addEventListener("click", pickPhoto);
    box.appendChild(upBtn);

    // 관리자: 사진 없이 칸을 체크해 볼 수 있는 테스트 버튼
    if (APP_STATE.isAdmin) {
      var onBtn = document.createElement("button");
      onBtn.type = "button";
      onBtn.className = "btn btn-ghost btn-sm btn-test";
      onBtn.textContent = "🧪 테스트 체크 (사진 없이)";
      onBtn.addEventListener("click", function () { handleTestCheck(mid, true); });
      box.appendChild(onBtn);
    }
  }
}

/** 관리자 테스트 체크/해제 처리 */
function handleTestCheck(mid, on) {
  if (typeof window.fbTestCheck !== "function") return;
  showLoading();
  window.fbTestCheck(mid, on)
    .then(function () {
      hideLoading();
      showToast(on ? "테스트 체크했어요 🧪" : "테스트 체크를 해제했어요.");
    })
    .catch(function (err) {
      hideLoading();
      console.warn("테스트 체크 실패:", err);
      showToast("테스트 체크에 실패했어요. 권한/네트워크를 확인해 주세요.");
    });
}

/* ==========================================================
   사진 선택 → 압축 → 업로드
   ========================================================== */

function pickPhoto() {
  if (APP_STATE.uploading) return;
  document.getElementById("photoInput").click();
}

function handlePhotoSelected(e) {
  var file = e.target.files && e.target.files[0];
  e.target.value = ""; // 같은 파일 재선택 가능하게 초기화
  if (!file || APP_STATE.currentMid === null) return;

  if (!/^image\//.test(file.type)) {
    showToast("이미지 파일만 올릴 수 있어요.");
    return;
  }

  APP_STATE.uploading = true;
  showLoading();

  compressImage(file)
    .then(function (dataUrl) {
      if (typeof window.fbUploadSubmission !== "function") {
        throw new Error("Firebase 미연결");
      }
      return window.fbUploadSubmission(APP_STATE.currentMid, dataUrl);
    })
    .then(function () {
      APP_STATE.uploading = false;
      hideLoading();
      showToast("인증 완료! 칸이 칠해졌어요 🎉");
    })
    .catch(function (err) {
      APP_STATE.uploading = false;
      hideLoading();
      console.warn("업로드 실패:", err);
      showToast(err && err.message === "TOO_LARGE"
        ? "사진 용량을 줄이지 못했어요. 다른 사진으로 시도해 주세요."
        : "업로드에 실패했어요. 네트워크를 확인해 주세요.");
    });
}

/**
 * 사진 압축 (무료 DB 저장을 위해 필수!)
 * - 최대 변 800px로 리사이즈, JPEG q=0.7
 * - dataURL이 여전히 크면 품질↓ → 그래도 크면 크기↓ 재시도
 * - 목표 ~60-120KB, DB 규칙 상한 400,000자(base64) 이내
 * @param {File} file
 * @returns {Promise<string>} 압축된 base64 dataURL
 */
function compressImage(file) {
  var MAX_SIDE = 800;
  var LIMIT = 272000; // base64 약 200KB에 해당하는 문자 수
  var HARD_LIMIT = 390000; // DB 규칙(400,000자) 여유분

  return loadImageSource(file).then(function (img) {
    var w = img.width, h = img.height;
    var side = MAX_SIDE;

    function render(sideLimit, quality) {
      var scale = Math.min(1, sideLimit / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * scale));
      var ch = Math.max(1, Math.round(h * scale));
      var canvas = document.createElement("canvas");
      canvas.width = cw; canvas.height = ch;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; // PNG 투명영역 → 흰 배경
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, 0, 0, cw, ch);
      return canvas.toDataURL("image/jpeg", quality);
    }

    // 1차: 800px / q0.7 → 크면 품질 단계적으로 낮춤 → 그래도 크면 축소
    var qualities = [0.7, 0.55, 0.4, 0.3];
    var dataUrl = "";
    var qi;
    for (qi = 0; qi < qualities.length; qi++) {
      dataUrl = render(side, qualities[qi]);
      if (dataUrl.length <= LIMIT) return dataUrl;
    }
    // 크기 자체를 줄여가며 재시도
    while (side > 300) {
      side = Math.round(side * 0.75);
      dataUrl = render(side, 0.5);
      if (dataUrl.length <= LIMIT) return dataUrl;
    }
    if (dataUrl.length <= HARD_LIMIT) return dataUrl;
    throw new Error("TOO_LARGE");
  });
}

/**
 * 파일 → 그리기 가능한 이미지 소스 로드
 * createImageBitmap(EXIF 회전 자동 적용)을 우선 사용, 실패 시 <img> 폴백
 */
function loadImageSource(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file, { imageOrientation: "from-image" })
      .catch(function () { return createImageBitmap(file); })
      .catch(function () { return loadViaImgTag(file); });
  }
  return loadViaImgTag(file);
}

function loadViaImgTag(file) {
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("이미지를 읽을 수 없어요")); };
    img.src = url;
  });
}

/* ==========================================================
   관리자 체크 해제 모달
   ========================================================== */

function openRevokeModal(mid, uid, nick) {
  APP_STATE.revokeTarget = { mid: mid, uid: uid, nick: nick };
  document.getElementById("revokeTarget").textContent =
    "“" + (nick || "이 사용자") + "” 님의 「" + MISSIONS[mid] + "」 인증을 해제합니다.";
  document.getElementById("revokeComment").value = "";
  document.getElementById("revokeError").classList.add("hidden");
  document.getElementById("revokeModal").classList.remove("hidden");
}

function closeRevokeModal() {
  APP_STATE.revokeTarget = null;
  document.getElementById("revokeModal").classList.add("hidden");
}

function handleConfirmRevoke() {
  var target = APP_STATE.revokeTarget;
  if (!target) return;

  var comment = (document.getElementById("revokeComment").value || "").trim();
  var errEl = document.getElementById("revokeError");
  if (!comment) {
    errEl.textContent = "해제 사유(코멘트)를 꼭 입력해 주세요.";
    errEl.classList.remove("hidden");
    return;
  }
  errEl.classList.add("hidden");

  if (typeof window.fbRevoke !== "function") return;
  showLoading();
  window.fbRevoke(target.mid, target.uid, comment)
    .then(function () {
      hideLoading();
      closeRevokeModal();
      showToast("체크를 해제했어요.");
      // 관리자 패널의 회원 상세를 보고 있었다면 최신 상태로 재조회
      if (APP_STATE.adminDetail && APP_STATE.adminDetail.uid === target.uid) {
        openAdminUserDetail(APP_STATE.adminDetail.uid, APP_STATE.adminDetail.nick);
      }
    })
    .catch(function (err) {
      hideLoading();
      errEl.textContent = "해제에 실패했어요. DB에 admins/" + (APP_STATE.user ? APP_STATE.user.uid : "내UID") +
        " = true 가 등록되어 있는지 확인해 주세요.";
      errEl.classList.remove("hidden");
      console.warn("체크 해제 실패:", err);
    });
}

/* ==========================================================
   관리자 패널 (헤더의 자기 이름 클릭 → 열림)
   ========================================================== */

/** 관리자 패널 열기 — 회원 목록 뷰 + 실시간 구독 시작 */
function openAdminPanel() {
  if (!APP_STATE.isAdmin) return;
  APP_STATE.adminDetail = null;
  document.getElementById("adminUsersView").classList.remove("hidden");
  document.getElementById("adminUserDetail").classList.add("hidden");
  document.getElementById("adminModal").classList.remove("hidden");
  if (typeof window.fbWatchUsers === "function") window.fbWatchUsers();
}

/** 관리자 패널 닫기 — 구독 해제 */
function closeAdminPanel() {
  APP_STATE.adminDetail = null;
  var modal = document.getElementById("adminModal");
  if (modal) modal.classList.add("hidden");
  if (typeof window.fbUnwatchUsers === "function") window.fbUnwatchUsers();
}

/** 오버레이(바깥) 클릭 시에만 닫기 */
function closeAdminPanelFromOverlay(e) {
  if (e.target === document.getElementById("adminModal")) closeAdminPanel();
}

/** 회원 목록 렌더 (firebase.js의 fbWatchUsers가 호출) */
window.renderAdminUsers = function (list) {
  var box = document.getElementById("adminUserList");
  if (!box) return;
  box.innerHTML = "";

  var arr = (list || []).filter(function (u) { return u.nick || u.email; });
  if (arr.length === 0) {
    var p = document.createElement("p");
    p.className = "admin-user-empty";
    p.textContent = "아직 가입한 회원이 없어요.";
    box.appendChild(p);
    return;
  }

  arr.forEach(function (u) {
    var isMaster = MASTER_EMAILS.indexOf(u.email) !== -1;
    var isMe = !!(APP_STATE.user && u.uid === APP_STATE.user.uid);
    var displayNick = u.nick || u.email;

    var row = document.createElement("div");
    row.className = "admin-user-row";

    // 좌측: 닉네임(클릭 → 미션 상세) + 이메일
    var info = document.createElement("button");
    info.type = "button";
    info.className = "au-info";
    info.addEventListener("click", (function (uid, nick) {
      return function () { openAdminUserDetail(uid, nick); };
    })(u.uid, displayNick));

    var nickEl = document.createElement("span");
    nickEl.className = "au-nick";
    nickEl.textContent = displayNick + (isMe ? " (나)" : "");
    info.appendChild(nickEl);

    var emailEl = document.createElement("span");
    emailEl.className = "au-email";
    emailEl.textContent = u.email || "";
    info.appendChild(emailEl);

    row.appendChild(info);

    // 우측: 관리자 뱃지 / 지정·해제 버튼
    var right = document.createElement("div");
    right.className = "au-right";

    if (isMaster) {
      var mb = document.createElement("span");
      mb.className = "badge-admin";
      mb.textContent = "관리자(마스터)";
      right.appendChild(mb);
    } else if (u.isAdmin) {
      var ab = document.createElement("span");
      ab.className = "badge-admin";
      ab.textContent = "관리자";
      right.appendChild(ab);
      if (!isMe) {
        var offBtn = document.createElement("button");
        offBtn.type = "button";
        offBtn.className = "btn-grant btn-grant-off";
        offBtn.textContent = "관리자 해제";
        offBtn.addEventListener("click", (function (uid, nick) {
          return function () { handleToggleAdmin(uid, nick, false); };
        })(u.uid, displayNick));
        right.appendChild(offBtn);
      }
    } else {
      var onBtn = document.createElement("button");
      onBtn.type = "button";
      onBtn.className = "btn-grant";
      onBtn.textContent = "관리자 지정";
      onBtn.addEventListener("click", (function (uid, nick) {
        return function () { handleToggleAdmin(uid, nick, true); };
      })(u.uid, displayNick));
      right.appendChild(onBtn);
    }

    row.appendChild(right);
    box.appendChild(row);
  });
};

/** 관리자 권한 지정/해제 */
function handleToggleAdmin(uid, nick, makeAdmin) {
  var q = makeAdmin
    ? "“" + nick + "” 님을 관리자로 지정할까요?"
    : "“" + nick + "” 님의 관리자 권한을 해제할까요?";
  if (!confirm(q)) return;
  if (typeof window.fbSetAdmin !== "function") return;

  showLoading();
  window.fbSetAdmin(uid, makeAdmin)
    .then(function () {
      hideLoading();
      showToast(makeAdmin ? nick + " 님을 관리자로 지정했어요" : "관리자 권한을 해제했어요");
    })
    .catch(function (err) {
      hideLoading();
      console.warn("관리자 권한 변경 실패:", err);
      showToast("권한 변경에 실패했어요. 보안 규칙이 최신인지 확인해 주세요.");
    });
}

/** 회원 상세 뷰 — 그 회원의 25칸 미션 상태 미니 빙고판 */
function openAdminUserDetail(uid, nick) {
  APP_STATE.adminDetail = { uid: uid, nick: nick };
  document.getElementById("adminUsersView").classList.add("hidden");
  document.getElementById("adminUserDetail").classList.remove("hidden");
  document.getElementById("auName").textContent = nick + " 님의 미션";

  var boardEl = document.getElementById("auBoard");
  boardEl.innerHTML = "";

  if (typeof window.fbGetUserSubs !== "function") return;
  showLoading();
  window.fbGetUserSubs(uid)
    .then(function (subs) {
      hideLoading();
      // 그 사이에 다른 유저/뷰로 이동했으면 무시
      if (!APP_STATE.adminDetail || APP_STATE.adminDetail.uid !== uid) return;
      renderAuBoard(uid, nick, subs || {});
    })
    .catch(function (err) {
      hideLoading();
      console.warn("회원 미션 조회 실패:", err);
      showToast("미션 상태를 불러오지 못했어요.");
    });
}

/** 미니 5×5 빙고판 렌더 — 완료 칸 클릭 시 openAdminCell */
function renderAuBoard(uid, nick, subs) {
  var boardEl = document.getElementById("auBoard");
  boardEl.innerHTML = "";

  var i;
  for (i = 0; i < 25; i++) {
    var sub = subs[i];
    var done = !!(sub && (sub.photo || sub.test) && sub.revoked !== true);

    var cell = document.createElement("button");
    cell.type = "button";
    cell.className = "au-cell" + (i === 12 ? " center" : "") + (done ? " done" : "");
    cell.title = (i + 1) + ". " + MISSIONS[i];

    var no = document.createElement("span");
    no.className = "au-no";
    no.textContent = String(i + 1);
    cell.appendChild(no);

    var label = document.createElement("span");
    label.className = "au-label";
    label.textContent = MISSIONS[i];
    cell.appendChild(label);

    if (done) {
      cell.addEventListener("click", (function (mid, s) {
        return function () { openAdminCell(uid, nick, mid, s); };
      })(i, sub));
    } else {
      cell.disabled = true;
    }

    boardEl.appendChild(cell);
  }
}

/** 완료 칸 팝업 — 사진(있으면) + [체크 해제] (기존 openRevokeModal 재사용) */
function openAdminCell(uid, nick, mid, sub) {
  var box = document.createElement("div");
  box.className = "lightbox";
  box.addEventListener("click", function (e) { if (e.target === box) box.remove(); });

  var card = document.createElement("div");
  card.className = "ac-pop";

  var title = document.createElement("p");
  title.className = "ac-pop-title";
  title.textContent = "MISSION " + (mid + 1) + " · " + nick + " 님";
  card.appendChild(title);

  var mission = document.createElement("p");
  mission.className = "ac-pop-mission";
  mission.textContent = MISSIONS[mid];
  card.appendChild(mission);

  if (sub && sub.photo) {
    var img = document.createElement("img");
    img.src = sub.photo;
    img.alt = nick + " 님의 인증샷";
    card.appendChild(img);
  } else {
    var ph = document.createElement("p");
    ph.className = "ac-pop-test";
    ph.textContent = "🧪 테스트 체크 (사진 없음)";
    card.appendChild(ph);
  }

  var actions = document.createElement("div");
  actions.className = "modal-actions";

  var revokeBtn = document.createElement("button");
  revokeBtn.type = "button";
  revokeBtn.className = "btn btn-danger btn-sm";
  revokeBtn.textContent = "체크 해제";
  revokeBtn.addEventListener("click", function () {
    box.remove();
    openRevokeModal(mid, uid, nick); // 기존 코멘트 입력 모달 재사용
  });
  actions.appendChild(revokeBtn);

  var closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn-ghost btn-sm";
  closeBtn.textContent = "닫기";
  closeBtn.addEventListener("click", function () { box.remove(); });
  actions.appendChild(closeBtn);

  card.appendChild(actions);
  box.appendChild(card);
  document.body.appendChild(box);
}

/** 상세 → 회원 목록으로 복귀 */
function backToAdminUsers() {
  APP_STATE.adminDetail = null;
  document.getElementById("adminUserDetail").classList.add("hidden");
  document.getElementById("adminUsersView").classList.remove("hidden");
}

/* ==========================================================
   라이트박스 / 토스트 / 로딩
   ========================================================== */

function openLightbox(src) {
  var box = document.createElement("div");
  box.className = "lightbox";
  var img = document.createElement("img");
  img.src = src;
  img.alt = "인증샷 크게 보기";
  box.appendChild(img);
  box.addEventListener("click", function () { box.remove(); });
  document.body.appendChild(box);
}

var _toastTimer = null;
function showToast(msg) {
  var toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () { toast.classList.add("hidden"); }, 2600);
}
window.showToast = showToast; // firebase.js에서도 사용

function showLoading() { document.getElementById("loading").classList.remove("hidden"); }
function hideLoading() { document.getElementById("loading").classList.add("hidden"); }
window.showLoading = showLoading;
window.hideLoading = hideLoading;

/* 스크립트가 body 하단에 있으므로 즉시 초기화 (onload는 중복 가드) */
initApp();

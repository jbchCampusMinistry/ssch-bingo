# 하계수양회 BINGO — 설치 & 배포 가이드

시흥서부교회 청년회 2026 하계수양회 빙고 미션 앱을 실제로 띄우기 위한 순서입니다.
**Firebase 콘솔 설정 → 코드에 설정값 붙여넣기 → 보안 규칙 적용 → 관리자 등록 → GitHub Pages 배포** 순서로 진행하세요.

---

## 1. Firebase 프로젝트 만들기

1. https://console.firebase.google.com 접속 → 구글 계정으로 로그인.
2. **[프로젝트 추가]** 클릭.
3. 프로젝트 이름 입력 (예: `haggye-bingo-2026`) → 계속.
4. Google 애널리틱스는 **사용 안 함**으로 꺼도 됩니다 → **[프로젝트 만들기]**.

### 1-1. 웹 앱 등록

1. 프로젝트 개요 화면에서 **웹 아이콘( `</>` )** 클릭.
2. 앱 닉네임 입력 (예: `bingo-web`) → **[앱 등록]**.
   - "Firebase 호스팅 설정"은 체크하지 않아도 됩니다 (GitHub Pages를 쓸 예정).
3. 화면에 나오는 `firebaseConfig` 코드는 **2단계에서 복사해 쓸 것**이므로 이 페이지를 기억해 두세요.
   (나중에 다시 보려면: **프로젝트 설정(톱니바퀴) → 일반 → 내 앱 → SDK 설정 및 구성 → "구성"** 선택)

### 1-2. Realtime Database 만들기

1. 왼쪽 메뉴 **빌드 → Realtime Database** → **[데이터베이스 만들기]**.
2. 위치 선택: **asia-southeast1(싱가포르)** 추천 (한국에서 가장 가까운 무료 지역).
3. 보안 규칙: 일단 **잠금 모드**로 시작 → 완료. (규칙은 3단계에서 붙여넣습니다.)
4. 만들어진 후 상단에 보이는 주소(예: `https://haggye-bingo-2026-default-rtdb.asia-southeast1.firebasedatabase.app`)가
   **databaseURL** 입니다. 꼭 메모하세요.

### 1-3. 구글 로그인 켜기

1. 왼쪽 메뉴 **빌드 → Authentication** → **[시작하기]**.
2. **로그인 방법(Sign-in method)** 탭 → **Google** 선택 → **사용 설정** 토글 ON.
3. "프로젝트 지원 이메일"을 본인 이메일로 선택 → **저장**.
4. 같은 화면의 **설정 → 승인된 도메인(Authorized domains)** 에서
   나중에 배포할 GitHub Pages 도메인(예: `아이디.github.io`)을 **[도메인 추가]** 로 등록하세요.
   (이걸 안 하면 배포 후 로그인 시 `auth/unauthorized-domain` 오류가 납니다. `localhost`는 기본 포함.)

---

## 2. firebaseConfig 교체하기

1. 이 폴더의 **`firebase.js`** 파일을 엽니다.
2. 파일 상단의 아래 부분을 찾습니다.

   ```js
   // TODO: Firebase 콘솔의 firebaseConfig로 교체
   const firebaseConfig = {
     apiKey: "YOUR_API_KEY",
     authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
     databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.asia-southeast1.firebasedatabase.app",
     projectId: "YOUR_PROJECT_ID",
     storageBucket: "YOUR_PROJECT_ID.appspot.com",
     messagingSenderId: "YOUR_SENDER_ID",
     appId: "YOUR_APP_ID"
   };
   ```

3. 1-1 단계에서 본 콘솔의 `firebaseConfig` 값을 그대로 붙여넣어 **전부 교체**합니다.
4. **중요:** 콘솔이 보여주는 config에 `databaseURL`이 빠져 있을 수 있습니다.
   그 경우 1-2에서 메모한 Realtime Database 주소를 `databaseURL: "..."` 줄로 **직접 추가**하세요.

> 참고: 관리자 이메일은 `firebase.js`의 `const ADMIN_EMAILS = ["tjswp757@gmail.com"];` 에서 관리합니다.
> 관리자를 늘리려면 이 배열에 이메일을 추가하고, 아래 4단계의 admins 등록도 함께 해 주세요.

---

## 3. 보안 규칙(database.rules.json) 적용하기

1. Firebase 콘솔 → **Realtime Database → 규칙(Rules)** 탭.
2. 이 폴더의 **`database.rules.json`** 파일 내용을 **전부 복사**해서 규칙 편집기에 붙여넣기.
3. **[게시(Publish)]** 클릭.

> Firebase CLI를 쓸 줄 안다면 `firebase deploy --only database` 로도 배포할 수 있습니다
> (`firebase.json`이 이미 준비되어 있음). 콘솔에 붙여넣는 방법이 더 간단합니다.

---

## 4. 관리자 등록하기 (중요!)

관리자 화면(체크 해제 버튼)은 이메일 화이트리스트로 보이지만,
**실제로 해제가 저장되려면 DB에 `admins/<관리자 uid> = true` 가 있어야 합니다.** (보안 규칙이 이 노드를 검사)

1. 배포(또는 로컬 서버)된 앱에서 **관리자 계정(tjswp757@gmail.com)으로 먼저 한 번 로그인**합니다.
2. Firebase 콘솔 → **Authentication → 사용자(Users)** 탭 → 방금 로그인한 계정의 **사용자 UID**를 복사합니다.
3. **Realtime Database → 데이터** 탭으로 이동합니다.
4. 최상위(루트)에 마우스를 올리면 나오는 **+ 버튼**을 눌러:
   - 이름(키): `admins`  → 그 아래에 다시 **+**
   - 이름(키): `복사한 UID` / 값: `true` (타입: **boolean**)
5. **[추가]** 를 누르면 아래처럼 저장됩니다.

   ```
   admins
     └─ xYz123AbC...(관리자 UID): true
   ```

6. 앱을 새로고침하면 관리자 배지가 표시되고, 갤러리에서 타인 인증에 [체크 해제] 버튼이 동작합니다.

---

## 5. GitHub Pages로 배포하기

### 5-1. 저장소 만들기 & 업로드

1. https://github.com 로그인 → 우측 상단 **+ → New repository**.
2. 저장소 이름 입력 (예: `haggye-bingo`) → **Public** 선택 → **[Create repository]**.
3. 이 폴더에서 터미널을 열고 아래 명령을 실행합니다. (`아이디`, `저장소이름`은 본인 것으로)

   ```bash
   git init
   git add index.html styles.css app.js firebase.js manifest.json sw.js icon.svg firebase.json database.rules.json SETUP.md
   git commit -m "하계수양회 빙고 앱"
   git branch -M main
   git remote add origin https://github.com/아이디/저장소이름.git
   git push -u origin main
   ```

   > 터미널이 어렵다면: GitHub 저장소 페이지에서 **Add file → Upload files** 로
   > 위 파일들을 끌어다 놓고 **Commit changes** 해도 됩니다.

### 5-2. Pages 켜기

1. 저장소 페이지 → **Settings → Pages** 메뉴.
2. **Source**: `Deploy from a branch` 선택.
3. **Branch**: `main` / 폴더 `/ (root)` 선택 → **[Save]**.
4. 1~2분 뒤 상단에 표시되는 주소로 접속:
   `https://아이디.github.io/저장소이름/`

### 5-3. 배포 후 마무리 체크

- [ ] Firebase 콘솔 → **Authentication → 설정 → 승인된 도메인**에 `아이디.github.io` 추가했는지 확인 (1-3 참고).
- [ ] 앱 접속 → 구글 로그인 → 닉네임 설정("자기 이름으로 입력해 주세요") → 칸 터치 → 사진 업로드가 되는지 확인.
- [ ] 관리자 계정으로 로그인 후 4단계(admins 등록)를 마쳤는지 확인.
- [ ] 휴대폰 브라우저에서 "홈 화면에 추가"를 하면 앱처럼(PWA) 설치됩니다.

---

## 문제 해결(FAQ)

| 증상 | 원인/해결 |
|---|---|
| 로그인 버튼이 비활성 + 빨간 안내문 | `firebase.js`의 firebaseConfig가 아직 자리표시자 → 2단계 수행 |
| 로그인 팝업에서 `auth/unauthorized-domain` | 승인된 도메인에 GitHub Pages 도메인 미등록 → 1-3의 4번 수행 |
| 사진 업로드 시 "권한 없음" 오류 | 3단계 보안 규칙을 게시했는지 확인 |
| 관리자인데 [체크 해제]가 실패함 | DB에 `admins/<uid> = true` 없음 → 4단계 수행 |
| 데이터가 안 보임 | firebaseConfig의 `databaseURL`이 실제 DB 주소와 다름 → 2단계 4번 확인 |
| 수정했는데 옛 화면이 보임 | 서비스워커 캐시 → 새로고침 2번 또는 브라우저 캐시 삭제 |

---

시흥서부교회 청년회 · ※ 모든 미션은 AI 사용 금지

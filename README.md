# 인천산업정보학교 고교 방문 홍보 예약

인천산업정보학교가 고등학교 홍보 방문 일정을 링크 하나로 받는 예약 페이지입니다.

- **사용자**가 방문 가능한 시간을 열어 두면, **신청자**(학교 선생님)가 그 안에서 날짜와 시간을 골라 신청합니다.
- 사용자의 구글 캘린더에 일정이 있는 시간과 이미 예약된 시간은 신청자 화면에서 비활성화됩니다.
- 신청은 즉시 확정되고, 확정 안내문자를 복사하거나 휴대폰 공유창으로 카카오톡에 보낼 수 있습니다.
- **관리자**는 로그인할 수 있는 구글 계정을 등록하고, 사용자와 전체 예약을 관리합니다.

현재 버전: **v2.0** (변경 내역은 [CHANGELOG.md](CHANGELOG.md))

## 주소

- 실제 페이지: `https://mentorsang-boop.github.io/school-promo-booking/`
- 체험 모드: 주소 끝에 `?demo` 를 붙이면 예시 데이터로 모든 화면을 둘러볼 수 있습니다 (데이터는 그 브라우저에만 저장).
- 신청자 페이지: `.../#/r/{사용자 주소}`
- 관리자 로그인: `.../#/login/admin` (선생님 화면에는 관리 메뉴가 보이지 않습니다)

## 구성

| 파일 | 내용 |
|---|---|
| `index.html` | 페이지 틀 |
| `assets/style.css` | 디자인 (학교 남색 #2C479D 기준) |
| `assets/logo*.svg`, `assets/emblem*.svg` | 학교 로고 (원본 AI 파일에서 추출) |
| `assets/app.js` | 화면과 라우팅 |
| `assets/data.js` | 데이터 계층 (Supabase / 체험 모드) |
| `assets/config.js` | Supabase 주소와 공개 키, 버전 |
| `supabase/schema.sql` | 테이블, 접근 규칙(RLS), DB 함수 |
| `supabase/functions/public-api` | 신청자용 서버 함수 (가능 시간 조회, 예약 저장, 구글 캘린더 바쁨 조회) |

## 처음 한 번 설정

1. **GitHub Pages 켜기**: 저장소 Settings → Pages → Branch를 `main` / `/ (root)` 로 두고 Save.
2. **구글 OAuth 클라이언트 만들기** (Google Cloud Console)
   - API 및 서비스 → 사용자 인증 정보 → OAuth 클라이언트 ID 만들기 → 웹 애플리케이션
   - 승인된 리디렉션 URI: `https://prsldqlwyohsqmzzuiji.supabase.co/auth/v1/callback`
   - 라이브러리에서 **Google Calendar API** 사용 설정
   - OAuth 동의 화면이 '테스트' 상태면 사용자 구글 계정을 테스트 사용자로 추가
3. **Supabase 설정**
   - Authentication → Providers → Google 켜고 위 클라이언트 ID/보안 비밀 입력
   - Authentication → URL Configuration → Site URL과 Redirect URLs에 `https://mentorsang-boop.github.io/school-promo-booking/` 추가
   - Edge Functions → Secrets 에 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` 추가 (캘린더 바쁨 조회용)
4. 첫 관리자 이메일은 `allowed_emails` 테이블에 `admin` 역할로 들어 있어야 합니다.

## 버전 규칙

`주.부` 형식으로 1.0부터 시작합니다.

- 화면 구성이나 흐름이 크게 바뀌면 **주 번호**를 올립니다 (1.x → 2.0)
- 기능이 추가되거나 바뀌면 **부 번호**를 올립니다 (1.0 → 1.1)
- 오타·버그 수정 같은 작은 고침은 세 번째 자리를 씁니다 (1.1 → 1.1.1)

버전을 올릴 때는 `assets/config.js`의 `VERSION`, `RELEASED`와 `CHANGELOG.md`를 함께 고칩니다.

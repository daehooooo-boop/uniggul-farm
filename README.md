# 유니꿀로 (uniggul-farm)

유니클로 관심 상품이 할인되면 디스코드나 텔레그램으로 알려 주고, 매주 금요일 오전 9시에 그 주 할인 상품만 모아 보여 주는 서비스입니다.

- **웹**: 이번 주 할인 목록, 사용법 3단계, 디스코드·텔레그램으로 받기 버튼
- **디스코드 봇**: `/등록 상품`, `/목록`, `/삭제 상품`, `/할인목록`. 할인 알림은 DM, 금요일 목록은 공용 채널
- **텔레그램 봇**: 시작을 누르고 상품 링크를 붙여넣으면 등록. 아래 버튼으로 내 목록·이번 주 할인·금요일 알림 켜기/끄기, 목록의 ❌ 버튼으로 삭제

상시 실행 서버 없이 Vercel만으로 돌아갑니다. 두 봇 모두 웹훅 방식이라 메시지가 오면 Vercel 함수가 처리합니다.

## 구조

| 경로 | 내용 |
|---|---|
| `src/lib/uniqlo.ts` | 유니클로 한국 상품·가격 조회 (`/kr/api/commerce/v5/ko/products`). 응답 구조가 바뀌면 `parseItem`만 고치면 됨 |
| `src/lib/db.ts` | Neon Postgres. 표는 첫 호출 때 자동 생성 (`watches`, `subscribers`, `kv`) |
| `src/lib/core.ts` | 두 봇 공통 로직: 등록, 할인 감지, 금요일 목록 |
| `src/lib/discord.ts`, `src/lib/telegram.ts` | 각 봇의 명령 처리와 알림 보내기 |
| `src/app/page.tsx` | 웹 페이지 |
| `src/app/api/discord` | 디스코드 Interactions Endpoint |
| `src/app/api/telegram` | 텔레그램 웹훅 |
| `src/app/api/cron/check` | 관심 상품 가격 확인 (GitHub Actions 3시간마다 + Vercel Cron 하루 1번) |
| `src/app/api/cron/weekly` | 금요일 09:00 KST 할인 목록 갱신·발송 (Vercel Cron) |
| `src/app/api/setup` | 배포 후 한 번: 디스코드 명령 등록 + 텔레그램 웹훅 연결 |

알림 규칙: 할인가가 처음 생기거나 이전에 알린 가격보다 더 내려가면 알립니다. 할인이 끝나면 초기화되어 다음 할인 때 다시 알립니다. 1인당 최대 30개.

## 배포 순서

1. **Vercel**에서 이 저장소를 Import
2. **Storage → Neon** 연결 (무료). `DATABASE_URL`이 자동으로 들어감
3. **디스코드 봇 만들기** ([개발자 포털](https://discord.com/developers/applications))
   - New Application → General Information의 Application ID, Public Key 복사
   - Bot 탭 → Reset Token으로 토큰 복사
   - Installation 탭 → Guild Install의 scopes에 `applications.commands`, `bot`, 권한 `Send Messages`, `Embed Links` → 생성된 설치 링크로 내 서버에 초대
   - 서버 초대 링크(사람들이 들어올 링크)를 `NEXT_PUBLIC_DISCORD_INVITE_URL`에
   - 디스코드 설정 → 고급 → 개발자 모드 켜고, 금요일 목록 채널 우클릭 → ID 복사
4. **텔레그램 봇 만들기**: [@BotFather](https://t.me/BotFather)에서 `/newbot` → 토큰 복사. 봇 주소 `https://t.me/<봇아이디>`를 `NEXT_PUBLIC_TELEGRAM_URL`에
5. Vercel → Settings → Environment Variables에 아래 값 입력 후 Redeploy
6. 브라우저로 `https://<배포주소>/api/setup?key=<CRON_SECRET>` 한 번 열기 → `{"discord":"ok","telegram":"ok"}` 확인
7. 디스코드 개발자 포털 → General Information → **Interactions Endpoint URL**에 `https://<배포주소>/api/discord` 저장
8. 처음 목록 만들기: `https://<배포주소>/api/cron/weekly?key=<CRON_SECRET>&send=0` (알림 없이 웹 목록만 갱신)
9. GitHub 저장소 → Settings → Secrets and variables → Actions에 `SITE_URL`, `CRON_SECRET` 추가 (3시간마다 가격 확인)

## 환경 변수

| 이름 | 설명 |
|---|---|
| `DATABASE_URL` | Neon 연결 시 자동 |
| `CRON_SECRET` | 아무 긴 문자열. 예약 작업·설정 주소 보호 (Vercel Cron이 자동으로 헤더에 넣음) |
| `SITE_URL` | 배포 주소, 예: `https://uniggul-farm.vercel.app` |
| `DISCORD_APPLICATION_ID` | 디스코드 Application ID |
| `DISCORD_PUBLIC_KEY` | 디스코드 Public Key |
| `DISCORD_BOT_TOKEN` | 디스코드 봇 토큰 |
| `DISCORD_WEEKLY_CHANNEL_ID` | 금요일 목록을 올릴 채널 ID |
| `NEXT_PUBLIC_DISCORD_INVITE_URL` | 웹의 "디스코드로 받기" 버튼 주소 (서버 초대 링크) |
| `TELEGRAM_BOT_TOKEN` | BotFather 토큰 |
| `TELEGRAM_WEBHOOK_SECRET` | 아무 문자열 (영문·숫자·`_`·`-`) |
| `TELEGRAM_CHANNEL_ID` | 선택. 금요일 목록을 올릴 공개 채널 (예: `@uniggul`, 봇을 관리자로 추가) |
| `NEXT_PUBLIC_TELEGRAM_URL` | 웹의 "텔레그램으로 받기" 버튼 주소 (`https://t.me/<봇아이디>`) |
| `WEEKLY_TOP_N` | 선택. 금요일 메시지에 넣을 개수 (기본 40) |

## 실행

```bash
cp .env.example .env.local
npm install
npm run dev     # http://localhost:3000
npm test        # 단위 테스트
npm run build
```

유니클로와 관련 없는 개인 프로젝트입니다.

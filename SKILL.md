# ACP Session Coordinator Skill

> OpenClaw 에이전트가 ACPX를 통해 외부 코딩 에이전트(Claude Code 등)의 **세션을 지속적으로 관리**할 수 있도록 하는 스킬 문서입니다.

## 목적

이 스킬은 OpenClaw 코디네이터 에이전트가 다음을 수행할 수 있도록 합니다:

1. **세션 생성(spawn)** — 새로운 코딩 에이전트 세션을 시작
2. **세션 재사용(steer)** — 기존 세션에 후속 메시지 전송
3. **세션 상태 확인(status)** — 세션의 생존 여부 판단
4. **세션 복구(revive)** — Cold 상태의 세션을 되살림
5. **세션 전략 판단** — warm/cold/missing 상태에 따라 적절한 액션 선택

---

## 세션 상태 모델

```
[*] → Warm : spawn 또는 revive 성공
Warm → Cold : 프로세스 종료 / 타임아웃
Cold → Warm : revive 성공
Cold → Missing : 세션 데이터 손실
Missing → Warm : 새 spawn
```

| 상태 | 설명 | 행동 |
|------|------|------|
| **Warm** | 세션 활성, 즉시 통신 가능 | `steer`로 메시지 전송 |
| **Cold** | 프로세스 죽었지만 세션 데이터 존재 | `revive` 시도 → 실패 시 새 `spawn` |
| **Missing** | 세션 자체를 찾을 수 없음 | 새 `spawn` 필요 |

---

## ACPX CLI 명령어 레퍼런스

### 세션 생성

```bash
acpx claude sessions new --name <session-name>
```

### 프롬프트 전송 (steer)

```bash
acpx claude prompt -s <session-name> "<메시지>"
```

### 상태 확인

```bash
acpx claude status -s <session-name>
```

### 세션 복구

```bash
acpx claude revive -s <session-name>
```

### 세션 목록

```bash
acpx claude sessions list
```

---

## OpenClaw 슬래시 명령어 레퍼런스

OpenClaw 런타임 내부에서 사용하는 `/acp` 슬래시 명령어:

### spawn (세션 생성)

```
/acp spawn claude --mode persistent --thread off --cwd <프로젝트경로>
```

- `--mode persistent`: 세션이 명시적으로 종료될 때까지 유지
- `--thread off`: 스레드 격리 비활성화 (단일 세션 유지)
- `--cwd`: 코딩 에이전트가 작업할 디렉토리
- `--label <이름>`: (선택) 세션에 사람이 읽을 수 있는 이름 부여

**반환값**: `childSessionKey` (예: `agent:claude:acp:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

### steer (메시지 전송)

```
/acp steer --session <childSessionKey> <메시지>
```

기존 세션에 후속 지시를 전달합니다. 동일한 `childSessionKey`를 사용하면 맥락이 유지됩니다.

### status (상태 확인)

```
/acp status <childSessionKey>
```

**응답 해석**:
- `ACP status:` 포함 + alive 키워드 → **Warm**
- `runtime: status=dead` 또는 `queue owner unavailable` → **Cold**
- `Unable to resolve session target` 또는 `missing ACP metadata` → **Missing**

### revive (세션 복구)

Cold 상태의 세션에 steer를 시도하면 자동으로 revive가 트리거됩니다.
명시적으로 복구하려면:

```
acpx claude revive -s <session-name>
```

---

## 코디네이터 의사결정 플로우

에이전트가 코딩 작업 요청을 받았을 때 따라야 할 판단 흐름:

```
1. 기존 세션 확인
   ├── 세션 있음
   │   ├── Warm → 기존 세션에 steer (재사용)
   │   ├── Cold → revive 시도
   │   │   ├── 성공 → steer (재사용)
   │   │   └── 실패 → 새 spawn
   │   └── Missing → 새 spawn
   └── 세션 없음 → 새 spawn
```

### 판단 기준

1. **같은 프로젝트 경로**의 기존 세션이 있는가?
2. 있다면, **warm** 상태인가?
3. Cold라면, **revive** 가능한가?
4. 모두 아니라면, **새 세션 spawn**

---

## 프롬프팅 5원칙

외부 코딩 에이전트에게 작업을 지시할 때 반드시 포함해야 하는 5가지:

### 1. 누구에게 시키는지 (대상)
> "클로드코드로", "Claude Code에 이어서", "acpx 세션으로"

### 2. 어디서 작업하는지 (경로)
> 프로젝트 경로, 앱 이름, 레포 기준을 같이 지정

### 3. 작업 범위 (스코프)
> "프론트만", "백엔드만", "로그인 화면만", "README만"처럼 좁혀서

### 4. 세션 전략
> "기존 세션 재사용", "revive 우선", "없으면 spawn"처럼 정책을 명시

### 5. 종료 조건
> "구현만", "테스트까지", "실행까지", "요약만" 등 멈출 기준

**한 줄 공식**: `누구 + 어디서 + 세션 전략 + 작업 범위 + 종료 조건`

---

## 프롬프트 템플릿

### 새 작업 시작

```
클로드코드로 ~/projects/my-app 에서 작업해줘.
목표: TODO 앱에 로그인 기능 추가.
요구사항:
- 회원가입/로그인 UI
- 쿠키 세션 인증
- 사용자별 todo 분리 저장
끝나면 변경 파일과 테스트 결과를 요약해줘.
```

### 기존 세션 이어서

```
지금 붙어 있는 Claude Code 세션에 이어서 시켜줘.
my-app 기준으로 프론트만 다듬어줘.
끝나면 변경 파일 요약만 알려줘.
```

### 세션 유지 강조

```
acpx 세션 유지하면서 클로드코드로 계속 작업해줘.
가능하면 기존 세션 revive해서 쓰고,
안 되면 새 세션으로 이어서 진행해줘.
```

---

## 안티패턴과 개선

| 안티패턴 | 문제점 | 개선 |
|----------|--------|------|
| "계속 해" | 무엇을 계속할지 모호 | "아까 하던 로그인 화면 CSS 정리 계속해줘" |
| "전체 리팩터링 해줘" | 범위가 너무 넓어 세션이 터짐 | "auth 모듈만 리팩터링해줘" |
| "에러 고쳐" | 어떤 에러인지 맥락 없음 | "npm run build 시 타입 에러 3개 고쳐줘" |

---

## 팀 워크플로: Builder + Reviewer 패턴

두 개의 독립된 세션을 사용하여 코드 품질을 높이는 패턴:

```
작업 요청 → [Builder 세션] 코드 구현 → 자체 테스트
                ↓ 결과물 전달
            [Reviewer 세션] 코드 리뷰 → 피드백 생성
                ↓
            수정 필요 → Builder에게 반환
            승인 → 완료 & 머지
```

- **Builder 세션**: 구현, 테스트, 빌드를 담당하는 실행자
- **Reviewer 세션**: 코드 리뷰, 품질 검증을 담당하는 검수자
- 각 세션은 독립적으로 관리되며, 서로 다른 `childSessionKey` 사용

---

## 실전 시나리오

### 시나리오 1: 신규 프로젝트 셋업

```bash
# 1. 세션 생성
acpx claude sessions new --name project-setup

# 2. 초기 작업 지시
acpx claude prompt -s project-setup "Next.js 프로젝트를 생성하고 기본 레이아웃을 잡아줘"

# 3. 후속 작업
acpx claude prompt -s project-setup "로그인 페이지를 추가해줘"

# 4. 상태 확인
acpx claude status -s project-setup
```

### 시나리오 2: 다음 날 이어서 작업

```bash
# 1. 기존 세션 상태 확인
acpx claude status -s project-setup
# → Cold (프로세스 종료됨)

# 2. 세션 복구
acpx claude revive -s project-setup

# 3. 작업 계속
acpx claude prompt -s project-setup "어제 하던 로그인 기능 마저 완성해줘"
```

### 시나리오 3: 세션이 사라진 경우

```bash
# 1. 상태 확인
acpx claude status -s old-session
# → Missing

# 2. 새 세션으로 시작
acpx claude sessions new --name old-session-v2

# 3. 맥락 전달하여 작업 재개
acpx claude prompt -s old-session-v2 "이전에 하던 로그인 기능 구현을 이어서 해줘.
변경했던 파일: src/auth/login.tsx, src/api/auth.ts
남은 작업: 세션 쿠키 검증 미들웨어"
```

---

## OpenClaw Runtime 통합

OpenClaw 코디네이터를 통해 사용할 때는 위 ACPX 명령어를 직접 실행할 필요 없이, 자연어 요청만으로 자동 관리됩니다:

```bash
# 세션 목록 조회
openclaw-coord sessions

# 세션 연결
openclaw-coord attach 1

# 자동 세션 관리로 작업 요청
openclaw-coord request "아까 하던 작업 이어서 테스트까지 해줘"

# 세션 유지
openclaw-coord keepalive --count 5

# 세션 해제
openclaw-coord detach
```

---

## 주의사항

1. **세션 수명은 보장되지 않습니다**: 저장된 `childSessionKey`는 ACP 런타임 상태에 따라 cold 또는 missing이 될 수 있습니다.
2. **범위를 좁혀 지시하세요**: 너무 넓은 범위의 작업은 세션 컨텍스트를 초과할 수 있습니다.
3. **종료 조건을 명시하세요**: 에이전트가 언제 멈춰야 하는지 알려주지 않으면 과도한 작업을 수행할 수 있습니다.
4. **Cold ≠ Dead**: Cold 상태는 대부분 revive 가능합니다. 바로 새 세션을 만들지 마세요.
5. **히스토리 관리**: 장시간 세션에서는 맥락 요약을 주기적으로 요청하여 컨텍스트 윈도우를 관리하세요.

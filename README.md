# openclaw-claude-session-bridge

**ACP 세션 코디네이터 스킬** — OpenClaw 에이전트가 ACPX를 통해 외부 코딩 에이전트(Claude Code 등)의 세션을 지속적으로 관리할 수 있도록 하는 스킬 문서 + 레퍼런스 구현체입니다.

## 핵심 문서

### [`SKILL.md`](./SKILL.md) — 스킬 문서 (메인)

OpenClaw 에이전트에게 직접 제공할 수 있는 스킬 문서입니다. 다음을 포함합니다:

- **세션 상태 모델** (Warm / Cold / Missing)
- **ACPX CLI 명령어 레퍼런스** (spawn, steer, status, revive)
- **OpenClaw 슬래시 명령어** (/acp spawn, /acp steer, /acp status)
- **코디네이터 의사결정 플로우** (기존 세션 확인 → 상태 판단 → 액션 선택)
- **프롬프팅 5원칙** (누구 + 어디서 + 세션 전략 + 작업 범위 + 종료 조건)
- **프롬프트 템플릿 및 안티패턴**
- **Builder + Reviewer 팀 워크플로 패턴**
- **실전 시나리오** (신규, 이어서, 복구)

### 사용법

SKILL.md를 OpenClaw 에이전트의 시스템 프롬프트나 스킬로 등록하면, 에이전트가 자동으로 세션 관리 판단을 수행합니다.

```
# 에이전트에게 스킬 문서 제공
→ SKILL.md 내용을 시스템 프롬프트에 포함
→ 또는 OpenClaw 스킬 플러그인으로 등록
```

## TypeScript 레퍼런스 구현체

`src/` 디렉토리에는 스킬 문서의 로직을 TypeScript로 구현한 CLI/라이브러리가 있습니다.
이는 레퍼런스 구현이며, **스킬 문서만으로 에이전트가 동일한 판단을 내릴 수 있습니다.**

### 구현체 설치 (선택)

```bash
npm install && npm run build
```

### CLI 명령어

| 명령어 | 설명 |
|--------|------|
| `init` | 브릿지 상태 디렉토리 초기화 |
| `spawn` | 새 Claude ACP 세션 생성 |
| `send <message>` | 활성 세션에 메시지 전송 |
| `status [key]` | 로컬 상태 조회 (--real: 원격 프로브 포함) |
| `bind <key>` | 세션 메타데이터 업데이트 |
| `export-config` | 세션 바인딩 JSON 내보내기 |
| `import-config <file>` | 내보낸 설정 가져오기 |

### 시뮬레이션

```bash
npm run build && npm run simulate
```

## 아키텍처

```
openclaw-claude-session-bridge/
├── SKILL.md              ← 스킬 문서 (메인, 에이전트에게 제공)
├── README.md
├── src/
│   ├── types.ts          ← 타입 정의
│   ├── state.ts          ← 로컬 상태 관리
│   ├── bridge.ts         ← 게이트웨이 어댑터 + 브릿지 클래스
│   ├── cli.ts            ← CLI 진입점
│   └── index.ts          ← 라이브러리 엔트리
├── simulate/
│   └── scenarios.ts      ← 시뮬레이션 시나리오
├── bin/
│   └── openclaw-bridge.js
├── package.json
├── tsconfig.json
└── LICENSE
```

## 기존 ACPX 기능과의 관계

이 프로젝트는 ACPX의 기존 기능(`acpx claude sessions new`, `prompt`, `status`, `revive`)을 **별도의 TypeScript 래퍼로 재구현**한 것이 아니라, **에이전트가 직접 활용할 수 있도록 문서화**한 것입니다.

- 핵심 가치는 `SKILL.md` — 에이전트에게 주면 바로 재현 가능
- TypeScript 구현체는 참고용 레퍼런스

## License

MIT

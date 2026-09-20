# rhwp v0.8.6 및 Windows 입력·창 상태 안정화 1-Pager

## Background

HOP v0.4.4는 rhwp v0.8.4를 submodule, vendored WASM, native Cargo graph에 고정해 사용한다.
현재 최신 안정 릴리스인 v0.8.6의 문서 호환성과 편집 개선이 HOP에 반영되지 않았고, Windows에서는
이전 실행의 최대화 상태가 다음 시작에 복원되거나 한글 IME 조합 UI가 창 왼쪽에 나타날 수 있다.

## Problem

- upstream 엔진과 studio 기준선이 v0.8.4에 머물러 v0.8.6 수정이 제품에 포함되지 않는다.
- window-state 플러그인의 기본 상태 범위에는 최대화 여부가 포함되어 첫 창이 최대화 상태로 복원될 수 있다.
- upstream의 숨은 편집 입력 요소가 화면 밖 `left:-9999px`에 있어 WebView2가 IME UI 위치를 왼쪽
  가장자리로 보정할 수 있다.

## Goal

- 공식 불변 태그 v0.8.6을 HOP의 모든 rhwp 소비 지점에 동일하게 반영한다.
- 창의 크기와 위치는 복원하되 최대화 상태는 새 실행으로 이어지지 않게 한다.
- Windows WebView2의 IME 기준점이 화면 밖에 놓이지 않도록 HOP-owned studio 경계에서 보정한다.
- 변경 동작을 자동 테스트와 Windows debug app smoke test로 검증한다.

## Non-goals

- `third_party/rhwp` 내부를 수정하지 않는다.
- HOP 제품 버전을 올리거나 릴리스를 만들지 않는다.
- 모든 플랫폼의 IME 구현을 교체하거나 별도 입력기를 만들지 않는다.
- 사용자가 조정한 일반 창 크기와 위치 복원을 제거하지 않는다.

## Constraints

- upstream 갱신은 `pnpm upstream:update -- v0.8.6`만 사용한다.
- HOP 동작은 `apps/desktop` 또는 `apps/studio-host`에 두고 macOS와 Linux 동작을 보존한다.
- pnpm만 사용하며 submodule, vendored WASM, provenance와 두 Cargo graph의 정합성을 유지한다.
- Windows GUI 현상은 DOM 계약 테스트만으로 완전히 증명할 수 없으므로 실제 WebView2 smoke test를 병행한다.

## Implementation outline

1. 공식 updater로 rhwp v0.8.6 candidate를 만들고 변경된 studio counterpart를 검토한다.
2. window-state 플러그인이 크기와 위치만 복원하도록 상태 플래그를 명시한다.
3. HOP studio 진입점에서 Windows일 때 upstream 입력 요소의 IME 기준 위치를 편집 영역 안으로 보정한다.
4. upstream 정합성, 창 상태 플래그, Windows 입력 요소 계약을 집중 테스트로 고정한다.

## Verification plan

- Red/Green 집중 테스트 후 `pnpm run test:upstream`, `pnpm run test:studio`, `pnpm run test:desktop`
- `pnpm upstream:verify`, `pnpm run clippy:desktop`, `pnpm run build:studio`
- Windows debug app에서 종료 전 최대화 후 재실행, 한글 조합 입력, HWP/HWPX 열기·편집·저장 smoke test
- macOS/Linux는 CI로 창 생성과 studio build 회귀를 확인한다.

## Rollback and recovery

upstream updater 실패 시 도구의 자동 복구를 사용한다. 창 상태 플래그와 입력 보정은 서로 독립된 작은
변경으로 유지해 개별 되돌리기가 가능하게 한다. submodule을 직접 수정하거나 Git 이력을 재작성하지 않는다.

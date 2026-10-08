# Thin shell architecture 1-Pager

## Background

HOP는 rhwp-studio의 `main.ts`와 `index.html`을 자체 버전으로 대체하고 upstream 모듈 27개를
Vite alias로 교체한다. rhwp 업데이트마다 fork·extension·HTML 사본이 어긋나 수동 통합이 필요했다
(v0.8.7: vite, 툴바 마크업, toolbar fork, local-fonts export). `spike/thin-shell`에서 수정하지 않은
rhwp-studio를 Tauri에 띄우고 공개 API만으로 HWP/HWPX 열기·저장 왕복이 되는 것을 Windows에서 확인했다.

## Problem

- upstream 내부 모듈 구조에 의존해 업데이트 PR이 사람 손 없이는 통과하지 못한다.
- HOP 앱 조립 사본 때문에 upstream의 앱 수준 기능(자동 저장·복구, 다국어 등)이 빠진다.

## Goal

- upstream rhwp-studio를 **소스 수정·모듈 교체 없이** 빌드해 쓴다.
- HOP 동작은 upstream 공개 표면(같은 창 embed RPC, `?chrome=embed`, `window.rhwpStudio.automation`,
  `window.rhwpStudio.fonts`)과 Tauri 네이티브 명령만으로 붙인다.
- rhwp 업데이트 PR이 CI(실제 앱 왕복 smoke 포함)를 통과하면 자동 병합된다.
- fork 릴리스와 앱 업데이터가 fork를 바라본다.

## Non-goals

- 홈 화면, 제한 글꼴 차단, HOP 전용 글꼴 카탈로그 정책, 커스텀 select·모달 동작(사용자 결정으로 제외).
- macOS 서명·공증 릴리스(Apple 인증서 없음). macOS 빌드는 secret이 있을 때만 수행한다.
- 릴리스 자동 발행. 병합까지 자동이고 릴리스는 수동 dispatch다.

## Design

1. `apps/studio-host`: upstream `rhwp-studio`를 root로 빌드한다. upstream 런타임 의존성은
   `apps/studio-host/package.json`에 같은 범위로 선언하고 alias로 연결한다. 빌드 시 `index.html`에
   HOP 호스트 스크립트만 주입한다(`transformIndexHtml`).
2. 호스트 스크립트(`src/host/*`): 열기·저장·다른 이름·새 문서·새 창·PDF·인쇄·최근 문서 커맨드,
   닫기 전 저장 확인, OS 파일 열기/드롭, 시스템 글꼴 공급, 업데이트 알림.
3. `apps/desktop/src-tauri`: Rust 문서 세션(렌더·질의·변경·staging)을 제거하고 파일 바이트 읽기/원자적
   쓰기, 바이트 기반 PDF 내보내기, 빈 문서 생성, 저장 확인 대화상자를 제공한다. 창·단일 인스턴스·
   파일 연결·최근 문서·글꼴 목록·업데이터·Quick Look은 유지한다.
4. 업데이트 자동화: updater는 submodule·WASM·Cargo·studio 의존성을 갱신한다. override baseline과
   studio 자산 미러링은 제거한다. CI에 Windows 앱 smoke(열기→저장→다시 열기, 쪽수 비교)를 추가하고,
   자동화 PR은 CI 성공 시 병합한다.
5. 릴리스: updater endpoint·pubkey를 fork로 바꾸고 fork 전용 서명 키를 쓴다.

## Constraints

- `third_party/rhwp`는 읽기 전용이다. 빌드 산출물도 submodule 밖에 둔다.
- upstream legacy embed transport는 내보내기 바이트를 배열로 직렬화한다. 큰 문서 성능은 측정 대상이다.
- smoke 명령은 `HOP_SMOKE_*` 환경 변수가 있을 때만 동작한다. CI는 debug 빌드로 실행한다.

## Verification plan

- 호스트 로직 vitest, Rust 단위 테스트, `pnpm run test:upstream`(계약 테스트 재작성).
- 로컬 Windows release 빌드에서 열기/저장/새 문서/새 창/닫기 확인/PDF/인쇄/드롭/글꼴 수동 확인.
- CI Windows smoke, 자동화 PR 경로는 fork에서 `workflow_dispatch`로 확인.

## Rollback and recovery

변경은 `feature/thin-shell` 브랜치의 PR로 들어간다. 문제가 있으면 PR을 되돌려 기존 override 구조
(rhwp v0.8.7 통합 상태)로 복귀한다. 설치본은 `replace_hop.ps1`의 `.orig` 백업으로 되돌린다.

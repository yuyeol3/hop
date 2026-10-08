# rhwp v0.8.7 integration 1-Pager

## Background

`pnpm upstream:update -- v0.8.7`로 submodule, vendored WASM, Cargo graph를 갱신했다. svg2pdf patch는
upstream vendor 경로로 전환된다(`rhwp-v0.8.7-svg2pdf-path-patch-1pager.md`). v0.8.7 studio는 i18n
(`src/i18n`)과 host font provider API를 새로 도입했다.

## Problem

- upstream studio가 `vite ^8.3.2`를 요구하고, 스타일 툴바 마크업에 i18n 속성이 추가되어 HOP boundary
  contract test가 실패한다.
- upstream renderer(`canvaskit-renderer`, `host-canvas-fonts`, `wasm-bridge`)가 `@/core/local-fonts`에서
  host font API를 import하지만 HOP extension 모듈은 이를 export하지 않아 `tsc`가 실패한다.
- fork인 `ui/toolbar`가 upstream의 키보드 접근성 수정을 받지 못한다.

## Goal

HOP 동작을 유지한 채 v0.8.7로 빌드·테스트가 통과하는 최소 통합.

## Non-goals

- 다국어 UI 노출. upstream 기본 로케일은 `ko`이고 query/저장값이 없으면 브라우저 언어를 따르지 않으므로
  HOP 화면은 한국어로 유지된다. HOP fork의 문자열도 한국어 그대로 둔다.
- HOP host font provider 도입.

## Implementation outline

1. `apps/studio-host/package.json`의 `vite`를 upstream 범위 `^8.3.2`로 맞춘다.
2. `apps/studio-host/index.html` 스타일 툴바 블록을 upstream과 동일하게 맞춘다(i18n 속성,
   글자색 picker `tabindex="-1"`).
3. `ui/toolbar` fork에 upstream 변경 중 동작 변경만 이식한다: mousedown은 선택 보존, 활성화는 click,
   형광펜 팔레트 Esc 닫기, 숨은 picker를 버튼 밖으로 이동.
4. `core/local-fonts` extension은 host font API를 upstream으로 그대로 전달한다. 단 provider가 없을 때의
   `resolveRendererLocalFont`/`loadRendererLocalFont`는 upstream 구현이 upstream 자체 카탈로그로
   폴백하므로, HOP의 `resolveLocalFont`/`loadLocalFontBytes`(Tauri 데스크톱 카탈로그)로 폴백한다.

## Verification plan

- `pnpm run test:upstream`, `pnpm run test:studio`(provider 없는 renderer 경로 테스트 추가),
  `pnpm run build:studio`, `pnpm run test:desktop`.
- Windows release build 후 설치본에서 문서 열기, 글꼴 표시, 툴바 색/형광펜, 인쇄·PDF 내보내기 smoke test.

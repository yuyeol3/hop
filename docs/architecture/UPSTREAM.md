# upstream 경계

HOP는 `edwardkim/rhwp`를 읽기 전용 upstream 의존성으로 사용한다.

* upstream URL: `https://github.com/edwardkim/rhwp.git`
* submodule 경로: `third_party/rhwp`
* 기준 source, 버전과 커밋: `config/rhwp-upstream.json`이 단일 기준선(SSOT)
* HOP 작업 브랜치: `main`

## 소유권 규칙

`third_party/rhwp` submodule은 vendor source로 취급한다. HOP 제품 동작을 구현하기 위해 이 폴더 아래 파일을 직접 수정하지 않는다.

HOP가 소유하는 코드는 다음 위치에 둔다.

* `apps/desktop/`: Tauri 셸, 파일 바이트 읽기/원자적 쓰기, PDF 내보내기, 창 관리, 파일 연결, 업데이트, 패키징
* `apps/studio-host/`: upstream rhwp-studio 빌드 설정과 HOP 호스트 스크립트(`host/`)
* `assets/`, `docs/`, `scripts/`, 릴리즈 메타데이터: 제품 수준 자산과 운영 코드

## 얇은 셸 구조

HOP는 upstream `rhwp-studio`를 **소스 수정과 모듈 교체 없이** 그대로 빌드한다
([thin shell 1-Pager](../operations/thin-shell-architecture-1pager.md)).

* `apps/studio-host/vite.config.ts`는 upstream `rhwp-studio`를 root로 빌드한다. HOP가 바꾸는 것은
  생성 WASM 위치(`vendor/rhwp-core`), upstream npm 의존성 위치, 그리고 `index.html`에 주입하는 호스트
  모듈 하나뿐이다. upstream 웹 글꼴(`assets/fonts`)도 그대로 복사한다.
* `apps/studio-host/package.json`의 upstream 런타임 의존성과 `vite`·`typescript` 범위는 upstream
  `rhwp-studio/package.json`을 따른다. updater가 동기화하고 `upstream:verify`가 검사한다.
* 창은 `index.html?chrome=embed`로 연다. upstream embed chrome은 브라우저용 파일 명령을 숨기고 파일
  수명주기를 호스트에 맡긴다.

호스트 스크립트(`apps/studio-host/host/`)는 upstream 공개 표면만 사용한다.

| 표면 | 용도 |
| --- | --- |
| 같은 창 embed RPC (`loadFile`, `exportHwp`/`exportHwpx`, `notifySaved`, `getDocumentState`, `pageCount`, `getPageSvg`) | 열기·저장·저장 상태·인쇄 |
| `window.rhwpStudio.automation` (`registerCommand`, `addMenuItem`) | 파일 메뉴의 HOP 명령 |
| `window.rhwpStudio.fonts.setProvider` | OS 글꼴 공급 |
| 편집 입력 textarea와 `.caret` DOM | Windows IME 조합 창 위치 보정 |

`tests/rhwp-boundary.test.mjs`는 고정한 upstream이 이 표면을 모두 제공하는지 검사한다. upstream이 표면을
바꾸면 자동 업데이트 PR의 CI가 이 테스트에서 실패한다. 호스트는 upstream 소스를 import하지 않는다.

desktop과 Quick Look의 Rust 코드는 `apps/desktop/rhwp-adapter`에 의존하며 이 adapter만 `rhwp`를 직접
import한다. Rust는 PDF 내보내기와 빈 문서 생성에만 엔진을 쓰고, 편집 중인 문서는 각 창의 studio가 소유한다.

공개 표면으로 표현할 수 없는 HOP 요구는 먼저 upstream에 확장 지점을 기여하는 쪽으로 해결한다.

## 업데이트 절차

실제 업데이트 작업은 [`rhwp 업데이트 운영 매뉴얼`](../operations/RHWP_UPDATE.md)의 준비, diff 리뷰,
검증, smoke test와 복구 체크리스트를 순서대로 따른다. 이 문서에는 경계의 핵심 원칙과 명령만 요약한다.

안정 release tag를 candidate로 준비하는 명령은 다음과 같다. branch나 `main`은 기본 업데이트
대상이 될 수 없으며 tag를 반드시 명시한다.

```sh
pnpm upstream:update -- vX.Y.Z
```

이 명령은 submodule checkout, vendored WASM, desktop과 Quick Look Cargo manifest/lockfile,
studio-host 의존성과 `pnpm-lock.yaml`, `config/rhwp-upstream.json`, WASM provenance를 함께 정렬한다.
실행 전 submodule `origin`이 기준선의 공식 source와 일치하고 보호 산출물이 clean인지 확인하며,
WASM 재생성은 생략할 수 없다. Cargo patch는 HOP 제품 정책으로 유지하고, upstream이 같은 patch를 선언할
때에만 그 고정 source/revision으로 두 native graph를 함께 전환한다. upstream이 patch를 자기 checkout 안의
path(예: `vendor/svg2pdf`)로 선언하면 두 manifest가 submodule 안의 같은 경로를 각자 기준 상대 경로로 가리킨다.

```sh
pnpm upstream:verify
pnpm test
```

기존 shell entrypoint는 호환 목적으로만 남아 있으며 `UPSTREAM_REF`가 필수다.

```sh
UPSTREAM_REF=v0.7.19 scripts/update-upstream.sh
```

업데이트 도구는 submodule release에서 WASM package를 임시 디렉터리에 생성한 뒤
`apps/studio-host/vendor/rhwp-core`에 반영한다. 수동 복구가 필요할 때만 다음 명령을 사용한다.

```sh
(cd third_party/rhwp && wasm-pack build --target web --out-dir ../../apps/studio-host/vendor/rhwp-core --release)
```

업데이트 후에는 다음을 확인한다.

* submodule pointer diff
* `apps/studio-host/vendor/rhwp-core`의 package/provenance/hash와 upstream lock 정합
* desktop과 Quick Look Cargo.lock의 `rhwp` 버전 및 HOP-owned Cargo patch 정합
* `tests/rhwp-boundary.test.mjs`의 upstream 공개 표면 검사
* `apps/desktop/src-tauri`의 native Rust API 깨짐
* CI의 Windows desktop smoke(열기→저장→다시 열기, 쪽수 비교)

## 자동 업데이트

`rhwp-upstream-update.yml`이 매주 최신 안정 릴리스를 확인해 `automation/rhwp-upstream` PR을 만들고
HOP CI를 실행한다. `rhwp-auto-merge.yml`은 그 CI가 성공한 커밋만 병합한다. 릴리스 발행은 수동이다.

## 검증 기준

upstream 갱신은 최소한 다음 검증을 통과해야 한다.

* repo root에서 `pnpm install --frozen-lockfile`
* repo root에서 `pnpm run build:studio`
* `apps/desktop/src-tauri/`에서 `cargo test`
* `apps/desktop/src-tauri/`에서 `cargo clippy -- -D warnings`
* repo root에서 `pnpm --filter hop-desktop tauri build --debug --no-bundle` 후 desktop smoke

public beta 빌드는 여기에 더해 macOS와 Windows 또는 Linux 최소 1개 환경에서 HWP/HWPX 열기, 저장, PDF 내보내기, 인쇄, drag/drop, 다중 창 동작을 smoke test한다.

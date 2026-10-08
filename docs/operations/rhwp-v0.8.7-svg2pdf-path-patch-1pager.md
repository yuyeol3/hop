# rhwp v0.8.7 svg2pdf path patch 1-Pager

## Background

HOP desktop과 Quick Look Cargo graph는 `[patch.crates-io]`로 rhwp와 같은 결정적 `svg2pdf`를 쓴다.
updater는 upstream `Cargo.toml`에 svg2pdf patch가 있으면 upstream `Cargo.lock`의
`git+URL#rev` source를 읽어 두 HOP manifest를 같은 git revision으로 전환한다.

## Problem

rhwp v0.8.7은 svg2pdf patch를 `git` branch에서 `path = "vendor/svg2pdf"`로 바꿨다. path
dependency는 `Cargo.lock`에 source가 없으므로 updater가
`upstream svg2pdf patch is not pinned in Cargo.lock`으로 실패하고 자동 업데이트 PR이 생성되지 않는다.

vendor 사본은 기존 고정 revision `2caeb0a0`에 rhwp 전용 PDF 수정(#7077/#7078 그러데이션,
#6936 합성 굵게)을 더한 것이다. HOP가 기존 git revision을 유지하면 그 수정이 HOP PDF 출력에서 빠진다.

## Goal

- upstream patch가 path이면 HOP 두 manifest가 submodule 안의 같은 vendor 경로를 가리키게 한다.
- git patch는 기존 동작을 그대로 유지한다.
- `pnpm upstream:update -- v0.8.7` candidate 생성이 성공한다.

## Non-goals

- v0.8.7 자체의 HOP 제품 호환성 수정. candidate PR과 CI에서 별도로 다룬다.
- `third_party/rhwp` 수정이나 svg2pdf 사본을 HOP에 복제하는 것.

## Constraints

- `config/rhwp-upstream.json`의 path patch는 upstream checkout 기준 상대 경로로 기록한다. upstream
  밖을 가리키는 절대 경로나 `..` 경로는 거부한다.
- 각 Cargo root의 manifest에는 그 root 기준 POSIX 상대 경로를 쓴다. Windows에서도 `/`를 사용한다.
- path dependency의 lock 항목은 source가 없는 svg2pdf package로 검증한다.
- 자동화 workflow의 허용 경로는 바뀌지 않는다.

## Implementation outline

1. `scripts/lib/rhwp-upstream.mjs`에 upstream patch 해석(`resolveUpstreamCargoPatch`)과 root별 경로
   변환(`cargoPatchesForRoot`)을 추가하고, TOML pattern, 선언 생성, lock 검증이 `{ path }`를 지원하게 한다.
2. updater와 verify가 root별로 변환한 patch로 manifest를 동기화하고 검증한다.
3. `tests/update-upstream.test.mjs`에 path patch 해석, 경로 거부, 동기화, lock 검증 케이스를 추가한다.

## Verification plan

- `pnpm run test:upstream`으로 단위 테스트를 Red/Green 확인한다.
- 로컬에서 `pnpm upstream:update -- v0.8.7`과 `pnpm upstream:verify`를 실행해 실제 전환을 확인하고,
  확인 후 candidate 산출물은 되돌린다(자동화 workflow가 PR로 다시 생성한다).
- `pnpm test`.

## Rollback and recovery

스크립트 변경만 되돌리면 기존 git-only 동작으로 복귀한다. updater는 실패 시 소유 파일과 submodule을
이전 계약으로 복원하는 기존 동작을 유지한다.

# rhwp 안정 릴리스 자동 업데이트 1-Pager

## Background

HOP는 `third_party/rhwp` submodule과 vendored WASM, 두 native Cargo graph 및 studio override
baseline을 하나의 upstream 계약으로 고정한다. 현재 `pnpm upstream:update -- <tag>`가 안정 태그를
candidate로 만드는 절차를 소유하지만, 새 rhwp 릴리스 발견과 candidate PR 생성은 수동이다.

## Problem

- 새 rhwp 안정 릴리스를 사람이 확인해야 하므로 반영 시점이 늦어질 수 있다.
- updater 결과에는 생성 WASM과 lockfile이 포함되어 단순 submodule dependency bot만으로 갱신할 수 없다.
- upstream 소스를 빌드하는 job에 저장소 쓰기 토큰을 노출하면 공급망 위험이 커진다.

## Goal

- GitHub가 매주 최신 rhwp 안정 릴리스를 확인하고 새 버전일 때만 update candidate를 만든다.
- candidate를 전용 브랜치와 pull request로 게시해 기존 HOP CI가 검증하게 한다.
- upstream 빌드와 저장소 쓰기를 서로 다른 runner/job으로 분리한다.
- 자동 병합 없이 변경된 studio input과 제품 smoke test를 사람이 확인하게 한다.

## Non-goals

- rhwp prerelease, moving branch 또는 임의 commit을 자동 반영하지 않는다.
- candidate를 `main`에 자동 병합하거나 HOP 제품 버전을 올리지 않는다.
- upstream 호환성 문제를 workflow가 자동 수정하지 않는다.
- 로컬의 미커밋 커스텀 변경을 자동으로 commit 또는 push하지 않는다.

## Constraints

- pnpm과 기존 `pnpm upstream:update -- <tag>` 및 `pnpm upstream:verify`를 재사용한다.
- `third_party/rhwp`는 읽기 전용 vendor source로 유지한다.
- Node 24, upstream 계약의 Rust toolchain과 고정된 wasm-pack 버전을 사용한다.
- 공개 upstream의 GitHub fork에서 동작하며 원 MIT `LICENSE`와 저작권 고지를 유지한다.
- 생성 job은 `contents: read`와 `persist-credentials: false`만 사용한다.
- 쓰기 권한 job은 새 runner에서 허용된 updater 산출물 patch만 적용하고 upstream 코드를 실행하지 않는다.
- `GITHUB_TOKEN`이 만든 PR은 승인 대기 상태가 되므로 게시 job이 기존 CI를 `workflow_dispatch`로 실행한다.

## Implementation outline

1. schedule 및 수동 실행이 가능한 `rhwp-upstream-update` workflow를 추가한다.
2. 최신 GitHub release tag를 읽고 기존 `config/rhwp-upstream.json`의 tag와 비교한다.
3. 읽기 전용 job에서 고정 도구를 설치하고 updater와 upstream 검증을 실행한다.
4. updater가 소유하는 경로만 binary patch artifact로 전달한다.
5. 별도 쓰기 job에서 patch를 적용하고 `automation/rhwp-upstream` 브랜치와 PR을 생성 또는 갱신한 뒤
   해당 branch에 기존 CI를 명시적으로 dispatch한다.
6. workflow의 권한 분리와 핵심 명령을 repository-level contract test로 고정한다.

## Verification plan

- Red/Green으로 workflow contract test를 추가하고 `pnpm run test:upstream`을 실행한다.
- workflow YAML을 파싱 또는 actionlint로 정적 검증한다.
- GitHub fork에서 `workflow_dispatch`를 실행해 no-op과 새 release candidate 경로를 확인한다.
- 생성된 PR에서 기존 HOP CI와 RHWP_UPDATE 운영 체크리스트를 수행한다.

## Rollback and recovery

workflow와 contract test를 되돌리면 수동 updater 절차로 즉시 복귀할 수 있다. 자동화 브랜치와 PR은
`main`과 분리되어 있으며, 실패한 candidate는 병합하지 않고 브랜치를 삭제해 복구한다. updater 자체의
실패 복구 동작은 변경하지 않는다.

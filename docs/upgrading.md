# Cập nhật RN Agent Observer

Hướng dẫn này dành cho cả người dùng source checkout và consumer package npm. Đọc
[changelog](../CHANGELOG.md), [compatibility matrix](compatibility.md) và phần
breaking change của version đích trước khi nâng.

## Nguyên tắc version

Năm package public `schemas`, `core`, `rn-instrumentation`, `cli` và `mcp-server`
dùng cùng một version. Root workspace và demo Expo là private. Nếu project cài trực
tiếp nhiều package, nâng chúng trong cùng một thay đổi để tránh schema/adapter lệch
nhau.

Artifacts và SQLite là evidence, không phải cache có thể xóa tùy tiện. Trước khi
nâng, stop active session, lưu hash/path của report cần giữ và không commit dữ liệu
runtime nhạy cảm.

## Cập nhật source checkout

Đảm bảo worktree sạch hoặc đã commit thay đổi của bạn, rồi cập nhật fast-forward:

```powershell
git status --short
git fetch origin
git pull --ff-only origin main

corepack enable
corepack prepare pnpm@9.6.0 --activate
pnpm install --frozen-lockfile
pnpm release:check
```

Không tự xóa `pnpm-lock.yaml`, `.pnpmfile.cjs` hoặc chuyển sang npm/Yarn/Bun khi
frozen install lỗi. So sánh version Node/pnpm trước, đọc thay đổi lockfile/hook rồi
mới regenerate bằng `pnpm install --no-frozen-lockfile` nếu bạn đang chủ động cập
nhật dependency cho repository.

Sau khi source đổi, luôn build lại vì CLI/MCP chạy `dist`:

```powershell
pnpm build
pnpm rn-observe --version
pnpm mcp:check
```

## Cập nhật package npm

Các lệnh dưới đây chỉ áp dụng sau lần publish đầu và khi `pnpm view` trả được
version:

```powershell
pnpm view @rn-agent-observer/cli version
pnpm outdated '@rn-agent-observer/*'

pnpm up --latest `
  @rn-agent-observer/cli `
  @rn-agent-observer/mcp-server `
  @rn-agent-observer/core `
  @rn-agent-observer/schemas `
  @rn-agent-observer/rn-instrumentation

pnpm exec rn-observe --version
pnpm exec rn-observer-mcp --check
```

Chỉ liệt kê package project thực sự dùng. Review `pnpm-lock.yaml` và không chấp
nhận việc một package Observer ở version khác phần còn lại.

## Khi nào phải rebuild app

| Thay đổi                                                | Cần làm gì                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| CLI/Core/MCP chạy ngoài app                             | Build/cài lại Node package; app thường không cần native rebuild                      |
| Logic JS của app                                        | Metro reload/OTA có thể đủ nếu runtime contract không đổi                            |
| `rn-instrumentation` hoặc Babel plugin                  | Restart Metro với cache sạch; tạo development build mới nếu native/bundle config đổi |
| Expo/RN/native dependency, manifest, permission, scheme | Native development build mới; OTA không đủ                                           |
| App ID/device/policy                                    | Review lại `.rn-observer.json`, exact allowlist và process trust                     |

Không dùng host test hoặc Expo export để tuyên bố native runtime đã pass. Thay đổi
device-facing phải chạy lại đúng scenario trên emulator/device và ghi evidence mới.

## Kiểm tra migration

```powershell
$env:RN_OBSERVER_PROJECT_ROOT = 'C:\src\my-app'
$env:RN_OBSERVER_DEVICE_ID = '<exact-serial>'

pnpm rn-observe doctor
pnpm rn-observe init --dry-run
pnpm rn-observe status
pnpm rn-observe session start
# đặt RN_OBSERVER_SESSION_ID từ output, rồi chạy scenario read-only phù hợp
pnpm rn-observe observe
pnpm rn-observe understand-screen
pnpm rn-observe ui-model
pnpm rn-observe session stop $env:RN_OBSERVER_SESSION_ID
```

Review config preview trước khi dùng `init --force`; thao tác này có thể ghi đè
policy cục bộ. Active action vẫn cần exact app/device/risk allowlist và
`RN_OBSERVER_TRUST_ACTIVE_CONFIG=1` ở process mới.

## Rollback

Với package đã publish, pin lại toàn bộ package Observer về cùng version đã biết:

```powershell
pnpm add --save-dev `
  @rn-agent-observer/cli@<version> `
  @rn-agent-observer/mcp-server@<version>
```

Với source checkout, checkout một tag vào worktree/branch riêng rồi chạy frozen
install; không reset phá hủy worktree đang có thay đổi. Không dùng database/artifact
từ schema mới để khẳng định bản cũ tương thích nếu chưa có migration evidence.

## Checklist cập nhật cho maintainer

1. Cập nhật changelog và đồng bộ version ở root, demo và năm package public.
2. Cập nhật compatibility/protocol/installation nếu contract thay đổi.
3. Regenerate lockfile bằng pnpm được pin; chạy frozen install lại.
4. Chạy `pnpm release:check`, OSV strict và device blueprint liên quan.
5. Review năm tarball và clean-consumer smoke.
6. Commit/tag/publish theo [release installation](release-installation.md).
7. Kiểm tra registry, provenance và clean install trước khi công bố.

# Release installation and publication

The intended primary distribution is the five npm packages below. They are
release-ready but were **not present in the npm registry at the 2026-08-24
verification snapshot**; until the first publication, use the source-checkout path
in [installation.md](installation.md). GitHub release attachments may additionally
contain source or Windows portable archives, but those attachments are optional.

All public packages use the same version:

| Package                                 | Purpose                                  |
| --------------------------------------- | ---------------------------------------- |
| `@rn-agent-observer/cli`                | `rn-observe` command                     |
| `@rn-agent-observer/mcp-server`         | `rn-observer-mcp` stdio server           |
| `@rn-agent-observer/core`               | Runtime/evidence engine for integrations |
| `@rn-agent-observer/schemas`            | Zod schemas and TypeScript contracts     |
| `@rn-agent-observer/rn-instrumentation` | Development-only application telemetry   |

The repository root and `@rn-agent-observer/demo-expo` remain private and are never
published.

## Requirements

- Node.js 22.12 or newer
- pnpm 9.6.0
- Android Platform Tools (`adb`) for device-facing commands
- A connected Android emulator or device for runtime observation
- An Expo development build when application-owned instrumentation is required

The source quality gate runs on Windows, Linux, and macOS in CI. That verifies
install, lint, formatting, TypeScript build, and unit tests; it does **not** claim
that Android device runtime behavior works on every host. The supported runtime
target remains the one explicitly documented in the README and capability matrix.
An Expo Android export proves bundling only and never substitutes for a device run.

## Install a published CLI release

First confirm that publication exists. Do not present a local tarball smoke result
as a public npm release:

```sh
pnpm view @rn-agent-observer/cli version
pnpm view @rn-agent-observer/mcp-server version
```

Only after both commands return the expected lockstep version:

Install in the project that will run the observer:

```sh
pnpm add --save-dev @rn-agent-observer/cli
pnpm exec rn-observe --version
pnpm exec rn-observe --help
```

For a one-off invocation without keeping a dependency:

```sh
pnpm dlx @rn-agent-observer/cli@latest --version
```

Set `RN_OBSERVER_PROJECT_ROOT`, `RN_OBSERVER_DEVICE_ID`, and optionally
`RN_OBSERVER_APP_ID` before a device workflow. Artifacts and session data are stored
under `<projectRoot>/.artifacts/`.

## Install the MCP server

```sh
pnpm add --save-dev @rn-agent-observer/mcp-server
pnpm exec rn-observer-mcp --check
```

Example client configuration when the package is installed in the client's working
directory:

```json
{
  "mcpServers": {
    "rn-agent-observer": {
      "command": "pnpm",
      "args": ["exec", "rn-observer-mcp"],
      "env": {
        "RN_OBSERVER_PROJECT_ROOT": "/absolute/path/to/app",
        "RN_OBSERVER_DEVICE_ID": "emulator-5554"
      }
    }
  }
}
```

The server uses stdio. Running it without `--check` waits for an MCP client and is
not a hung health check.

## Install integration packages

```sh
pnpm add @rn-agent-observer/core @rn-agent-observer/schemas
pnpm add --save-dev @rn-agent-observer/rn-instrumentation
```

Instrumentation is development-only. Do not ship it in a production build. Network
body capture is disabled by default and must not be enabled against real accounts or
production data.

## Build and verify from source

```sh
git clone https://github.com/GinzaTech/rn-agent-observer.git
cd rn-agent-observer
corepack enable
corepack prepare pnpm@9.6.0 --activate
pnpm install --frozen-lockfile
pnpm release:check
```

`pnpm release:check` runs lint, format validation, builds, tests, the MCP health
check, the CLI version check, a tarball plus clean-consumer smoke check for all
five public packages, and a disposable Android/Hermes export validation. The
tarball check writes ignored archives to
`.artifacts/package-smoke/` and verifies:

- package version and public npm metadata;
- README, Apache-2.0 license, runtime entrypoints, and declaration files;
- absence of source, compiled tests, and runtime artifacts;
- conversion of internal `workspace:*` dependencies to the exact release version.

It then creates an OS-temporary consumer project, installs the locally packed CLI,
MCP server, Core, and Schemas tarballs (including overrides for their internal
dependencies), and runs `rn-observe --version`, `rn-observe --help`,
`rn-observe init --dry-run`, and `rn-observer-mcp --check`. This verifies a release
without relying on the repository's installed workspace packages; the temporary
project is removed only after its path is safety-checked.

The Android export sub-gate can also be run independently:

```sh
pnpm android:export:check
```

It writes to a safety-checked OS temporary directory, verifies `metadata.json` and
exactly one Android Hermes bundle, then removes only that temporary directory.

Do not report Android runtime as verified unless the relevant scenario also ran on
a device or emulator and produced scoped before/after evidence.

After publication, verify registry propagation, sha512 integrity and a clean
consumer install of all five exact-version packages:

```sh
pnpm registry:check
```

The check retries bounded registry propagation, installs into a safety-checked OS
temporary directory, runs the public CLI version and MCP health check, prints only
registry metadata, and removes the temporary consumer.

## Registry authorization preflight

Complete this before creating a release tag. The exact `@rn-agent-observer` scope
must already exist on npm, and the publishing account or automation team must have
write access to it. Verify identity and scope membership without printing tokens:

```sh
npm whoami
npm org ls rn-agent-observer
pnpm view @rn-agent-observer/cli version
```

The final command is expected to return 404 only before the first publication. A
missing scope is different from a missing package: create the npm organization and
grant access instead of silently renaming all packages, because changing to another
scope changes every public import, command example and internal dependency.

Enable npm 2FA and bootstrap the protected GitHub `npm` environment with a
least-privilege granular access token that may publish this scope and is explicitly
configured for automation. Never store an npm password, one-time code, token or
generated `.npmrc` in the repository. The release workflow publishes from GitHub
Actions with provenance; after the initial package pages exist, migrate them to
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) where available
and revoke the bootstrap token. See npm's requirements for
[scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
and [provenance statements](https://docs.npmjs.com/generating-provenance-statements/).

## Verify release artifacts

For npm, compare the installed version with the GitHub release tag and inspect npm
provenance. For optional GitHub assets, use the release's `SHA256SUMS.txt` when one
is attached:

```powershell
Get-FileHash .\<downloaded-file> -Algorithm SHA256
```

```sh
sha256sum <downloaded-file>
```

Only use a portable archive whose operating system and architecture match its file
name. Never run `pnpm install` inside a portable bundle that documents bundled
production dependencies; build from the source archive instead when dependencies
must be regenerated.

## Maintainer release process

1. Update `CHANGELOG.md` and set one identical version in the root, demo, and five
   public package manifests. Keep internal source dependencies as `workspace:*`.
2. Run `pnpm install --frozen-lockfile` and `pnpm release:check`. Run the relevant
   device blueprint for runtime-facing changes.
3. Review every tarball produced under `.artifacts/package-smoke/`. Verify that the
   release claims distinguish static/unit coverage from device evidence.
4. Create a `v<version>` tag that exactly matches `package.json`, then create the
   GitHub release from that tag.
5. The protected npm workflow validates the tag and package manifests again, then
   publishes the five packages in dependency order with public access and npm
   provenance. The repository must provide an npm publishing credential through its
   protected `npm` environment.
6. Verify the package pages, provenance, executable names, and a clean install in a
   new temporary project with `pnpm registry:check` before announcing the release.

npm versions are immutable. If publication is partial, do not overwrite an already
published version; diagnose the failed package and prepare a new version according
to the changelog and compatibility policy.

---

# Cài đặt và phát hành

Năm package npm là kênh phân phối dự kiến. Tại snapshot kiểm tra 2026-08-24, chúng
**chưa tồn tại trên npm registry**; trước lần publish đầu, dùng source checkout theo
[hướng dẫn cài đặt](installation.md). Attachment GitHub Release có thể bổ sung source
hoặc portable bundle cho Windows nhưng là tùy chọn.

Năm package công khai luôn dùng cùng một version:

- `@rn-agent-observer/cli` cung cấp lệnh `rn-observe`;
- `@rn-agent-observer/mcp-server` cung cấp `rn-observer-mcp`;
- `@rn-agent-observer/core` và `@rn-agent-observer/schemas` dành cho integration;
- `@rn-agent-observer/rn-instrumentation` chỉ dành cho development build.

Root workspace và demo Expo vẫn `private`.

## Cài release đã publish

Xác nhận package đã tồn tại và cùng version trước:

```sh
pnpm view @rn-agent-observer/cli version
pnpm view @rn-agent-observer/mcp-server version
```

Chỉ sau khi registry trả version thay vì `404`:

```sh
pnpm add --save-dev @rn-agent-observer/cli
pnpm exec rn-observe --version

pnpm add --save-dev @rn-agent-observer/mcp-server
pnpm exec rn-observer-mcp --check
```

Lệnh cần device còn yêu cầu `adb`, device/emulator Android và các biến môi trường
`RN_OBSERVER_PROJECT_ROOT`, `RN_OBSERVER_DEVICE_ID`; app ID có thể được suy ra từ
`expo.android.package` hoặc đặt bằng `RN_OBSERVER_APP_ID`.

CI chạy source gate trên Windows/Linux/macOS chỉ chứng minh install, lint, format,
build và unit test. Expo export chỉ chứng minh bundle tạo được. Không được suy rộng
hai kết quả này thành Android runtime đã chạy trên device.

## Kiểm tra source trước release

```sh
pnpm install --frozen-lockfile
pnpm release:check
```

`release:check` kiểm tra cả năm tarball, README/LICENSE/entrypoint, metadata public,
file thừa và việc rewrite `workspace:*` thành đúng version release. Sau đó nó tạo một
consumer project trong thư mục tạm của hệ điều hành, cài tarball local của CLI, MCP,
Core và Schemas, rồi chạy `--version`, `--help`, `init --dry-run` và MCP `--check`.
Việc này không dựa vào package workspace đã cài trong repo; thư mục tạm chỉ bị xóa
sau khi kiểm tra an toàn đường dẫn. Gate này cũng export Android/Hermes vào thư mục
tạm của hệ điều hành, kiểm tra metadata và đúng một bundle, rồi dọn đúng thư mục đó.
Archive kiểm tra nằm trong
`.artifacts/package-smoke/` và không được commit.

## Preflight quyền npm

Trước khi tạo tag release, scope `@rn-agent-observer` phải tồn tại trên npm và tài
khoản/team publish phải có quyền ghi. Kiểm tra bằng `npm whoami`,
`npm org ls rn-agent-observer` và `pnpm view @rn-agent-observer/cli version`; package
có thể trả 404 trước lần publish đầu, nhưng scope không được thiếu. Không tự đổi sang
scope khác vì sẽ đổi toàn bộ public import và dependency nội bộ.

Bật 2FA cho npm, sau đó bootstrap protected GitHub environment `npm` bằng granular
access token ít quyền, chỉ cho phép publish scope này và được cấu hình rõ cho CI.
Không commit password, OTP, token hoặc `.npmrc` sinh ra. Workflow GitHub publish kèm
provenance; sau khi package page đầu tiên tồn tại, chuyển sang npm trusted publishing
nếu khả dụng rồi revoke token bootstrap. Xem tài liệu npm về
[scoped public package](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/),
[trusted publishing](https://docs.npmjs.com/trusted-publishers/) và
[provenance](https://docs.npmjs.com/generating-provenance-statements/).

Maintainer phải cập nhật changelog, đồng bộ version toàn workspace, chạy scenario
runtime liên quan trên device, tạo tag `v<version>` khớp tuyệt đối với manifest, rồi
tạo GitHub Release. Workflow npm được bảo vệ sẽ kiểm tra lại trước khi publish public
kèm provenance. Nếu publish dở dang, không ghi đè version đã tồn tại trên npm; sửa
nguyên nhân và chuẩn bị version mới.

# RN Agent Observer

[![CI](https://github.com/GinzaTech/rn-agent-observer/actions/workflows/ci.yml/badge.svg)](https://github.com/GinzaTech/rn-agent-observer/actions/workflows/ci.yml)

**VI** · [English](#rn-agent-observer-1)

RN Agent Observer là cầu nối quan sát và kiểm định cục bộ cho React Native/Expo. Công cụ dùng cùng một core TypeScript cho CLI và MCP, điều khiển Android qua ADB/UIAutomator, nhận telemetry từ instrumentation phát triển, chạy quality suite có evidence, kiểm tra bảo mật thụ động/supply chain và active scenario bị ràng buộc, lặp performance experiment, tạo dashboard offline đã lược dữ liệu nhạy cảm, chia sẻ `.rnobs` metadata-first, kiểm coverage route/action semantic, và lưu session bằng SQLite trong khi giữ binary lớn ở dạng artifact trên đĩa.

Bề mặt public hiện có CLI, 70 MCP tools, 6 MCP resources và 2 workflow prompts. Các gate host và bằng chứng runtime Android được báo riêng trong [tài liệu kiểm thử](docs/testing.md), [ma trận AVD API 24/30/36](docs/android-device-matrix.md) và [compatibility matrix](docs/compatibility.md). CI có API 30 emulator smoke read-only cho exact demo fixture; tính năng hoặc API/OEM khác chưa chạy đúng fixture vẫn giữ `NOT_VERIFIED`, không được suy rộng từ unit test, export hay một AVD. Ví dụ [Maestro + Observer](examples/maestro/README.md) minh hoạ cách runner E2E điều khiển flow còn Observer thu evidence, thay vì cố thay thế toàn bộ Maestro/Detox/Appium hoặc device farm.

## Yêu cầu

- Node.js 22.12 trở lên
- pnpm 9.6
- Android Platform Tools (`adb`)
- Android emulator hoặc thiết bị vật lý đã cho phép USB debugging
- Expo development build nếu cần telemetry riêng của ứng dụng

## Cài đặt

Người dùng CLI/MCP nên cài public release `2.5.0` hoặc mới hơn:

```powershell
pnpm add --save-dev @rn-agent-observer/cli @rn-agent-observer/mcp-server
pnpm exec rn-observe --version
pnpm exec rn-observer-mcp --check
```

Năm package public được phát hành lockstep ở `2.5.0` qua npm Trusted Publishing và
được workflow kiểm tra clean-consumer sau publish. Không cài `2.4.0`: đó là bản bootstrap namespace có
dependency `workspace:*` không hợp lệ. Contributor phát triển từ source bằng:

```powershell
git clone https://github.com/GinzaTech/rn-agent-observer.git
Set-Location .\rn-agent-observer
corepack prepare pnpm@9.6.0 --activate
pnpm install --frozen-lockfile
pnpm release:check
```

Xem [hướng dẫn cài đặt từng bước](docs/installation.md) cho source, device, MCP và
instrumentation; xem [cài đặt/phát hành](docs/release-installation.md) cho maintainer.
Instrumentation chỉ được bật trong development build.

## Bắt đầu nhanh từ source

```powershell
pnpm install --frozen-lockfile
pnpm check
adb devices -l
pnpm rn-observe --help
pnpm mcp:check
```

Trỏ observer vào app Expo/React Native:

```powershell
$env:RN_OBSERVER_PROJECT_ROOT = 'C:\path\to\expo-app'
$env:RN_OBSERVER_DEVICE_ID = 'emulator-5554'
# Có thể bỏ qua nếu app.json chứa expo.android.package
$env:RN_OBSERVER_APP_ID = 'com.example.app'

pnpm rn-observe doctor
pnpm rn-observe init --dry-run
pnpm rn-observe init
# Khởi động app owned/development fixture theo cách bình thường trước khi quan sát.
pnpm rn-observe observe
pnpm rn-observe understand-screen
pnpm rn-observe ui-model
pnpm rn-observe performance
pnpm rn-observe diagnose
```

Lần đầu tạo policy read-only: các lệnh ở trên chỉ quan sát. `launch`, `tap`, replay,
deep link, permission, trace và recording chỉ hoạt động sau khi owner chủ động cấp
`authorized-active` cho đúng development fixture; xem phần active policy bên dưới.
Artifacts và SQLite được tạo trong `<projectRoot>/.artifacts/`; binary lớn không được
nhúng vào MCP response.

## Quality, security và report

Chạy từ source bằng `pnpm rn-observe`; khi cài package CLI thì thay bằng
`pnpm exec rn-observe`:

```powershell
pnpm rn-observe doctor
pnpm rn-observe init --dry-run
pnpm rn-observe init
pnpm rn-observe suite list
pnpm rn-observe suite init .rn-observer/suites/project.yaml --profile smoke
pnpm rn-observe suite validate .rn-observer/suites/project.yaml
pnpm rn-observe suite run smoke --reporter json,html,junit,sarif,github
pnpm rn-observe ci --suite smoke,security
pnpm rn-observe security audit --strict
pnpm rn-observe security sbom --lockfile pnpm-lock.yaml
pnpm rn-observe security dependencies --lockfile pnpm-lock.yaml --strict
pnpm rn-observe target support
pnpm rn-observe target support --manifest PROVIDER_MANIFEST.json
pnpm rn-observe coverage analyze ROUTE_ACTION_COVERAGE.json --strict
pnpm rn-observe runner import test-results/mobile.xml --runner maestro --strict
pnpm rn-observe runner compare BASELINE_RUNNER_RESULT.json CURRENT_RUNNER_RESULT.json --strict
$bundle = pnpm rn-observe session share SESSION_ID --output shares/review.rnobs | ConvertFrom-Json
pnpm rn-observe bundle verify $bundle.path --sha256 $bundle.sha256
pnpm rn-observe performance experiment --scenario home-idle --idle --samples 5
pnpm rn-observe performance experiment --scenario cold-start --startup --samples 5
pnpm rn-observe performance memory --scenario feed-loop --replay replay.json --cycles 10 --max-growth-mb 16
pnpm rn-observe performance tti --strict
pnpm rn-observe dashboard build --limit 20 --output dashboard/latest.html
pnpm rn-observe open --limit 20
pnpm rn-observe session graph <session-id>
```

`suite init`/`suite validate` là workflow authoring offline, không cần device. Kết
quả JUnit từ Maestro, Detox hoặc Appium có thể được gắn vào cùng session bằng
`runner import`; `runner compare` sau đó phân loại lỗi mới, đã hồi phục và còn tái
diễn. Observer chỉ giữ aggregate, duration, source hash và case hash, không copy raw
XML, test name hay failure body. Xem [runner integrations](docs/runner-integrations.md)
và [GitHub Action evidence gate](docs/github-action.md). Đặt cùng secret process-side
được mask để case identity dùng HMAC-SHA-256 khi artifact đi qua CI.

`doctor` chỉ probe readiness; `init --dry-run` nên được review trước khi tạo
`.rn-observer.json`. `open` phục vụ report read-only trên numeric loopback và giữ
process chạy tới khi nhận Ctrl+C/SIGTERM; nó không tự mở trình duyệt. Performance
interaction/startup/memory cần policy `authorized-active`; interaction/memory cần
replay xác định. `--idle` là đường read-only nhưng không thay thế profiling đúng
interaction; cold-start `am start -W` không phải time-to-interactive và memory PSS
growth không tự chứng minh leak. `target support` chỉ inspect matrix/manifest và
không spawn plugin process; `target collect` cần manifest provider cụ thể, operation,
explicit grant và evidence validation. `session share` yêu cầu project đã bật
`artifacts.allowShare: true`; output là file mới, contained dưới artifact root và
không ghi đè. `--include-text` là opt-in; `--strict` biến bundle `NOT_VERIFIED`
thành exit 1.

Suite và security/performance report dùng bốn outcome tách biệt: `PASS`, `FAIL`,
`NA`, `NOT_VERIFIED`. `PASS` cần evidence; thiếu capability, bị hủy, audit chưa
hoàn tất hoặc baseline không tương thích phải là `NOT_VERIFIED`. Xem
[protocol](docs/protocol.md) và [hướng dẫn security testing](docs/security-testing.md)
để biết exit code và giới hạn.

## Active security, chia sẻ, coverage và target mở rộng

Active security chỉ có hai scenario Android bounded: malformed deep-link query và
runtime permission transition. Chúng bị tắt mặc định và chỉ chạy khi app ID đã được
allowlist, user có quyền kiểm thử app owned/development fixture, policy chuyển sang
`authorized-active`, risk được grant, `target.deviceId` khớp exact serial ADB đang
chọn và scenario nêu rõ probe/allowed screen state.
Không có login, purchase, account mutation, credential replay hay network
interception; permission scenario luôn thử restore state cũ. Xem
[security testing](docs/security-testing.md) trước khi bật nó.

`permissions grant|revoke` là surface **persistent** riêng, không phải active
security: cần risk `persistent-permission`, `allowPersistentPermissionChanges: true`,
allowlist đúng tên runtime permission và flag
`--confirm-persistent-permission` cho từng lệnh. Nó xác minh state sau ADB nhưng
không tự restore hoặc relaunch app.

`.rnobs` là bundle session portable, canonical và metadata-first: mặc định không
chứa timeline, path, binary hay content artifact; binary embedding luôn tắt. Text là
opt-in có giới hạn + secret scan, nên artifact bị exclude/không xác minh sẽ khiến
bundle là `NOT_VERIFIED`. Verify bundle kiểm SHA-256, format/policy/limit và không
extract file. CLI `bundle verify` dùng được cho bundle portable local; MCP
`verify_session_share_bundle` chỉ đọc path relative dưới artifact root. Nó giúp share
evidence hẹp hơn, không biến session thành public-safe tự động.

Coverage route/action chỉ dựa trên inventory semantic ID do project khai báo và
checkpoint/interaction explicit từ đúng target. `null`, unknown hoặc unobservable
không được gán đoán sang route/action khác; `PASS` coverage không chứng minh mọi
branch/behavior đã test. Threshold, đủ evidence và target fingerprint tương thích là
bắt buộc để có thể `PASS`. Dùng `coverage analyze INPUT.json` hoặc MCP
`coverage_analyze`; report đã lược dữ liệu được persist thành artifact local.

Android là device provider built-in duy nhất. iOS, web và Windows chỉ
extension-ready qua external provider, chưa phải runtime support built-in. Provider
khai báo capability `target.<platform>.<operation>`, chạy external process có
handshake/isolation và phải trả evidence envelope đúng target; manifest hợp lệ hay
`extension-available` vẫn không phải device verification. Xem
[architecture](docs/architecture.md) và [plugin development](docs/plugin-development.md).

## Demo xác định

```powershell
pnpm --filter @rn-agent-observer/demo-expo android -- --device <device-name>
```

Demo có `PerformanceLab`, `NetworkLab`, `RenderLab`, `AnimationLab`, `ErrorLab` và `VisualLab`. NetworkLab dùng fixture nội bộ 0/500/2000ms và 503 nên không phụ thuộc dịch vụ Internet. PerformanceLab báo chính xác long JS task 100ms qua instrumentation.

## MCP

```powershell
pnpm mcp:check
pnpm mcp:start
```

Server dùng stdio. Cấu hình client, 70 tools, 6 resources, 2 prompts và contract
progress/cancellation nằm trong [docs/protocol.md](docs/protocol.md).

## Tích hợp cho AI agent

Có 3 cách để agent (OpenCode/Claude Code/Cursor/Codex...) dùng observer:

**1. MCP server (khuyến nghị — tool có cấu trúc)**

```json
{
  "mcpServers": {
    "rn-agent-observer": {
      "command": "node",
      "args": [
        "C:\\abs\\rn-agent-observer\\packages\\mcp-server\\dist\\server.js"
      ],
      "env": {
        "RN_OBSERVER_PROJECT_ROOT": "C:\\path\\to\\expo-app",
        "RN_OBSERVER_DEVICE_ID": "emulator-5554"
      }
    }
  }
}
```

**2. Cài như skill (dạy agent workflow debug bằng lệnh)**

```powershell
npx skills add GinzaTech/rn-agent-observer
```

Skill nằm tại `skills/rn-agent-observer/SKILL.md` — dạy agent vòng `observe -> understand-screen -> reproduce -> diagnose -> fix -> understand-screen -> compare`, cách đọc metric trung thực và xử lý lỗi thường gặp. Sau khi cài, chỉ cần nói "debug app X đang lag" agent sẽ tự biết dùng `rn-observe`.

**3. AGENTS.md (nếu agent làm việc ngay trong repo này)** — đã có sẵn ở root, agent tự đọc.

Cả 3 cách có thể dùng cùng lúc: skill/AGENTS.md dạy _workflow_, MCP cung cấp _tool gọi trực tiếp_.

## Tài liệu

- [Cài đặt từng bước](docs/installation.md)
- [Hướng dẫn sử dụng chi tiết](docs/usage.md)
- [Cấu trúc repository](docs/project-structure.md)
- [Cập nhật và migration](docs/upgrading.md)
- [Tổng quan dự án đầy đủ (VI/EN)](PROJECT.md)
- [Kiến trúc](docs/architecture.md)
- [CLI và MCP protocol](docs/protocol.md)
- [Định nghĩa metrics](docs/metrics.md)
- [Capability matrix](docs/capability-matrix.md)
- [Kiểm thử và runtime verification](docs/testing.md)
- [Ma trận Android emulator API 24/30/36](docs/android-device-matrix.md)
- [Security testing](docs/security-testing.md)
- [Phát triển plugin](docs/plugin-development.md)
- [Lộ trình test chuẩn (test blueprint)](docs/test-blueprint.md)
- [Cài đặt và phát hành package](docs/release-installation.md)
- [Xử lý sự cố](docs/troubleshooting.md)
- [Changelog](CHANGELOG.md)
- [Roadmap](ROADMAP.md) · [Hỗ trợ](SUPPORT.md) · [Maintainers](MAINTAINERS.md)
- [Đóng góp](CONTRIBUTING.md) · [Bảo mật](SECURITY.md) · [Quản trị](GOVERNANCE.md)

## Phiên bản hiện tại

- Device/runtime provider hiện là Android. Bằng chứng runtime đã ghi nhận trên host Windows với physical Android 15/arm64 và AVD API 24/30/36 x86_64; CI còn chạy read-only demo smoke trên Ubuntu/API 30 x86_64. macOS vẫn host-only, và một AVD CI không mở rộng thành broad OEM/device-farm support; mọi exact assurance scenario chưa chạy đúng fixture giữ `NOT_VERIFIED`.
- ADB không có tín hiệu JS FPS đáng tin cậy; field được trả `available: false`, không đoán số.
- JS blocking, route, React renders và network metadata cần instrumentation phát triển trong app.
- Export DevTools qua CDP (`devtools-export`, `devtools-profile`) và network per-request (`metro-network`) cần Metro đang chạy và app kết nối được Metro (`adb reverse tcp:8081 tcp:8081`); không dùng được khi một phiên React Native DevTools khác đang giữ kết nối.
- `reload --fast` dùng CDP Page.reload (JS-only); tự fallback về force-stop khi Metro không khả dụng.
- App không có instrumentation: dùng `metro-network` (CDP), `app-state` (foreground activity, PID) và `device-network` (byte counters device-level, không quy về app) làm evidence fallback.
- `record` (screenrecord) giới hạn 180s/clip theo Android.
- Perfetto trace đã hỗ trợ Android; phân tích trace sâu vẫn dùng Perfetto UI/Android Studio.
- Command CDP được queue giữa process; React Native DevTools bên ngoài vẫn phải đóng vì không dùng lock của observer.
- `session stop` tự sinh replay; ref trong session ổn định qua reorder/scroll; thiếu session phát `EVIDENCE_NOT_RECORDED`.
- `understand-screen`/MCP `understand_screen` trả route instrumentation khi có, screen state, headline, text/action refs, UI findings và screenshot/UI-tree evidence; gọi lặp phát hiện loading không đổi. Classification là heuristic và text-field luôn được redact.
- `ui-model`/MCP `runtime_ui_model` parse TSX bằng TypeScript AST để lấy component + `file:line`, rồi correlate với instrumentation và native tree. Kết quả phân biệt `rendered`, `visible/offscreen/hidden/unmounted/flattened-or-unobserved`, `enabled` và `canPress` có reason.
- Babel plugin development-only tự thêm testID nguồn và wrap `onPress`; session stop thu interaction `start/success/error`, đưa tap có testID vào replay. Không ghi handler arguments, props hay input value.
- Observer không thu network body mặc định. Opt-in development-only dùng allowlist fail-closed nhưng vẫn chỉ dùng với fixture development.
- `security audit` là static/passive và MASVS-aligned, không phải chứng nhận MASVS hay dynamic penetration test; `security dependencies` cần truy cập OSV và audit chưa đủ dữ liệu không được trả `PASS`.
- Active security chỉ có Android malformed deep-link query và bounded permission
  transition cho owned, allowlisted development fixture; policy/host test không phải
  pentest hay device runtime evidence. Không làm login, purchase, account mutation,
  credential replay hoặc network interception.
- `.rnobs` là metadata-first share bundle, không phải full session export: mặc định
  không gồm timeline/path/binary/content; secret-safe text embedding chỉ là opt-in.
  `PASS` bundle kiểm format/hash/policy chứ không bảo đảm artifact gốc public-safe.
- Route/action coverage chỉ tính semantic evidence explicit từ target tương thích;
  không suy từ source/text/coordinates và không chứng minh mọi behavior đã test.
- Dashboard offline/loopback chỉ chứa aggregate count, allowlisted metric và hash; không nhúng timeline/evidence/finding text/source path/project root/artifact path, secret, binary hay base64. Trend chỉ sinh khi các session complete có fingerprint runtime/device tương thích.
- Plugin analyzer/reporter chỉ chạy in-process khi được đánh dấu trusted và được host grant permission. Provider/action có `ExternalPluginHost` JSON-RPC stdio fail-closed với cwd/env/message/timeout/process-tree isolation; chúng không được auto-discover hay tự expose qua CLI/MCP.
- Android là provider built-in duy nhất. iOS/web/Windows chỉ extension-ready qua
  provider external, chưa implement built-in và không có runtime claim nếu chưa có
  evidence của đúng provider/target.

---

# RN Agent Observer (English)

RN Agent Observer is a local observability and assurance bridge for React Native/Expo. One TypeScript core powers the CLI and MCP server, drives Android through ADB/UIAutomator, receives development telemetry, runs evidence-backed quality suites, performs passive, supply-chain, and bounded active security checks, repeats performance experiments, builds privacy-reduced offline dashboards, shares metadata-first `.rnobs` bundles, evaluates semantic route/action coverage, and persists sessions in SQLite while keeping large binaries as on-disk artifacts.

The public surface currently includes the CLI, 70 MCP tools, 6 MCP resources, and 2 workflow prompts. Host gates and Android device evidence are reported separately in [the testing record](docs/testing.md), the [API 24/30/36 AVD matrix](docs/android-device-matrix.md), and the [compatibility matrix](docs/compatibility.md); a new feature that has not run against the correct device fixture remains `NOT_VERIFIED` and is not inferred from unit tests or device-free CI.

## Requirements

- Node.js 22.12 or newer
- pnpm 9.6
- Android Platform Tools (`adb`)
- An Android emulator or physical device with USB debugging enabled
- An Expo development build if you need app-specific telemetry

## Installation

CLI/MCP users should install public release `2.5.0` or newer:

```powershell
pnpm add --save-dev @rn-agent-observer/cli @rn-agent-observer/mcp-server
pnpm exec rn-observe --version
pnpm exec rn-observer-mcp --check
```

All five public packages were published in lockstep with npm provenance and passed
a clean-consumer install. Do not install `2.4.0`; it was a namespace bootstrap
whose public dependencies retained invalid `workspace:*` ranges. Contributors can
still use the source checkout:

```powershell
git clone https://github.com/GinzaTech/rn-agent-observer.git
Set-Location .\rn-agent-observer
corepack prepare pnpm@9.6.0 --activate
pnpm install --frozen-lockfile
pnpm release:check
```

See the [step-by-step installation guide](docs/installation.md) for source, device,
MCP, and instrumentation setup. Maintainers should use the
[release installation guide](docs/release-installation.md). Instrumentation must
remain development-only.

## Quick Start from source

```powershell
pnpm install --frozen-lockfile
pnpm check
adb devices -l
pnpm rn-observe --help
pnpm mcp:check
```

Point the observer at your Expo/React Native app:

```powershell
$env:RN_OBSERVER_PROJECT_ROOT = 'C:\path\to\expo-app'
$env:RN_OBSERVER_DEVICE_ID = 'emulator-5554'
# Optional when app.json contains expo.android.package
$env:RN_OBSERVER_APP_ID = 'com.example.app'

pnpm rn-observe doctor
pnpm rn-observe init --dry-run
pnpm rn-observe init
# Start the owned/development fixture normally before observing it.
pnpm rn-observe observe
pnpm rn-observe understand-screen
pnpm rn-observe ui-model
pnpm rn-observe performance
pnpm rn-observe diagnose
```

First run creates a read-only policy, so the commands above only observe. `launch`,
`tap`, replay, deep links, permissions, tracing, and recording require an owner to
explicitly grant `authorized-active` for the exact development fixture; see the active
policy section below. Artifacts and SQLite data are created under
`<projectRoot>/.artifacts/`; large binaries are never embedded in MCP responses.

## Quality, security, and reports

Use `pnpm rn-observe` from the source workspace. For an installed CLI package,
replace it with `pnpm exec rn-observe`:

```powershell
pnpm rn-observe doctor
pnpm rn-observe init --dry-run
pnpm rn-observe init
pnpm rn-observe suite list
pnpm rn-observe suite init .rn-observer/suites/project.yaml --profile smoke
pnpm rn-observe suite validate .rn-observer/suites/project.yaml
pnpm rn-observe suite run smoke --reporter json,html,junit,sarif,github
pnpm rn-observe ci --suite smoke,security
pnpm rn-observe security audit --strict
pnpm rn-observe security sbom --lockfile pnpm-lock.yaml
pnpm rn-observe security dependencies --lockfile pnpm-lock.yaml --strict
pnpm rn-observe target support
pnpm rn-observe target support --manifest PROVIDER_MANIFEST.json
pnpm rn-observe coverage analyze ROUTE_ACTION_COVERAGE.json --strict
pnpm rn-observe runner import test-results/mobile.xml --runner maestro --strict
pnpm rn-observe runner compare BASELINE_RUNNER_RESULT.json CURRENT_RUNNER_RESULT.json --strict
$bundle = pnpm rn-observe session share SESSION_ID --output shares/review.rnobs | ConvertFrom-Json
pnpm rn-observe bundle verify $bundle.path --sha256 $bundle.sha256
pnpm rn-observe performance experiment --scenario home-idle --idle --samples 5
pnpm rn-observe performance experiment --scenario cold-start --startup --samples 5
pnpm rn-observe performance memory --scenario feed-loop --replay replay.json --cycles 10 --max-growth-mb 16
pnpm rn-observe performance tti --strict
pnpm rn-observe dashboard build --limit 20 --output dashboard/latest.html
pnpm rn-observe open --limit 20
pnpm rn-observe session graph <session-id>
```

`suite init` and `suite validate` are offline authoring workflows and do not need a
device. JUnit output from Maestro, Detox, or Appium can be attached to the same
session with `runner import`; `runner compare` then identifies new, recovered, and
persistent failures. Observer retains only aggregates, durations, the source hash,
and case hashes—not raw XML, test names, or failure bodies. Use the same masked
process-side secret to derive HMAC-SHA-256 case identities across CI runs. See
[runner integrations](docs/runner-integrations.md) and the
[GitHub Action evidence gate](docs/github-action.md).

`doctor` probes readiness without proving runtime behavior. Review
`init --dry-run` before writing `.rn-observer.json`. `open` serves a read-only
report on numeric loopback and remains active until Ctrl+C/SIGTERM; it does not
launch a browser. Interaction, startup, and memory experiments require an
`authorized-active` policy; interaction and memory modes also require an exact
replay. Idle mode is read-only, but it is not a substitute for profiling the
target interaction. Android `am start -W` is not time-to-interactive, and
process-PSS growth does not by itself prove a leak. `target support` only inspects a
matrix/manifest and does not spawn a plugin process; `target collect` needs an
explicit provider manifest, operation, permission grant, and evidence validation.
`session share` requires the project to enable `artifacts.allowShare: true`; its
output is a new contained file below the artifact root and is never overwritten.
`--include-text` is opt-in, while `--strict` turns a `NOT_VERIFIED` bundle into exit
code 1.

Suite and security/performance reports preserve four outcomes: `PASS`, `FAIL`,
`NA`, and `NOT_VERIFIED`. PASS requires evidence. Missing capabilities,
cancellation, incomplete audits, and incompatible baselines remain
NOT_VERIFIED. See the [protocol](docs/protocol.md) and
[security testing guide](docs/security-testing.md) for exit semantics and
limitations.

## Active security, sharing, coverage, and extensible targets

Active security currently has only two bounded Android scenarios: malformed deep-link
queries and runtime permission transitions. They are disabled by default and run only
when the app ID is allowlisted, the user is authorized to test the owned/development
fixture, policy is deliberately set to `authorized-active`, the risk is granted, and
`target.deviceId` exactly matches the selected ADB serial, and the scenario declares
its probes and allowed screen states. There is no login,
purchase, account mutation, credential replay, or network interception; a permission
scenario always attempts to restore the original state. Read [security testing](docs/security-testing.md)
before enabling it.

`permissions grant|revoke` is a separate **persistent** surface, not active
security: it requires the `persistent-permission` risk,
`allowPersistentPermissionChanges: true`, an exact runtime-permission allowlist,
and `--confirm-persistent-permission` on every invocation. It verifies the resulting
state but never restores it or relaunches the app.

`.rnobs` is a portable, canonical, metadata-first session bundle: by default it has
no timeline, paths, binaries, or artifact content, and binary embedding is always
off. Text inclusion is opt-in, bounded, and secret-scanned, so excluded or unverified
entries make the bundle `NOT_VERIFIED`. Verification checks SHA-256,
format/policy/limits and never extracts files. This is a narrower way to share
evidence, not an automatic guarantee that a session is public-safe. CLI `bundle
verify` works on a local portable bundle; MCP `verify_session_share_bundle` reads
only a relative path below the artifact root.

Route/action coverage uses only a project-declared semantic-ID inventory and explicit
target-scoped checkpoints/interactions. `null`, unknown, or unobservable values are
never attributed to another route/action; coverage PASS does not prove every
branch/behavior was tested. A threshold, sufficient evidence, and a compatible target
fingerprint are required before it can PASS. Use `coverage analyze INPUT.json` or MCP
`coverage_analyze`; the redacted report is persisted as a local artifact.

Android is the only built-in device provider. iOS, web, and Windows are
extension-ready through external providers, not built-in runtime support. A provider
declares `target.<platform>.<operation>`, runs as an isolated external process, and
must return evidence for the selected target; a valid manifest or
`extension-available` is still not device verification. See
[architecture](docs/architecture.md) and [plugin development](docs/plugin-development.md).

## Deterministic demo

```powershell
pnpm --filter @rn-agent-observer/demo-expo android -- --device <device-name>
```

The demo ships `PerformanceLab`, `NetworkLab`, `RenderLab`, `AnimationLab`, `ErrorLab`, and `VisualLab`. NetworkLab uses internal fixtures (0/500/2000ms and HTTP 503) so it never depends on Internet services. PerformanceLab reports its intentional 100ms long JS task precisely through instrumentation.

## MCP

```powershell
pnpm mcp:check
pnpm mcp:start
```

The server speaks stdio. Client configuration, 70 tools, 6 resources, 2 prompts,
and progress/cancellation behavior are documented in
[docs/protocol.md](docs/protocol.md).

## Documentation

- [Step-by-step installation](docs/installation.md)
- [Full project overview (VI/EN)](PROJECT.md)
- [Detailed usage guide (Vietnamese)](docs/usage.md)
- [Repository structure](docs/project-structure.md)
- [Upgrade and migration guide](docs/upgrading.md)
- [Architecture](docs/architecture.md)
- [CLI and MCP protocol](docs/protocol.md)
- [Metrics definitions](docs/metrics.md)
- [Capability matrix](docs/capability-matrix.md)
- [Testing and runtime verification](docs/testing.md)
- [Android emulator API 24/30/36 matrix](docs/android-device-matrix.md)
- [Security testing](docs/security-testing.md)
- [Plugin development](docs/plugin-development.md)
- [Test blueprint](docs/test-blueprint.md)
- [Release installation and publication](docs/release-installation.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Changelog](CHANGELOG.md)
- [Roadmap](ROADMAP.md) · [Support](SUPPORT.md) · [Maintainers](MAINTAINERS.md)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Governance](GOVERNANCE.md)

## AI agent integration

Three ways for agents (OpenCode/Claude Code/Cursor/Codex...) to use the observer:

**1. MCP server (recommended — structured tools)**

```json
{
  "mcpServers": {
    "rn-agent-observer": {
      "command": "node",
      "args": [
        "C:\\abs\\rn-agent-observer\\packages\\mcp-server\\dist\\server.js"
      ],
      "env": {
        "RN_OBSERVER_PROJECT_ROOT": "C:\\path\\to\\expo-app",
        "RN_OBSERVER_DEVICE_ID": "emulator-5554"
      }
    }
  }
}
```

**2. Install as a skill (teaches the agent the debugging workflow via CLI)**

```powershell
npx skills add GinzaTech/rn-agent-observer
```

The skill lives at `skills/rn-agent-observer/SKILL.md` — it teaches the `observe -> understand-screen -> reproduce -> diagnose -> fix -> understand-screen -> compare` loop, how to read metrics honestly, and common failure recovery. After installing, just say "app X feels laggy" and the agent knows to reach for `rn-observe`.

**3. AGENTS.md (when the agent works inside this repo)** — already present at the repo root; agents read it automatically.

All three can be combined: the skill/AGENTS.md teach the _workflow_, MCP provides _directly callable tools_.

## Current boundary

- The device/runtime provider currently targets Android. Recorded runtime evidence used a Windows host with a physical Android 15/arm64 device and API 24/30/36 x86_64 AVDs; CI also runs a read-only owned-demo smoke on Ubuntu/API 30 x86_64. macOS remains host-only, and one CI AVD does not establish broad OEM/device-farm support; any exact scenario not run on the correct fixture remains `NOT_VERIFIED`.
- ADB has no trustworthy JS FPS signal; the field is returned as `available: false` — values are never guessed.
- JS blocking, route, React renders, and network metadata require development instrumentation inside the app.
- CDP features (`devtools-export`, `devtools-profile`, `metro-network`) need Metro running for the right app and the app connected to it (`adb reverse tcp:8081 tcp:8081`); they cannot attach while another React Native DevTools session holds the connection.
- `reload --fast` uses CDP Page.reload (JS-only) and automatically falls back to force-stop when Metro is unavailable.
- Observer CDP commands queue across processes; external React Native DevTools must still be closed because it does not participate in the observer lock.
- `session stop` automatically writes a replay, session refs survive reorder/scroll, and missing sessions produce `EVIDENCE_NOT_RECORDED`.
- `understand-screen`/MCP `understand_screen` returns the instrumented route when available, screen state, headline, text/action refs, UI findings, and screenshot/UI-tree evidence; repeated calls detect unchanged loading. Classification is heuristic and text-field values are always redacted.
- `ui-model`/MCP `runtime_ui_model` parses TSX with the TypeScript AST for component + `file:line`, then correlates source with instrumentation and the native tree. It returns `target-not-running` or `target-not-foreground` rather than attributing another app's UI to the target, and otherwise distinguishes rendered, visible/off-screen/hidden/unmounted/flattened-or-unobserved, enabled, and evidence-backed `canPress` states.
- The development-only Babel plugin injects a source-derived testID and wraps `onPress`; session stop collects interaction start/success/error and promotes testID taps into replay. Handler arguments, props, and input values are never recorded.
- Network body capture is off by default. Development-only opt-in uses fail-closed allowlists and should still be limited to fixtures.
- Apps without instrumentation: use `metro-network` (CDP), `app-state` (foreground activity, PID), and `device-network` (device-level byte counters, not app-attributed) as fallback evidence.
- `record` (screenrecord) is limited to 180s per clip by Android.
- Perfetto tracing is supported on Android; deep trace analysis remains in Perfetto UI/Android Studio.
- `security audit` is static/passive and MASVS-aligned, not a MASVS certification or a dynamic penetration test. Its `scope` reports the selected inputs; artifact-only scans remain `NOT_VERIFIED` for manifest checks. `security dependencies` contacts OSV, and an incomplete query never becomes PASS.
- Active security is limited to Android malformed deep-link queries and bounded
  permission transitions for an owned, allowlisted development fixture; policy or
  host tests are not a pentest or device-runtime evidence. It never performs login,
  purchase, account mutation, credential replay, or network interception.
- `.rnobs` is a metadata-first sharing bundle, not a full-session export: it excludes
  timelines/paths/binaries/content by default, and secret-safe text inclusion is
  opt-in. A bundle PASS verifies its format/hash/policy, not that every source
  artifact is public-safe.
- Route/action coverage counts only explicit semantic evidence from a compatible
  target; it does not infer from source/text/coordinates or prove every behavior was
  tested.
- Offline/loopback dashboards contain aggregate counts, allowlisted metrics, and hashes only. They omit timelines, evidence/finding text, source/project/artifact paths, secrets, binaries, and base64; trends require complete sessions with compatible device/runtime fingerprints.
- Analyzer/reporter plugins run in-process only when explicitly trusted and granted permissions by the host. Providers/actions use an explicit fail-closed JSON-RPC stdio `ExternalPluginHost` with cwd, environment, message, timeout, and process-tree isolation; they are not auto-discovered or automatically exposed through CLI/MCP.
- Android is the only built-in provider. iOS/web/Windows are only extension-ready via
  external providers, not built-in implementations and not runtime claims without
  evidence for that exact provider/target.

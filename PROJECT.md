# RN Agent Observer

**VI** · [EN](#english) · Version 2.4.1 · Android target, cross-platform Node host

RN Agent Observer là cầu nối quan sát runtime cục bộ (local runtime observability bridge) cho ứng dụng React Native/Expo trên Android. Công cụ cho phép AI coding agent (OpenCode, Claude Code, Codex, Cursor...) hoặc lập trình viên **quan sát, chẩn đoán và xác minh** ứng dụng đang chạy mà không cần nhìn màn hình — mọi bằng chứng runtime (screenshot, UI tree, FPS, network, render, console, heap, trace, video) đều có cấu trúc, đo đếm được và so sánh trước/sau được.

```text
AI Agent ──CLI─────────────┐
                           ├──> ObserverCore ──> ADB / UIAutomator / Perfetto (Android)
AI Agent ──MCP (66 tools)─┘        │      ──> Metro CDP (console/network/profile/heap)
                                   │      ──> RN instrumentation (fetch/route/render/JS task)
                                   v
                        SQLite session + artifact trên đĩa (.artifacts/)
```

> **Triết lý cốt lõi**: Evidence trước, kết luận sau. Không bao giờ bịa số liệu — metric nào đo không được phải trả `available: false` kèm lý do.

Cài đặt/cập nhật theo [installation](docs/installation.md) và
[upgrading](docs/upgrading.md); bản đồ source chi tiết nằm trong
[project structure](docs/project-structure.md).

## Mục lục

- [Yêu cầu](#yêu-cầu)
- [Bắt đầu nhanh](#bắt-đầu-nhanh)
- [Cách hoạt động](#cách-hoạt-động)
- [Kiến trúc](#kiến-trúc)
- [Hướng dẫn sử dụng](#hướng-dẫn-sử-dụng)
- [Các nguồn evidence](#các-nguồn-evidence)
- [So sánh với các dự án tương tự](#so-sánh-với-các-dự-án-tương-tự)
- [Testing](#testing)
- [Bảo mật & giới hạn](#bảo-mật--giới-hạn)

## Yêu cầu

- Node.js >= 22.12
- pnpm 9.6 (qua corepack)
- Android Platform Tools (`adb`) trên PATH
- Android emulator hoặc thiết bị vật lý đã bật USB debugging
- (Tùy chọn) Metro dev server — cần cho các tính năng CDP: `devtools-export`, `devtools-profile`, `metro-network`, `reload --fast`
- (Tùy chọn) Expo development build — cần cho instrumentation telemetry

## Bắt đầu nhanh

```powershell
pnpm install --frozen-lockfile
pnpm check                    # lint + format + build + test
pnpm build                    # CLI/MCP chạy từ dist — bắt buộc sau khi sửa source
adb devices -l

# Trỏ observer vào app đích
$env:RN_OBSERVER_PROJECT_ROOT = 'C:\path\to\expo-app'
$env:RN_OBSERVER_DEVICE_ID = 'emulator-5554'   # hoặc serial thiết bị thật

pnpm rn-observe launch
pnpm rn-observe observe       # 1 lệnh: screenshot + UI + route + perf + network + logs + app_state
pnpm rn-observe diagnose
```

## Cách hoạt động

### Vòng đời một phiên debug (workflow chính)

```text
1. observe          → chụp tổng cảnh 1 lệnh (screen/UI/route/perf/network/logs/app_state)
2. session start    → mọi lệnh sau ghi timeline vào SQLite, bền qua nhiều process
3. tái hiện         → tap --test-id / tap --ref (semantic, không đoán tọa độ)
4. evidence sâu     → performance / metro-network / devtools-export / trace / record
5. diagnose         → finding + confidenceBasis (heuristic, không phải xác suất)
6. sửa code nhỏ nhất
7. reload (--fast)  → JS-only qua CDP, giữ native state
8. tái hiện y hệt   → cùng testID, cùng kịch bản
9. compare          → pixel diff + structural UI diff (similarity, vùng đổi, added/removed/changed)
10. session stop    → summary.json + auto replay; agent báo before/after metrics + artifact paths
```

### Ba lớp thu thập dữ liệu

| Lớp                    | Cơ chế                                                                                | Có gì                                                                                                                                                                        | Khi nào dùng                                                         |
| ---------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **ADB trực tiếp**      | spawn `adb` bằng argument array, timeout mỗi lệnh                                     | device info, screenshot, UIAutomator tree, tap/swipe/type, logcat, gfxinfo framestats, meminfo, top, Perfetto, screenrecord, dumpsys (activity/permissions), `/proc/net/dev` | Luôn available — offline, deterministic, không cần gì từ app         |
| **Metro CDP**          | WebSocket vào inspector của Metro (tự gửi `Origin` header — Metro chặn 401 nếu thiếu) | console entries, exceptions, Hermes heap, JS CPU profile, **network per-request không cần instrumentation** (RN 0.83+), Page.reload                                          | Cần Metro chạy cho đúng app + `adb reverse tcp:8081 tcp:8081`        |
| **RN instrumentation** | Package dev-only cài vào app; phát event JSON prefix vào console (logcat)             | fetch timing (đã redact), route events, React Profiler renders, long JS task, app-data snapshot (Redux/nav/MMKV)                                                             | Cần development build — cho phép redact tại nguồn và app-owned facts |

### Nguyên tắc evidence (áp dụng toàn hệ thống)

1. **Metric envelope**: mọi số liệu phải đủ `{name, value, unit, source, timestamp, available}`. Khi `available: false` phải có `reason` (VD: `js_fps` luôn unavailable vì ADB không có tín hiệu JS FPS đáng tin cậy).
2. **Finding = hypothesis có evidence**: `diagnose` trả severity, heuristic confidence, `confidenceBasis`, evidence và recommendation. Score phụ thuộc độ vượt ngưỡng + độ mạnh của sample/source, không phải xác suất thống kê.
3. **Artifact là citizen hạng nhất**: PNG/JSON/trace/mp4 nằm trên đĩa dưới `.artifacts/`; SQLite và MCP response chỉ chứa metadata/path — không base64, không binary blob.
4. **Redact fail-closed tại nguồn**: URL query/header/body preview dùng allowlist; key lạ bị che **trước khi** event ra logcat.
5. **Lỗi có cấu trúc**: `{error: {code, message, recoverable, suggestion}}` — luôn kèm gợi ý khắc phục, không có stack trace trong response.

## Kiến trúc

### Cấu trúc monorepo (pnpm workspace, TypeScript strict ESM)

```text
rn-agent-observer/
├── packages/
│   ├── schemas/            # Zod schemas + shared types — KHÔNG chứa logic runtime
│   │   └── src/            # device, ui, screen, performance, network, log, session,
│   │                       # diagnosis, observer, artifact, trace, status, devtools, app-state
│   ├── core/               # TOÀN BỘ device/runtime logic — bộ não duy nhất
│   │   └── src/
│   │       ├── index.ts        # ObserverCore façade, session/artifact wiring
│   │       ├── adb/            # AdbClient + parsers (devices/UI tree/logcat/framestats/
│   │       │                   # meminfo/top/resumed-activity/proc-net-dev/permissions)
│   │       ├── devtools/       # CDP client (ws), metro discovery, devtools-exporter,
│   │       │                   # metro-network, metro-reload, profiler
│   │       ├── diagnosis/      # rule engine deterministic (5 rules)
│   │       ├── comparison/     # pixelmatch + structural UI-tree diff
│   │       ├── network/        # instrumentation event parsers + summarize + redactUrl
│   │       ├── performance/    # Perfetto + phát hiện gfx frame window stale
│   │       ├── recording/      # screenrecord manager (max 180s/clip)
│   │       ├── refs/           # ref ổn định theo session + settle diff
│   │       ├── replay/         # replay script runner (9 loại bước)
│   │       ├── routes/         # expo-router sitemap từ filesystem
│   │       ├── session/        # SQLite WAL SessionStore (sessions/events/artifacts)
│   │       └── artifacts/      # ArtifactManager (đĩa) + config.ts (app ID resolution)
│   ├── cli/                # rn-observe — parse flag + in JSON, KHÔNG chứa logic
│   ├── mcp-server/         # MCP stdio server — 66 tools, adapter mỏng gọi core
│   └── rn-instrumentation/ # package dev-only cài vào app (fetch/route/render/js-task/app-data
│                           # + redactUrl/redactSensitiveText/redactHeaders) — dependency-free
├── apps/
│   └── demo-expo/          # Golden AUT: 6 lab deterministic (Performance/Network/Render/
│                           # Animation/Error/Visual) + testID map + app-data fixture
├── docs/                   # usage, protocol, architecture, metrics, capability-matrix,
│                           # test-blueprint (~190 case chuẩn), testing, troubleshooting
├── AGENTS.md               # hướng dẫn cho AI agent làm việc trong repo này
└── CHANGELOG.md
```

### Luồng phụ thuộc (một chiều, bắt buộc)

```text
schemas  <──  core  <──  cli
                  <──  mcp-server
rn-instrumentation  ──>  (cài vào app được quan sát)
demo-expo  ──>  rn-instrumentation
```

**Quy tắc kiến trúc quan trọng nhất**: CLI và MCP là _adapter mỏng_ — mọi logic device/runtime chỉ nằm trong `packages/core`. Thêm lệnh mới = thêm method vào `ObserverCore` + 1 nhánh `else if` trong CLI + 1 `registerTool` trong MCP. Không bao giờ trùng lặp implementation giữa CLI và MCP.

### Luồng dữ liệu một lệnh `observe`

```text
CLI observe
  └─> ObserverCore.observeScreen()
       ├─> AdbClient.screenshot()        ──> exec-out screencap ──> PNG artifact
       ├─> AdbClient.uiTree()            ──> uiautomator dump ──> XML ──> normalize ──> JSON artifact
       ├─> getLogs(2000)                 ──> logcat -d --pid ──> parse entries
       │     ├─> routeFromLogs()         ──> RN_AGENT_OBSERVER_ROUTE events
       │     └─> networkRequestsFromLogs ──> RN_AGENT_OBSERVER_NETWORK events
       ├─> performanceSnapshot()         ──> gfxinfo+meminfo+top+display (song song)
       │     └─> jsTasksFromLogs()       ──> override js_blocking_ms nếu task < 5 phút
       └─> appState()                    ──> pidof + dumpsys activity (foreground?)
       ──> mỗi bước record() vào SQLite nếu có session ──> Observation (Zod-validated)
```

### Runtime state nằm ở đâu

| State                                | Vị trí                                                                                                   | Sống qua process?                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Session timeline + artifact metadata | `.artifacts/observer.sqlite` (WAL)                                                                       | Có — mọi process CLI/MCP cùng project root |
| Trace đang chạy                      | `.artifacts/active-traces/<id>.json`                                                                     | Có — start/stop hai terminal khác nhau     |
| Recording đang chạy                  | `.artifacts/active-recordings/<id>.json`                                                                 | Có — như trên                              |
| Snapshot ref trong session           | `.artifacts/sessions/<id>/state/last-snapshot.json`                                                      | Có — identity giữ ref qua reorder/scroll   |
| Snapshot ref standalone              | `.artifacts/snapshots/last.json`                                                                         | Có — dùng ngoài session                    |
| CDP connection lock                  | `.artifacts/cdp-locks/inspector.lock`                                                                    | Có — atomic queue giữa process             |
| Gfx frame freshness                  | `.artifacts/performance-state/<appId>.json`                                                              | Có — không tái dùng sample window cũ       |
| Artifact binary                      | `.artifacts/sessions/<id>/{screenshots,ui-trees,traces,recordings,devtools-exports,profiles,summaries}/` | Có                                         |

## Hướng dẫn sử dụng

### Biến môi trường

| Biến                       | Ý nghĩa                                      | Mặc định                           |
| -------------------------- | -------------------------------------------- | ---------------------------------- |
| `RN_OBSERVER_PROJECT_ROOT` | Thư mục app đích                             | cwd                                |
| `RN_OBSERVER_DEVICE_ID`    | ADB serial — bắt buộc khi nhiều device ready | (tự chọn nếu 1 device)             |
| `RN_OBSERVER_APP_ID`       | Android package override                     | `expo.android.package` từ app.json |
| `RN_OBSERVER_SESSION_ID`   | Ghi event/artifact vào session sẵn có        | (không)                            |
| `RN_OBSERVER_METRO_URL`    | Base URL Metro cho tính năng CDP             | `http://127.0.0.1:8081`            |
| `RN_OBSERVER_ADB`          | Đường dẫn adb executable khác                | `adb`                              |

### Lệnh CLI theo nhóm

```text
Thiết bị & app:
  devices | device-info | launch | reload [--fast]
  app-state | device-network [--window MS] | routes
  deep-link --uri URI | permissions [list|grant|revoke --perm NAME]

Quan sát màn hình & tương tác:
  screenshot | ui-tree | snapshot [--interactive|-i] | understand-screen [--stuck-after MS] | ui-model
  tap (--test-id ID | --ref E1 [--settle MS] | --x X --y Y)
  swipe --from X,Y --to X,Y [--duration MS] | type-text --text VALUE | back

Evidence:
  logs [--level L] [--keyword K] [--limit N]
  performance | render-stats | network [requests|summary]
  metro-network [--duration MS] [--metro URL]          (CDP, không cần instrumentation)
  app-data [--namespace NAME]
  observe                                                (tổng hợp 7 loại)

DevTools/CDP:
  devtools-export [--duration MS] [--metro URL]         (console/exception/heap)
  devtools-profile [--duration MS] [--metro URL]        (JS CPU .cpuprofile)

Trace & recording:
  trace start [--duration MS] | trace stop TRACE_ID     (Perfetto)
  record start [--duration MS] | record stop RECORDING_ID  (mp4, max 180s)

Verify & lặp lại:
  assert (--test-id ID | --text VALUE) [--visible true|false]
  a11y-audit | replay run SCRIPT.json | replay export SESSION_ID
  artifacts cleanup [--days N] [--dry-run]

Phân tích & session:
  diagnose | compare BEFORE.png AFTER.png [--before-ui T.json --after-ui T.json]
  session start | session stop [ID] | session get ID | status | help | --version
```

### Ví dụ workflow debug tiêu biểu

```powershell
# 0. Môi trường
$env:RN_OBSERVER_PROJECT_ROOT = 'C:\apps\my-expo-app'
$env:RN_OBSERVER_DEVICE_ID = '<physical-device-serial>'

# 1. Baseline
pnpm rn-observe launch
pnpm rn-observe session start     # => ghi lại session id, set RN_OBSERVER_SESSION_ID
pnpm rn-observe observe
pnpm rn-observe screenshot        # artifact PNG để so sánh sau

# 2. Tái hiện bằng semantic target (ưu tiên testID >> ref >> tọa độ)
pnpm rn-observe tap --test-id open-cart
pnpm rn-observe performance
pnpm rn-observe metro-network --duration 10000   # cần Metro + adb reverse
pnpm rn-observe diagnose

# 3. Sửa code... rồi reload nhanh (JS-only, giữ native state)
pnpm rn-observe reload --fast

# 4. Tái hiện y hệt + so sánh
pnpm rn-observe tap --test-id open-cart
pnpm rn-observe screenshot
pnpm rn-observe compare <before.png> <after.png> --before-ui <b.json> --after-ui <a.json>
pnpm rn-observe session stop <id>
```

### Ref snapshot + diff (kiểu agent-device)

```powershell
pnpm rn-observe snapshot -i        # chỉ phần tử tương tác: e1 [button] "Buy", ...
pnpm rn-observe tap --ref e2 --settle 1500
# => { performed: true, target: {...}, diff: {
#      lines: ['+ @e7 [text-field] "Ada"', '= @e3 [text] "idle" -> "done"] } }
# Ref chỉ hợp lệ với snapshot gần nhất — sau settle dùng ref từ output mới.
```

### Replay script

```json
{
  "name": "checkout-smoke",
  "steps": [
    { "action": "tap", "testId": "open-NetworkLab", "settleMs": 1500 },
    { "action": "tap", "testId": "network-500" },
    { "action": "assert", "testId": "network-result" },
    { "action": "wait", "ms": 300 },
    { "action": "screenshot" }
  ]
}
```

```powershell
pnpm rn-observe replay run .\scripts\checkout-smoke.json
# => { total: 4, passed: 4, failed: 0, stoppedEarly: false, results: [...] }
```

### Cài instrumentation vào app của bạn (dev build only)

```tsx
import {
  createRenderTracker,
  installNetworkObserver,
  reportAppData,
  reportJsTask,
  reportRoute,
} from '@rn-agent-observer/rn-instrumentation';
import { Profiler, useEffect, useMemo } from 'react';

const onRender = useMemo(() => createRenderTracker('App'), []);
useEffect(() => installNetworkObserver(), []); // fetch timing + redact
useEffect(() => reportRoute(route), [route]);
reportAppData('redux-store', { cart: { items: 2 } }); // state snapshot
const started = performance.now();
expensiveWork();
reportJsTask(performance.now() - started, 'expensiveWork');

return (
  <Profiler id="App" onRender={onRender}>
    {children}
  </Profiler>
);
```

Body capture (opt-in, dev-only, có cảnh báo, max 4096 ký tự):

```ts
installNetworkObserver(createInstrumentationConfig(true, true));
```

### MCP server

```powershell
pnpm mcp:check    # health check
pnpm mcp:start    # stdio server
```

Cấu hình client (Claude/OpenCode/Cursor...) — xem danh sách 66 tools trong `docs/protocol.md`:

```json
{
  "mcpServers": {
    "rn-agent-observer": {
      "command": "node",
      "args": ["C:\\abs\\path\\packages\\mcp-server\\dist\\server.js"],
      "env": {
        "RN_OBSERVER_PROJECT_ROOT": "C:\\apps\\my-expo-app",
        "RN_OBSERVER_DEVICE_ID": "emulator-5554"
      }
    }
  }
}
```

## Các nguồn evidence

| Nguồn                          | Lệnh/tool                                          | Cần gì           | Độ tin cậy                                 |
| ------------------------------ | -------------------------------------------------- | ---------------- | ------------------------------------------ |
| ADB dumpsys gfxinfo framestats | `performance` (ui_fps, frame_time, worst, dropped) | Không            | Cao — số đo hệ thống                       |
| ADB meminfo/top                | `performance` (memory_mb, cpu_percent)             | Không            | Cao (snapshot)                             |
| Instrumentation JS task        | `performance` (js_blocking_ms, confidence 0.99)    | Dev build        | Cao — đo trong app                         |
| Instrumentation fetch          | `network`                                          | Dev build        | Cao, đã redact                             |
| Metro CDP Network              | `metro-network`                                    | Metro + RN 0.83+ | Cao — per-request thật                     |
| Metro CDP Console/Heap         | `devtools-export`                                  | Metro            | Cao                                        |
| Metro CDP Profiler             | `devtools-profile`                                 | Metro + Hermes   | Cao                                        |
| UIAutomator tree               | `ui-tree`, `snapshot`                              | Không            | Trung bình — semantics RN một phần         |
| Perfetto                       | `trace`                                            | Không            | Cao — phân tích sâu bằng Perfetto UI       |
| `/proc/net/dev` delta          | `device-network`                                   | Không            | Thấp cho app — device-level, chỉ tham khảo |
| ADB JS FPS                     | —                                                  | —                | **Không có** — luôn `available: false`     |

## So sánh với các nhóm dự án tương tự

| Góc nhìn             | RN Agent Observer                                                     | E2E/device-control như Maestro, Detox, Appium  | React Native DevTools/profiler               | Cloud device farm                                 |
| -------------------- | --------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| Vai trò chính        | Evidence/assurance cho agent                                          | Điều khiển và assertion flow                   | Debug component/JS/native chuyên sâu         | Chạy ma trận thiết bị song song                   |
| Điểm mạnh            | Evidence schema, availability, session graph, redaction, before/after | Hệ sinh thái runner và automation trưởng thành | Props/stack/profile tương tác sâu            | Quy mô OEM/API và quản lý thiết bị                |
| Khoảng trống         | Android built-in duy nhất, ít adoption, không thay profiler           | Thường cần lớp evidence/report riêng cho agent | Không phải audit trail/CI assurance tổng hợp | Chi phí, dữ liệu rời máy và ít source correlation |
| Privacy mặc định     | Local-first, không account; artifact ở project                        | Tùy runner và hạ tầng                          | Local development                            | Cần review nhà cung cấp/retention                 |
| Trạng thái cộng đồng | Public từ 2.4.1, hiện một maintainer                                  | Tùy dự án, thường trưởng thành hơn             | Được hệ sinh thái RN duy trì                 | Dịch vụ thương mại/managed                        |

**Định vị**: Observer bổ sung một **evidence layer** cho runner, DevTools và device
farm; không tuyên bố thay thế toàn phần bất kỳ nhóm nào. So sánh capability phải
được cập nhật từ exact version thay vì dùng số sao hoặc dấu thiếu tính năng dễ lỗi
thời gian.

## Testing

```powershell
pnpm check                                    # lint --max-warnings=0 + format + build + test
pnpm --filter @rn-agent-observer/core test   # một package
pnpm --filter @rn-agent-observer/core test -- src/refs   # một file/pattern
pnpm mcp:check                                # MCP health check
```

- **Unit/integration**: gate 2026-08-24 pass 363/363 tests, gồm bounded parser fuzz regression; xem breakdown, coverage threshold và lịch sử trong `docs/testing.md`
- **Test blueprint** (`docs/test-blueprint.md`): bộ tham chiếu chuẩn ~190 case (21 domain, 4 tier T0–T3) để test observer trên bất kỳ app RN nào và regression chính observer — golden AUT là `apps/demo-expo`
- **Runtime verification**: physical Android 15/arm64 và AVD API 24/30/36 x86_64 đã hoàn tất vòng demo 2.4.0 ngày 2026-08-24; đây là bốn exact fixtures, chưa phải broad OEM/device-farm matrix — xem `docs/android-device-matrix.md`
- **Quy tắc**: không tuyên bố runtime Android hoạt động nếu chưa chạy trên device/emulator thật

## Bảo mật & giới hạn

### An toàn (mặc định)

- Không thu network body mặc định; opt-in dev-only có cảnh báo + giới hạn 4096 ký tự
- Redact token/api-key/password/secret/PII trong URL, body preview, headers
- Không thu secrets; screenshot/UI tree chỉ on-demand; logcat giới hạn số dòng
- MCP response không bao giờ chứa binary/base64 — chỉ artifact path
- **App ngoài repo (VD Vshop): chỉ observe read-only** — không mua hàng, đăng nhập, đổi cài đặt hay thao tác gì ngoài phạm vi được phép

### Giới hạn hiện tại (biên trung thực)

- Chỉ Android + Windows; không iOS/Web
- Tính năng CDP cần Metro chạy cho đúng app và **không dùng được khi React Native DevTools UI đang giữ kết nối** (1 inspector connection / target)
- `metro-network` chỉ thấy fetch/XHR từ JS runtime (RN 0.83+); request native không nằm trong nguồn này
- `device-network` là byte counters toàn thiết bị — không quy về app cụ thể
- `record` giới hạn 180s/clip theo Android
- Ref snapshot chỉ hợp lệ với snapshot gần nhất (refs thay đổi sau settle)
- So sánh ảnh yêu cầu cùng device + orientation (`DIMENSION_MISMATCH` nếu không)

---

# English

**EN** · [VI](#rn-agent-observer) · Version 2.4.1 · Android target, cross-platform Node host

RN Agent Observer is a local runtime observability bridge for React Native/Expo apps on Android. It lets AI coding agents (OpenCode, Claude Code, Codex, Cursor...) or developers **observe, diagnose and verify** a running app without looking at the screen — every piece of runtime evidence (screenshot, UI tree, FPS, network, renders, console, heap, traces, video) is structured, measurable, and comparable before/after code changes.

## Table of Contents

- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Usage Guide](#usage-guide)
- [Evidence Sources](#evidence-sources)
- [Comparison With Similar Projects](#comparison-with-similar-projects)
- [Testing](#testing-en)
- [Security & Limitations](#security--limitations)

## Requirements

- Node.js >= 22.12
- pnpm 9.6 (via corepack)
- Android Platform Tools (`adb`) on PATH
- Android emulator or physical device with USB debugging
- (Optional) Metro dev server — required for CDP features: `devtools-export`, `devtools-profile`, `metro-network`, `reload --fast`
- (Optional) Expo development build — required for instrumentation telemetry

## Quick Start

```powershell
pnpm install --frozen-lockfile
pnpm check                    # lint + format + build + test
pnpm build                    # CLI/MCP run from dist — required after source changes
adb devices -l

# Point the observer at the target app
$env:RN_OBSERVER_PROJECT_ROOT = 'C:\path\to\expo-app'
$env:RN_OBSERVER_DEVICE_ID = 'emulator-5554'

pnpm rn-observe launch
pnpm rn-observe observe       # one command: screen + UI + route + perf + network + logs + app_state
pnpm rn-observe diagnose
```

## How It Works

### The debugging loop (primary workflow)

```text
1. observe          → one-command snapshot (screen/UI/route/perf/network/logs/app_state)
2. session start    → subsequent commands persist a SQLite timeline, durable across processes
3. reproduce        → tap --test-id / tap --ref (semantic, no guessed coordinates)
4. deep evidence    → performance / metro-network / devtools-export / trace / record
5. diagnose         → finding + confidenceBasis (heuristic, not a probability)
6. make the smallest fix
7. reload (--fast)  → JS-only via CDP, keeps native state
8. reproduce again  → same testIDs, same scenario
9. compare          → pixel diff + structural UI diff (similarity, regions, added/removed/changed)
10. session stop    → summary.json + auto replay; agent reports before/after metrics + artifact paths
```

### Three collection layers

| Layer                  | Mechanism                                                                                        | Provides                                                                                                                                                                     | Availability                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Direct ADB**         | spawn `adb` with argument arrays, per-command timeout                                            | device info, screenshot, UIAutomator tree, tap/swipe/type, logcat, gfxinfo framestats, meminfo, top, Perfetto, screenrecord, dumpsys (activity/permissions), `/proc/net/dev` | Always — offline, deterministic, nothing needed from the app                     |
| **Metro CDP**          | WebSocket into Metro's inspector (sends the `Origin` header — Metro rejects with 401 without it) | console entries, exceptions, Hermes heap, JS CPU profile, **per-request network without app instrumentation** (RN 0.83+), Page.reload                                        | Requires Metro running for the right app + `adb reverse tcp:8081 tcp:8081`       |
| **RN instrumentation** | Dev-only package installed in the app; emits prefixed JSON events to the console (logcat)        | fetch timing (redacted), route events, React Profiler renders, long JS tasks, app-data snapshots (Redux/nav/MMKV)                                                            | Requires a development build — enables source-side redaction and app-owned facts |

### Evidence principles (enforced system-wide)

1. **Metric envelope**: every measurement must carry `{name, value, unit, source, timestamp, available}`. When `available: false`, a `reason` is required (e.g. `js_fps` is always unavailable because ADB has no trustworthy JS FPS signal).
2. **Findings are evidence-backed hypotheses**: `diagnose` returns severity, heuristic confidence, `confidenceBasis`, evidence, and recommendations. The score uses threshold deviation plus sample/source strength; it is not a statistical probability.
3. **Artifacts are first-class**: PNG/JSON/traces/mp4 live on disk under `.artifacts/`; SQLite and MCP responses carry only metadata/paths — no base64, no binary blobs.
4. **Fail-closed redaction at the source**: URL query/header/body previews use allowlists; unknown keys are masked **before** events reach logcat.
5. **Structured errors**: `{error: {code, message, recoverable, suggestion}}` — always with a recovery hint, never a raw stack trace in responses.

## Architecture

### Monorepo layout (pnpm workspace, strict TypeScript ESM)

```text
rn-agent-observer/
├── packages/
│   ├── schemas/            # Zod schemas + shared types — NO runtime logic
│   ├── core/               # ALL device/runtime logic — the single brain
│   │   └── src/
│   │       ├── index.ts        # ObserverCore façade, session/artifact wiring
│   │       ├── adb/            # AdbClient + parsers (devices/UI tree/logcat/framestats/
│   │       │                   # meminfo/top/resumed-activity/proc-net-dev/permissions)
│   │       ├── devtools/       # CDP client (ws), metro discovery, devtools-exporter,
│   │       │                   # metro-network, metro-reload, profiler
│   │       ├── diagnosis/      # deterministic rule engine (5 rules)
│   │       ├── comparison/     # pixelmatch + structural UI-tree diff
│   │       ├── network/        # instrumentation event parsers + summarize + redactUrl
│   │       ├── performance/    # Perfetto + stale gfx frame-window detection
│   │       ├── recording/      # screenrecord manager (max 180s/clip)
│   │       ├── refs/           # session-stable refs + settle diff
│   │       ├── replay/         # replay script runner (9 step types)
│   │       ├── routes/         # expo-router sitemap from the filesystem
│   │       ├── session/        # SQLite WAL SessionStore (sessions/events/artifacts)
│   │       └── artifacts/      # ArtifactManager (disk) + config.ts (app ID resolution)
│   ├── cli/                # rn-observe — flag parsing + JSON printing, NO logic
│   ├── mcp-server/         # MCP stdio server — 66 tools, thin adapter over core
│   └── rn-instrumentation/ # dev-only package for the observed app (fetch/route/render/
│                           # js-task/app-data + redactUrl/redactSensitiveText/redactHeaders)
├── apps/
│   └── demo-expo/          # Golden AUT: 6 deterministic labs + testID map + fixtures
├── docs/                   # usage, protocol, architecture, metrics, capability-matrix,
│                           # test-blueprint (~190 reference cases), testing, troubleshooting
├── AGENTS.md               # instructions for AI agents working in this repo
└── CHANGELOG.md
```

### Dependency flow (one-way, enforced)

```text
schemas  <──  core  <──  cli
                  <──  mcp-server
rn-instrumentation  ──>  (installed into the observed app)
demo-expo  ──>  rn-instrumentation
```

**The most important architectural rule**: CLI and MCP are _thin adapters_ — all device/runtime logic lives in `packages/core`. Adding a command = add a method to `ObserverCore` + one `else if` branch in the CLI + one `registerTool` in MCP. Never duplicate implementation between CLI and MCP.

### Data flow of a single `observe` command

```text
CLI observe
  └─> ObserverCore.observeScreen()
       ├─> AdbClient.screenshot()        ──> exec-out screencap ──> PNG artifact
       ├─> AdbClient.uiTree()            ──> uiautomator dump ──> XML ──> normalize ──> JSON artifact
       ├─> getLogs(2000)                 ──> logcat -d --pid ──> parse entries
       │     ├─> routeFromLogs()         ──> RN_AGENT_OBSERVER_ROUTE events
       │     └─> networkRequestsFromLogs ──> RN_AGENT_OBSERVER_NETWORK events
       ├─> performanceSnapshot()         ──> gfxinfo+meminfo+top+display (parallel)
       │     └─> jsTasksFromLogs()       ──> override js_blocking_ms if task < 5 min old
       └─> appState()                    ──> pidof + dumpsys activity (foreground?)
       ──> each step record()s into SQLite if a session is active ──> Observation (Zod-validated)
```

### Where runtime state lives

| State                                | Location                                                                                                 | Survives processes?                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Session timeline + artifact metadata | `.artifacts/observer.sqlite` (WAL)                                                                       | Yes — any CLI/MCP process on the same project root |
| Active traces                        | `.artifacts/active-traces/<id>.json`                                                                     | Yes — start and stop from different terminals      |
| Active recordings                    | `.artifacts/active-recordings/<id>.json`                                                                 | Yes — same                                         |
| Session ref snapshot                 | `.artifacts/sessions/<id>/state/last-snapshot.json`                                                      | Yes — identity retains refs across reorder/scroll  |
| Standalone ref snapshot              | `.artifacts/snapshots/last.json`                                                                         | Yes — used outside sessions                        |
| CDP connection lock                  | `.artifacts/cdp-locks/inspector.lock`                                                                    | Yes — atomic cross-process queue                   |
| Gfx frame freshness                  | `.artifacts/performance-state/<appId>.json`                                                              | Yes — prevents reuse of stale sample windows       |
| Artifact binaries                    | `.artifacts/sessions/<id>/{screenshots,ui-trees,traces,recordings,devtools-exports,profiles,summaries}/` | Yes                                                |

## Usage Guide

### Environment variables

| Variable                   | Meaning                                               | Default                              |
| -------------------------- | ----------------------------------------------------- | ------------------------------------ |
| `RN_OBSERVER_PROJECT_ROOT` | Target app directory                                  | cwd                                  |
| `RN_OBSERVER_DEVICE_ID`    | ADB serial — required when multiple devices are ready | (auto-select if one device)          |
| `RN_OBSERVER_APP_ID`       | Android package override                              | `expo.android.package` from app.json |
| `RN_OBSERVER_SESSION_ID`   | Record events/artifacts into an existing session      | (none)                               |
| `RN_OBSERVER_METRO_URL`    | Metro base URL for CDP features                       | `http://127.0.0.1:8081`              |
| `RN_OBSERVER_ADB`          | Custom adb executable path                            | `adb`                                |

### CLI commands by group

```text
Device & app:
  devices | device-info | launch | reload [--fast]
  app-state | device-network [--window MS] | routes
  deep-link --uri URI | permissions [list|grant|revoke --perm NAME]

Screen & interaction:
  screenshot | ui-tree | snapshot [--interactive|-i] | understand-screen [--stuck-after MS] | ui-model
  tap (--test-id ID | --ref E1 [--settle MS] | --x X --y Y)
  swipe --from X,Y --to X,Y [--duration MS] | type-text --text VALUE | back

Evidence:
  logs [--level L] [--keyword K] [--limit N]
  performance | render-stats | network [requests|summary]
  metro-network [--duration MS] [--metro URL]          (CDP, no instrumentation needed)
  app-data [--namespace NAME]
  observe                                                (7 evidence kinds combined)

DevTools/CDP:
  devtools-export [--duration MS] [--metro URL]         (console/exception/heap)
  devtools-profile [--duration MS] [--metro URL]        (JS CPU .cpuprofile)

Trace & recording:
  trace start [--duration MS] | trace stop TRACE_ID     (Perfetto)
  record start [--duration MS] | record stop RECORDING_ID  (mp4, max 180s)

Verify & repeat:
  assert (--test-id ID | --text VALUE) [--visible true|false]
  a11y-audit | replay run SCRIPT.json | replay export SESSION_ID
  artifacts cleanup [--days N] [--dry-run]

Analysis & sessions:
  diagnose | compare BEFORE.png AFTER.png [--before-ui T.json --after-ui T.json]
  session start | session stop [ID] | session get ID | status | help | --version
```

### Typical debugging workflow

```powershell
# 0. Environment
$env:RN_OBSERVER_PROJECT_ROOT = 'C:\apps\my-expo-app'
$env:RN_OBSERVER_DEVICE_ID = '<physical-device-serial>'

# 1. Baseline
pnpm rn-observe launch
pnpm rn-observe session start     # => note session id, set RN_OBSERVER_SESSION_ID
pnpm rn-observe observe
pnpm rn-observe screenshot        # PNG artifact for later comparison

# 2. Reproduce with semantic targets (prefer testID >> ref >> coordinates)
pnpm rn-observe tap --test-id open-cart
pnpm rn-observe performance
pnpm rn-observe metro-network --duration 10000   # needs Metro + adb reverse
pnpm rn-observe diagnose

# 3. Fix the code... then fast reload (JS-only, keeps native state)
pnpm rn-observe reload --fast

# 4. Reproduce identically + compare
pnpm rn-observe tap --test-id open-cart
pnpm rn-observe screenshot
pnpm rn-observe compare <before.png> <after.png> --before-ui <b.json> --after-ui <a.json>
pnpm rn-observe session stop <id>
```

### Ref snapshots + diff (agent-device style)

```powershell
pnpm rn-observe snapshot -i        # interactive elements only: e1 [button] "Buy", ...
pnpm rn-observe tap --ref e2 --settle 1500
# => { performed: true, target: {...}, diff: {
#      lines: ['+ @e7 [text-field] "Ada"', '= @e3 [text] "idle" -> "done"] } }
# Refs are only valid against the latest snapshot — after settle, use refs from the new output.
```

### Replay scripts

```json
{
  "name": "checkout-smoke",
  "steps": [
    { "action": "tap", "testId": "open-NetworkLab", "settleMs": 1500 },
    { "action": "tap", "testId": "network-500" },
    { "action": "assert", "testId": "network-result" },
    { "action": "wait", "ms": 300 },
    { "action": "screenshot" }
  ]
}
```

```powershell
pnpm rn-observe replay run .\scripts\checkout-smoke.json
# => { total: 4, passed: 4, failed: 0, stoppedEarly: false, results: [...] }
```

### Installing instrumentation into your app (dev builds only)

```tsx
import {
  createRenderTracker,
  installNetworkObserver,
  reportAppData,
  reportJsTask,
  reportRoute,
} from '@rn-agent-observer/rn-instrumentation';
import { Profiler, useEffect, useMemo } from 'react';

const onRender = useMemo(() => createRenderTracker('App'), []);
useEffect(() => installNetworkObserver(), []); // fetch timing + redaction
useEffect(() => reportRoute(route), [route]);
reportAppData('redux-store', { cart: { items: 2 } }); // state snapshot
const started = performance.now();
expensiveWork();
reportJsTask(performance.now() - started, 'expensiveWork');

return (
  <Profiler id="App" onRender={onRender}>
    {children}
  </Profiler>
);
```

Opt-in body capture (dev-only, warns, capped at 4096 chars):

```ts
installNetworkObserver(createInstrumentationConfig(true, true));
```

### MCP server

```powershell
pnpm mcp:check    # health check
pnpm mcp:start    # stdio server
```

Client config (Claude/OpenCode/Cursor...) — see all 66 tools in `docs/protocol.md`:

```json
{
  "mcpServers": {
    "rn-agent-observer": {
      "command": "node",
      "args": ["C:\\abs\\path\\packages\\mcp-server\\dist\\server.js"],
      "env": {
        "RN_OBSERVER_PROJECT_ROOT": "C:\\apps\\my-expo-app",
        "RN_OBSERVER_DEVICE_ID": "emulator-5554"
      }
    }
  }
}
```

## Evidence Sources

| Source                         | Command/tool                                       | Requires         | Reliability                                |
| ------------------------------ | -------------------------------------------------- | ---------------- | ------------------------------------------ |
| ADB dumpsys gfxinfo framestats | `performance` (ui_fps, frame_time, worst, dropped) | Nothing          | High — system measurements                 |
| ADB meminfo/top                | `performance` (memory_mb, cpu_percent)             | Nothing          | High (snapshots)                           |
| Instrumentation JS tasks       | `performance` (js_blocking_ms, confidence 0.99)    | Dev build        | High — measured in-app                     |
| Instrumentation fetch          | `network`                                          | Dev build        | High, redacted                             |
| Metro CDP Network              | `metro-network`                                    | Metro + RN 0.83+ | High — real per-request data               |
| Metro CDP Console/Heap         | `devtools-export`                                  | Metro            | High                                       |
| Metro CDP Profiler             | `devtools-profile`                                 | Metro + Hermes   | High                                       |
| UIAutomator tree               | `ui-tree`, `snapshot`                              | Nothing          | Medium — partial RN semantics              |
| Perfetto                       | `trace`                                            | Nothing          | High — deep analysis in Perfetto UI        |
| `/proc/net/dev` delta          | `device-network`                                   | Nothing          | Low per-app — device-level, reference only |
| ADB JS FPS                     | —                                                  | —                | **None** — always `available: false`       |

## Comparison With Similar Project Categories

| Perspective     | RN Agent Observer                                                      | E2E/device control such as Maestro, Detox, Appium  | React Native DevTools/profilers                | Cloud device farms                                |
| --------------- | ---------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| Primary role    | Agent-facing evidence and assurance                                    | Drive and assert application flows                 | Deep interactive component/JS/native debugging | Run a parallel device matrix                      |
| Strength        | Evidence schemas, availability, session graph, redaction, before/after | Mature runners and automation ecosystems           | Deep props, stack and profiling workflows      | OEM/API scale and managed devices                 |
| Gap             | Android-only built-in target, early adoption, not a full profiler      | Often needs a separate agent evidence/report layer | Not a combined CI assurance audit trail        | Cost, off-device data and less source correlation |
| Default privacy | Local-first, no account; project-owned artifacts                       | Depends on runner and infrastructure               | Local development                              | Requires provider and retention review            |
| Community state | Public since 2.4.1, currently one maintainer                           | Project-dependent and often more mature            | Maintained within the RN ecosystem             | Commercial or managed service                     |

**Positioning**: Observer complements runners, DevTools, and device farms with an
**evidence layer**; it does not claim to replace any category. Capability comparison
must be refreshed against exact versions instead of using time-sensitive star counts
or unsupported negative claims.

## Testing

```powershell
pnpm check                                    # lint --max-warnings=0 + format + build + test
pnpm --filter @rn-agent-observer/core test   # single package
pnpm --filter @rn-agent-observer/core test -- src/refs   # single file/pattern
pnpm mcp:check                                # MCP health check
```

- **Unit/integration**: the 2026-08-24 gate passed 363/363 tests, including a bounded parser fuzz regression; see `docs/testing.md` for package breakdown, coverage thresholds, and historical records
- **Test blueprint** (`docs/test-blueprint.md`): ~190 reference cases (21 domains, 4 tiers T0–T3) for testing the observer against any RN app and regression-testing the observer itself — golden AUT is `apps/demo-expo`
- **Runtime verification**: a physical Android 15/arm64 fixture and API 24/30/36 x86_64 AVDs completed the demo 2.4.0 workflow on 2026-08-24; these are four exact fixtures, not yet a broad OEM/device-farm matrix — see `docs/android-device-matrix.md`
- **Rule**: never claim Android runtime works without running on a real device/emulator

## Security & Limitations

### Safety defaults

- No network body capture by default; opt-in is dev-only with a warning + 4096-char cap
- Redacts tokens/api-keys/passwords/secrets/PII in URLs, body previews, and headers
- No secrets collection; screenshots/UI trees are on-demand; logcat is line-limited
- MCP responses never contain binary/base64 — artifact paths only
- **Apps outside this repo (e.g. Vshop): observe read-only** — no purchases, logins, setting changes, or any action beyond explicitly granted scope

### Current limitations (honest boundary)

- Android + Windows only; no iOS/Web
- CDP features need Metro running for the right app and **fail when React Native DevTools UI holds the connection** (one inspector connection per target)
- `metro-network` only sees fetch/XHR from the JS runtime (RN 0.83+); native requests are not in this source
- `device-network` reports whole-device byte counters — not attributable to a single app
- `record` is capped at 180s per clip by Android
- Ref snapshots are only valid against the latest snapshot (refs rotate after settle)
- Image comparison requires the same device + orientation (`DIMENSION_MISMATCH` otherwise)

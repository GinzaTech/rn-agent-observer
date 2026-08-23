# CLI và MCP protocol

## Môi trường chung

| Biến                       | Ý nghĩa                                                                         |
| -------------------------- | ------------------------------------------------------------------------------- |
| `RN_OBSERVER_PROJECT_ROOT` | App đích; mặc định là current working directory                                 |
| `RN_OBSERVER_DEVICE_ID`    | ADB serial; bắt buộc khi có nhiều device ready                                  |
| `RN_OBSERVER_APP_ID`       | Android package override; nếu bỏ trống đọc `expo.android.package` từ `app.json` |
| `RN_OBSERVER_SESSION_ID`   | Ghi event/artifact vào session đã tồn tại giữa các tiến trình CLI               |
| `RN_OBSERVER_ADB`          | Đường dẫn executable ADB tùy chọn                                               |
| `RN_OBSERVER_METRO_URL`    | Base URL Metro cho CDP features (mặc định `http://127.0.0.1:8081`)              |

## CLI

```text
doctor
init [--dry-run] [--force]
suite list
suite run NAME|SUITE.{json,yaml} [--reporter json,html,junit,sarif,github] [--output DIR] [--confirm-persistent-permission] [--strict]
run NAME|SUITE.{json,yaml} [...same options]
ci [--suite NAME[,NAME]] [--reporter json,html,junit,sarif,github] [--output DIR] [--confirm-persistent-permission] [--allow-not-verified]
security audit [--manifest PATH] [--network-config PATH] [--text PATH] [--no-artifacts] [--strict]
security sbom [--lockfile pnpm-lock.yaml]
security dependencies [--lockfile pnpm-lock.yaml] [--strict]
security active deep-link --scenario ID --base-uri URI --probe ID:MUTATION:PARAM --allow-state STATE [--max-errors N] [--timeout MS] [--settle MS] [--strict]
security active permission --scenario ID --permission NAME --probe ID:grant|revoke --allow-state STATE [--max-errors N] [--timeout MS] [--cleanup-timeout MS] [--settle MS] [--strict]
performance experiment --scenario ID (--replay SCRIPT.json | --idle | --startup) [--samples N] [--warmup N] [--interval MS] [--budget FILE] [--baseline FILE] [--write-baseline FILE] [--strict]
performance memory --scenario ID --replay SCRIPT.json [--cycles N] [--settle MS] [--max-growth-mb N] [--strict]
coverage analyze INPUT.json [--strict]
plugin check MANIFEST.json
target support [--manifest MANIFEST.json]
target collect --manifest MANIFEST.json --operation NAME --platform NAME [--device-id ID] [--app-id ID] [--grant PERMISSION] [--env NAME] [--cwd DIR] [--host-capability NAME] [--max-evidence N] [--max-payload-bytes N] [--strict]
dashboard build [--session ID]... [--limit N] [--output dashboard/name.html]
open [--session ID]... [--limit N] [--port N]
status
devices | device-info | launch | reload [--fast]
app-state | device-network [--window MS] | routes
metro-network [--duration MS] [--metro URL]
screenshot | ui-tree | snapshot [--interactive] | understand-screen [--stuck-after MS] | ui-model
tap (--test-id ID | --ref E1 [--settle MS] | --x X --y Y)
swipe --from X,Y --to X,Y [--duration MS]
type-text --text VALUE | back | deep-link --uri URI
permissions [list] | permissions grant --perm NAME --confirm-persistent-permission | permissions revoke --perm NAME --confirm-persistent-permission
assert (--test-id ID | --text VALUE) [--visible true|false]
a11y-audit | resilience readiness | app-data [--namespace NAME]
logs [--level LEVEL] [--keyword TEXT] [--limit N]
performance | render-stats
network [summary] | network requests
observe
trace start [--duration MS] | trace stop TRACE_ID
record start [--duration MS] | record stop RECORDING_ID
replay run SCRIPT.json
replay export SESSION_ID
artifacts cleanup [--days N] [--dry-run]
session start | session stop [SESSION_ID] | session list [--limit N] [--offset N]
session get SESSION_ID | session graph SESSION_ID
session share SESSION_ID [--output shares/name.rnobs] [--include-text] [--strict]
bundle verify BUNDLE.rnobs [--sha256 HEX]
diagnose [--ui-fps-low N --ui-fps-critical N --js-blocking N --js-blocking-high N --slow-request N --very-slow-request N --render-count N]
compare BEFORE.png AFTER.png [--before-ui TREE.json --after-ui TREE.json]
devtools-export [--duration MS] [--metro URL]
devtools-profile [--duration MS] [--metro URL]
```

CLI in JSON ra stdout. Workflow dài in JSON progress từng dòng ra stderr; stdout
vẫn dành cho kết quả cuối. SIGINT/SIGTERM được truyền thành `AbortSignal`.

| Exit  | Contract                                                                                             |
| ----- | ---------------------------------------------------------------------------------------------------- |
| `0`   | Command hoàn tất theo policy của command                                                             |
| `1`   | Assurance `FAIL`, hoặc `NOT_VERIFIED` khi command đang ở strict/default-CI policy                    |
| `2`   | Input, config hoặc runtime error; stderr chứa structured error                                       |
| `130` | Bị hủy; suite/performance giữ kết quả không hoàn tất là `NOT_VERIFIED` và CLI phát error `CANCELLED` |

`suite run` chỉ biến `NOT_VERIFIED` thành exit 1 khi có `--strict`.
`security audit`, `security dependencies`, active security, performance, coverage và
`session share` cũng theo quy tắc này khi có `--strict`. `ci` nghiêm hơn: mặc định
exit 1 cho cả `FAIL` và `NOT_VERIFIED`; chỉ `--allow-not-verified` mới cho phép trạng
thái sau đi qua. Flag này không đổi outcome trong report.

Outcome aggregate theo thứ tự `FAIL > NOT_VERIFIED > NA > PASS`. `PASS` nghĩa là
assertion/policy đã chạy với evidence; `NA` là không áp dụng; `NOT_VERIFIED` là thiếu
capability/evidence, không được authorize, bị hủy, audit chưa hoàn tất hoặc baseline
không tương thích. Không trạng thái nào trong hai trạng thái sau được viết lại thành
PASS.

## MCP stdio

66 tools hiện có:

| Nhóm                   | Tools                                                                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assurance/workflow     | `observer_doctor`, `list_quality_suites`, `run_quality_suite`, `inspect_current_screen`, `verify_fix`, `coverage_analyze`                                                                                                              |
| Security/supply chain  | `security_audit`, `security_sbom`, `security_dependency_audit`, `security_active_deep_link`, `security_active_permission_transition`                                                                                                   |
| Performance/dashboard  | `performance_experiment`, `performance_memory_growth`, `dashboard_snapshot`, `build_dashboard`                                                                                                                                         |
| Status/device/app      | `observer_status`, `device_list`, `device_info`, `app_launch`, `app_reload`, `app_state`, `get_device_network`, `list_permissions`, `set_permission`                                                                                   |
| Screen/action          | `screenshot`, `get_ui_tree`, `snapshot`, `understand_screen`, `runtime_ui_model`, `press`, `tap`, `swipe`, `type_text`, `back`, `open_deep_link`, `assert_element`                                                                     |
| Evidence/DevTools      | `get_logs`, `performance_snapshot`, `start_trace`, `stop_trace`, `get_react_render_stats`, `get_network_requests`, `get_network_summary`, `get_app_data`, `observe_screen`, `get_metro_network`, `devtools_export`, `devtools_profile` |
| Recording/replay       | `start_recording`, `stop_recording`, `replay_run`, `replay_export`                                                                                                                                                                     |
| Quality/source         | `a11y_audit`, `resilience_readiness`, `list_routes`                                                                                                                                                                                    |
| Session/graph/analysis | `list_sessions`, `get_evidence_graph`, `get_artifact_metadata`, `start_session`, `stop_session`, `get_session`, `export_session_share_bundle`, `verify_session_share_bundle`, `diagnose`, `compare_screens`                            |
| Maintenance            | `cleanup_artifacts`                                                                                                                                                                                                                    |

Ví dụ client config sau khi build:

```json
{
  "mcpServers": {
    "rn-agent-observer": {
      "command": "pnpm",
      "args": ["exec", "rn-observer-mcp"],
      "env": {
        "RN_OBSERVER_PROJECT_ROOT": "/absolute/path/to/expo-app",
        "RN_OBSERVER_DEVICE_ID": "emulator-5554"
      }
    }
  }
}
```

Trên Windows, dùng đường dẫn tuyệt đối theo cú pháp Windows trong JSON; trên POSIX,
dùng `/absolute/path`. `pnpm exec rn-observer-mcp` yêu cầu package MCP đã được cài
trong project mà client dùng làm working directory. Từ workspace source có thể dùng
`pnpm mcp:start` sau `pnpm build`.

## MCP resources và prompts

MCP expose ba resource cố định và ba resource template, tất cả ở JSON:

| URI                                  | Nội dung/privacy boundary                                               |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `rnobs://capabilities`               | Doctor readiness, capability đã policy-filter và security mode          |
| `rnobs://suites`                     | Danh mục built-in suite                                                 |
| `rnobs://dashboard`                  | Aggregate dashboard đã lược payload/path/binary                         |
| `rnobs://sessions/{sessionId}`       | Timeline và artifact manifest của session; session template hỗ trợ list |
| `rnobs://sessions/{sessionId}/graph` | Evidence graph không copy raw event payload; correlation ID được hash   |
| `rnobs://artifacts/{artifactId}`     | Chỉ metadata; không trả file bytes hoặc base64                          |

Session timeline có thể chứa dữ liệu nội bộ đã thu, vì vậy không xem
`rnobs://sessions/{sessionId}` là public-safe. Dùng dashboard resource cho aggregate
chia sẻ, graph cho quan hệ evidence tối giản và vẫn review artifact classification
trước khi chuyển ra ngoài máy.

Hai prompt workflow:

- `inspect-current-screen` yêu cầu chạy `observer_doctor` rồi
  `inspect_current_screen`, không đoán route hay visibility khi evidence thiếu.
- `verify-fix` yêu cầu chạy cùng suite/scenario trước và sau, coi
  `NOT_VERIFIED` là non-pass và liên kết report/evidence graph. Tool `verify_fix`
  có thể kèm cả cặp PNG và cả cặp UI tree để so sánh pixel + structure.

## MCP progress và cancellation

Client gửi `_meta.progressToken` sẽ nhận `notifications/progress` từ
`run_quality_suite`, `verify_fix`, `performance_experiment`,
`performance_memory_growth`, `security_dependency_audit`,
`security_active_deep_link` và `security_active_permission_transition`. Message report
phase/step hoặc số component/sample/cycle;
không phải evidence cuối.

MCP SDK request cancellation được truyền bằng `extra.signal` vào suite, verify,
performance experiment/memory growth, OSV audit và active security. Cancellation là
cooperative: suite chạy cleanup không bị gắn aborted signal, permission active
scenario chạy restore bằng cleanup context riêng, performance/audit trả
`NOT_VERIFIED` với limitation khi có thể, và plugin hook cũng phải quan sát signal.
Không diễn giải response thiếu sau cancellation thành PASS.

## High-level assurance tools

`observer_doctor` trả readiness và capability; nó không chạy app test.
`run_quality_suite` nhận built-in name hoặc JSON/YAML path và reporter
JSON/HTML/JUnit/SARIF/GitHub. `inspect_current_screen` gộp screen understanding và
compact runtime/source correlation. `verify_fix` lặp suite rồi tùy chọn compare
before/after.

`security_audit` là passive manifest/network-config/secret-pattern analysis.
`security_sbom` sinh CycloneDX 1.6 từ lockfile. `security_dependency_audit` mới gọi
OSV; query incomplete luôn là `NOT_VERIFIED`. Xem [security testing](security-testing.md).

`security_active_deep_link`/CLI `security active deep-link` chỉ dispatch 1–6 bounded
malformed query mutations tới Android app đúng app ID đã được user sở hữu/ủy quyền,
allowlist, policy `authorized-active` cho `app-state` và `target.deviceId` khớp exact
serial ADB đang chọn. URI login/account/credential/payment/purchase và network
interception bị từ chối. Caller phải khai báo probe, allowed screen state và log-error
limit; thiếu authorization hoặc baseline evidence là `NOT_VERIFIED`, không mở deep
link.

`security_active_permission_transition`/CLI `security active permission` chỉ đổi
1–4 state cho một Android runtime permission không mang account/credential semantics,
với policy `authorized-active` cho `device-state` và exact `target.deviceId`. Nó đọc
original state, chạy grant/revoke bounded, rồi luôn chạy cleanup timeout riêng để
restore state cũ kể cả khi abort/timeout/failure. Nếu Android kết thúc process sau
mutation, recovery chỉ relaunch sau khi exit-info của PID trước đó khớp đúng app và
transition permission; evidence thiếu/không khớp không được diễn giải thành recovery.
Sau recovery đã xác minh, observation đầu `blank`/`loading` chỉ được re-observe thêm
một lần có bound. Restore fail là `FAIL`; restore không xác minh được là
`NOT_VERIFIED`. Hai tool không thực hiện login, purchase, account mutation,
credential replay hoặc network interception.

`set_permission`/CLI `permissions grant|revoke` là thao tác persistent khác hẳn
active-security: policy cần risk `persistent-permission`,
`allowPersistentPermissionChanges: true`, exact permission trong
`allowedPersistentPermissions`, app/device allowlist thường lệ và confirmation cho
từng call (`--confirm-persistent-permission` ở CLI,
`confirm_persistent_permission_change: true` ở MCP). Core kiểm tra permission có
trong runtime-permission list trước khi đổi, rồi đọc lại để verify desired state; nó
không restore/relaunch. Custom suite cũng chỉ dispatch command
`permission-grant`/`permission-revoke` khi caller của `suite run`/`ci`, MCP
`run_quality_suite` hoặc `verify_fix` truyền confirmation tương ứng.

`coverage_analyze`/CLI `coverage analyze INPUT.json` nhận closed-schema gồm target
fingerprint, inventory route/action semantic, checkpoint/interaction explicit và
threshold tùy chọn. Raw payload, source path, screenshot/base64 và arbitrary metadata
bị reject. Route/action `null`, unknown hay unobservable không được infer; không có
threshold, inventory/evidence không đủ hoặc target/inventory không compatible khi
merge/delta là `NOT_VERIFIED`. `PASS` chỉ nghĩa là ratio evidence scoped đạt threshold,
không chứng minh mọi behavior/branch đã test.

Ví dụ input tối thiểu (semantic ID là do project đặt, không lấy từ visible text):

```json
{
  "target": {
    "platform": "android",
    "deviceId": "emulator-5554",
    "appId": "com.example.fixture"
  },
  "inventory": {
    "routes": [
      {
        "id": "home",
        "observable": true,
        "actions": [{ "id": "home.refresh", "observable": true }]
      }
    ]
  },
  "checkpoints": [
    {
      "routeId": "home",
      "interactions": [{ "routeId": "home", "actionId": "home.refresh" }]
    }
  ],
  "threshold": {
    "minimumCoverageRatio": 1,
    "minimumObservableItems": 2,
    "minimumEvidence": 2
  }
}
```

`performance_experiment` dùng 3–50 measurement samples, 0–10 warmup samples và
interval 0–60000ms. Mode `interaction` cần replay path; `interaction` và `startup`
cần authorized app-state. Startup force-stop rồi chỉ công nhận `am start -W` sample
khi Android báo `LaunchState=COLD`; metric không chứng minh RN
time-to-interactive/time-to-full-display. Mode `idle` read-only nhưng có limitation.
Baseline regression chỉ verified khi scenario và target fingerprint tương thích.

`performance_memory_growth`/CLI `performance memory` cần authorized app-state,
replay, 5–50 cycle, settle 0–60000ms và budget `max_growth_mb` hoặc
`config.budgets.memoryGrowthMaxMb`. Nó so median cửa sổ cuối/đầu và slope của
`memory_mb` process PSS. Đây là regression signal, không phải JS heap hoặc bằng chứng
leak; cancellation/incomplete sample set là `NOT_VERIFIED`.

`dashboard_snapshot` trả aggregate model; `build_dashboard` ghi file HTML mới bên
trong artifact root, không overwrite. CLI `dashboard build` tương ứng. CLI `open`
không có MCP tool: nó chạy local server numeric-loopback GET/HEAD tới khi signal bị
hủy.

CLI `session graph SESSION_ID` trả `{ graph, artifact }`, ghi artifact
`evidence-graph` và attach nó vào session. MCP `get_evidence_graph` và resource
`rnobs://sessions/{sessionId}/graph` trả graph trong memory, không tạo thêm artifact.
Graph giữ event/artifact ID và aggregate properties cần cho quan hệ, nhưng không copy
raw event payload hoặc binary; vẫn review classification trước khi share.

`export_session_share_bundle`/CLI `session share` yêu cầu
`artifacts.allowShare: true` (default false). Nó tạo bundle `.rnobs` mới không ghi đè
ở path relative contained dưới artifact root; default chỉ giữ metadata session/artifact,
size và SHA-256. Binary không bao giờ embed. `--include-text`/`include_text_artifacts`
chỉ cho phép text bounded, UTF-8 hợp lệ và secret-scan pass; excluded/unknown entry
làm bundle outcome `NOT_VERIFIED`, và `--strict` làm CLI exit 1. MCP
`verify_session_share_bundle` chỉ verify path relative artifact root; CLI `bundle
verify` dùng cho file local portable. Cả verifier đều kiểm SHA-256 (nếu cung cấp),
canonical encoding, policy và limits mà không extract hoặc trả embedded content.

`compare_screens` nhận `before`, `after` và cặp optional `before_ui_tree`/`after_ui_tree`. Cung cấp cả hai UI tree path để nhận `added`, `removed`, `changed` bên cạnh pixel similarity/region.

`devtools_export` nhận `duration_ms` (1000–60000, mặc định 5000) và `metro_url` tùy chọn. Kết quả gồm console entries, exceptions, heap usage và artifact JSON đầy đủ. `observe_screen` mặc định gồm `app_state` trong `include`.

`app_reload` nhận `mode` (`app` mặc định | `metro` — JS-only qua CDP, tự fallback về `app` khi Metro không khả dụng và ghi `fallbackReason`) và `metro_url` tùy chọn.

`get_metro_network` thu per-request network qua CDP Network domain trong `duration_ms` (1000–30000, mặc định 5000) — không cần app instrumentation; cần RN 0.83+.

`devtools_profile` ghi JS CPU profile trong `duration_ms` (1000–60000) thành artifact `.cpuprofile`.

`start_recording`/`stop_recording` quay màn hình mp4, tối đa 180000ms/clip.

`snapshot` trả ref cho phần tử visible (`interactive_only: true` chỉ còn phần tử tương tác). Trong session, registry identity giữ ref ổn định qua reorder/scroll và không tái sử dụng ref đã mất; state nằm trong thư mục session. `press` tap theo ref; cung cấp `settle_ms` để sau settle nhận diff `+/-/=`.

`understand_screen` hợp nhất screenshot, UIAutomator, app-state và error log gần đây thành state có cấu trúc: `content`, `loading`, `error`, `empty`, `blank`, `background` hoặc `not-running`. Response có route instrumentation (hoặc `null`), `headline`, `visibleText`, action refs, issue severity/evidence/suggestion, fingerprint và ba artifact path. Gọi lại cùng màn loading sau `stuck_after_ms` để nhận `loading-stuck`. Đây là heuristic evidence; agent phải mở `screenshotPath` và tái hiện trước khi sửa. Nội dung text-field được redact trước khi persist/return.

`runtime_ui_model`/CLI `ui-model` parse source JSX bằng TypeScript AST và correlate source location/testID với React instrumentation + native tree. `canPress: yes` chỉ được trả khi có action native visible/enabled; vẫn phải bấm rồi verify transition vì system overlay có thể intercept. `flattened-or-unobserved` giữ riêng, không bị gán nhầm thành hidden/unmounted. Interaction do Babel plugin ghi được ingest lúc gọi model hoặc `stop_session`; event `start` có testID được đưa vào replay.

`replay_run` nhận path script JSON `{ steps: [{ action: "tap"|"swipe"|"type-text"|"back"|"deep-link"|"reload"|"assert"|"wait"|"screenshot", ... }] }`; dừng ở step fail đầu trừ `continueOnError: true`.

`stop_session` tự capture runtime UI model rồi ghi replay JSON từ cả CLI action và app interaction đã instrument. Capture lỗi được lưu thành `runtime_ui_capture_failed` thay vì âm thầm bỏ; session vẫn stop an toàn. `replay_export` export lại một session theo yêu cầu; text nhập không được lưu để tránh lộ secret.

`diagnose`/MCP `diagnose` cho phép override 7 threshold. Finding trả `confidenceBasis`; confidence là heuristic score được gate bởi sample/source strength, không phải xác suất. Input threshold sai quan hệ trả `DIAGNOSIS_THRESHOLDS_INVALID`.

`cleanup_artifacts` mặc định 14 ngày, hỗ trợ dry-run, bỏ qua active session, và xóa metadata SQLite theo transaction cùng session directory.

Khi một command tạo timeline event mà không có session, core phát `EVIDENCE_NOT_RECORDED`. CLI ghi cảnh báo ra stderr; MCP host nhận warning từ stderr server.

`assert_element` cần `test_id` hoặc `text`, tùy chọn `visible`; trả `passed` + evidence. `get_app_data` đọc snapshot state mới nhất theo namespace từ instrumentation `reportAppData`. `list_routes` suy sitemap expo-router từ thư mục `app/`.

## Error contract

```json
{
  "error": {
    "code": "DEVICE_NOT_FOUND",
    "message": "No ready Android device is available",
    "recoverable": true,
    "suggestion": "Start an emulator or connect a device"
  }
}
```

MCP đặt `isError: true`; raw stack trace không đi qua response thông thường.

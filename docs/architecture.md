# Kiến trúc

```text
CLI adapter --------\
                     > ObserverCore -----------------> ADB / UIAutomator / Perfetto
MCP stdio adapter --/       |                         Metro CDP
                            |                         RN dev instrumentation
                            |
                            +-> doctor + policy/capability gate
                            +-> suite/security/performance workflows
                            +-> evidence graph + privacy-reduced dashboard
                            +-> ArtifactManager + SQLite SessionStore

Shared Zod schemas validate public evidence, finding, suite, and report contracts.
```

CLI và MCP là adapter mỏng. Readiness, authorization, collection, redaction,
outcome aggregation và report generation nằm trong core để hai adapter không tạo
ra hai định nghĩa chất lượng khác nhau.

Để tìm file/thư mục và quyết định đặt thay đổi ở đâu, xem
[cấu trúc repository](project-structure.md). Tài liệu này tập trung vào control,
data, assurance và security boundary khi hệ thống chạy.

## Trách nhiệm package

| Package                                 | Trách nhiệm                                                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@rn-agent-observer/schemas`            | Zod schemas và shared TypeScript types cho artifact/session, evidence, assurance, suite và performance                 |
| `@rn-agent-observer/core`               | Config/doctor, ADB/CDP/instrumentation providers, session, suite, security, performance, diagnosis, graph và dashboard |
| `@rn-agent-observer/cli`                | Parse command/flag, truyền signal cancellation, in JSON/progress và ánh xạ exit code                                   |
| `@rn-agent-observer/mcp-server`         | Đăng ký 66 tools, 6 resources, 2 prompts; chuyển structured input/output/progress/cancellation sang core               |
| `@rn-agent-observer/rn-instrumentation` | Dev-only telemetry + Babel transform cho route, fetch, render, UI lifecycle/interaction                                |
| `@rn-agent-observer/demo-expo`          | Fixture integration xác định để dogfood observer                                                                       |

Public subpath `@rn-agent-observer/core/plugins` chứa plugin contract/registry;
`@rn-agent-observer/core/dashboard` chứa API report/server; và
`@rn-agent-observer/core/targets` chứa contract cho provider target bên ngoài.
`@rn-agent-observer/core/coverage` chứa model coverage semantic; API share bundle
cũng được export ở core root. Xem [phát triển plugin](plugin-development.md) và
[CLI/MCP protocol](protocol.md).

## Control plane: config, doctor và authorization

1. Core đọc `.rn-observer.json`, sau đó áp dụng environment override cho project,
   device, app ID và Metro URL. `init --dry-run` chỉ preview config; `init` tạo file
   nếu chưa có; `--force` cho phép ghi đè có chủ ý.
2. `doctor` probe Node, project type, config/artifact containment, app ID, ADB,
   device, RN/Expo, instrumentation, Metro và security policy. `ready`, `degraded`
   hoặc `blocked` là readiness, không phải kết quả test app.
3. Config mặc định là `zero-instrumentation`, artifact `sensitive`,
   `allowShare: false` và security `read-only`. Action khác `read` cần đồng thời
   `security.mode=authorized-active`, app ID allowlist, risk allowlist và serial
   ADB đang chọn khớp exact `target.deviceId`; network interception cần opt-in riêng.
   Persistent permission change còn cần switch riêng, exact permission allowlist và
   confirmation từ caller.
4. Suite runner nhận capability đã probe và risk của từng step. Thiếu capability,
   thiếu authorization hoặc cancellation trở thành `NOT_VERIFIED`; không tự bỏ qua
   như `PASS`.

## Data plane và evidence lifecycle

1. Core chạy executable bằng argument array, timeout và buffer; không nội suy input
   vào shell command.
2. Parser chuẩn hóa device, logcat, UIAutomator XML, gfx framestats, meminfo, CPU và
   display refresh. Instrumentation phát structured development event cho những dữ
   kiện ADB không thể biết như route, React render và JS blocking.
3. Mỗi metric giữ `value`, `unit`, `source`, `timestamp` và availability. Tín hiệu
   không có thật (ví dụ JS FPS từ ADB) là unavailable thay vì số ước đoán.
4. SessionStore ghi timeline và artifact metadata vào SQLite WAL. Screenshot, UI
   tree, recording, trace, profile, replay, report và graph nằm trên đĩa dưới
   artifact root; MCP không trả binary/base64.
5. `session graph`/resource graph tạo node/edge deterministic từ event, artifact,
   route và correlation. Route parameter được giảm định danh, correlation ID được
   hash và raw event payload không được copy vào graph properties.
6. `session stop` cố capture runtime UI model, sinh replay và evidence graph. Capture
   lỗi được ghi thành event có limitation; session vẫn kết thúc có cấu trúc.
7. Share bundle `.rnobs` là JSON canonical, portable và deterministic cho một
   session. `ObserverCore.exportSessionShareBundle()`/CLI `session share` chỉ chạy
   khi project bật `artifacts.allowShare`; output mới phải contained dưới artifact
   root và writer không overwrite. Mặc định bundle chỉ mang metadata
   session/artifact, kích thước và SHA-256; không mang timeline,
   project/source/artifact path hay binary. Binary luôn bị cấm embed. Text chỉ có
   thể được opt-in sau khi nằm trong giới hạn, UTF-8 hợp lệ và secret scan hoàn tất;
   artifact thiếu/không an toàn/tràn giới hạn làm entry và bundle là
   `NOT_VERIFIED`, không âm thầm bị coi là đã chia sẻ đủ.
8. Verify bundle không extract file: nó từ chối symlink/input thay đổi, format không
   canonical, hash/limit/policy không khớp. Export không overwrite output có sẵn và
   chỉ đọc artifact regular file được containment dưới artifact root.

## Assurance plane

Built-in suite gồm `smoke`, `visual`, `performance`, `network`, `accessibility`,
`security` và `resilience`. Suite JSON/YAML dùng contract
`rn-observer/v1alpha1`, có requirement, capability/risk per step, timeout, retry,
assertion, cleanup và reporter. Reporter hiện có JSON, HTML, JUnit, SARIF và GitHub
Markdown.

Outcome aggregate theo độ ưu tiên `FAIL > NOT_VERIFIED > NA > PASS`:

| Outcome        | Ý nghĩa kiến trúc                                                                  |
| -------------- | ---------------------------------------------------------------------------------- |
| `PASS`         | Assertion/policy đã chạy và có evidence phù hợp                                    |
| `FAIL`         | Evidence đã chạy cho thấy assertion, budget hoặc policy không đạt                  |
| `NA`           | Không có kết quả áp dụng; không tương đương pass                                   |
| `NOT_VERIFIED` | Không đủ capability/evidence, bị hủy, không được phép hoặc comparison không hợp lệ |

Cleanup vẫn chạy sau cancellation mà không dùng aborted signal, nhờ đó custom suite
có thể phục hồi fixture. Suite-level limitation luôn làm outcome cuối
`NOT_VERIFIED`.

### Coverage route/action có evidence

Coverage không suy ra từ source file, visible text, tọa độ hay route `null`. Caller
khai báo inventory semantic gồm route/action và cờ `observable`, rồi cung cấp
checkpoint/interaction explicit có route/action ID và target fingerprint. Observation
route/action null, unknown hoặc `not-observable` chỉ được đếm là ignored, không được
gán đoán sang route khác.

CLI `coverage analyze INPUT.json` và MCP `coverage_analyze` nhận input closed-schema
giới hạn byte/count: không chấp nhận raw payload, source path, screenshot hay metadata
tùy ý. Core persist report redacted thành `coverage-report` artifact; raw checkpoint
không được ghi vào report.

Một item `covered` chỉ có nghĩa là có evidence target-scoped cho ID đã khai báo; nó
không chứng minh mọi state, branch, accessibility, security hay implementation path
đã được test. Muốn `PASS`, run phải có inventory route lẫn action không rỗng, một
threshold explicit, đủ item observable và đủ evidence. Thiếu một điều kiện là
`NOT_VERIFIED`. Merge/delta chỉ hợp lệ khi target fingerprint và inventory tương
thích; không trộn evidence từ device/runtime/build khác.

## Security, supply chain và performance

- Passive security audit chỉ đọc manifest, network-security XML và file text được
  chọn/artifact text. Mọi path phải ở trong project root kể cả sau khi resolve
  symlink; scan có giới hạn file/byte. Đây là MASVS-aligned evidence, không phải
  chứng nhận hay penetration test.
- SBOM là CycloneDX 1.6 sinh từ version đã khóa trong `pnpm-lock.yaml`.
  Dependency audit gọi OSV bằng HTTPS theo batch; response thiếu, timeout hoặc bị
  hủy là `NOT_VERIFIED`, không phải “không có lỗ hổng”.
- Performance experiment tách warmup và measurement, tổng hợp median/p95/mean/độ
  lệch và kiểm budget. Regression chỉ được tính khi scenario và target fingerprint
  tương thích; idle sampling không thay thế exact interaction profiling. Startup
  chỉ công nhận sample khi `am start -W` báo `LaunchState=COLD` và không tuyên bố
  time-to-interactive. Memory-growth lặp replay trước mỗi process-PSS sample; PSS
  không phải JS heap và sustained growth không tự chứng minh leak.
- Active security là hai scenario Android có ràng buộc: malformed deep-link query
  (`app-state`) và transition của một Android runtime permission (`device-state`).
  Trước mutation, executor bind chính xác configured app ID, ADB serial
  `target.deviceId`, action/risk, policy `authorized-active`, allowlist và khai báo
  target owned. Scenario chỉ có timeout, số probe, allowed screen state và error-log
  limit rõ ràng; authorization/baseline observation thiếu là `NOT_VERIFIED`, không
  dispatch probe.
- Scenario active không được login, purchase, mutation account, credential replay
  hoặc network interception. Permission transition ghi original state trước khi đổi
  và chạy cleanup riêng, bounded ngay cả sau abort/timeout/failure; restore fail là
  `FAIL`, restore không xác minh được là `NOT_VERIFIED`.
- Persistent permission grant/revoke là surface tách biệt với risk
  `persistent-permission`: Core yêu cầu config switch, exact runtime-permission
  allowlist, app/device binding và confirmation per call. Nó verify state trước/sau
  ADB nhưng cố ý không restore hoặc relaunch; custom suite phải nhận confirmation từ
  workflow caller thay vì từ file suite.

Chi tiết nằm trong [security testing](security-testing.md) và
[testing/runtime verification](testing.md).

## Dashboard và privacy boundary

Dashboard nhận session/evidence/finding/metric metadata nhưng chỉ xuất aggregate
count, allowlisted metric và digest. Nó loại raw ID, project/artifact/source path,
timeline/evidence payload, finding text, secret, binary và encoded binary. HTML
self-contained không có script/style/media/external fetch, dùng CSP `default-src
'none'` cùng sandbox, được secret-scan trước khi ghi, và không ghi đè file cũ.

Trend cần ít nhất hai session `complete` và cùng compatibility fingerprint cho
platform, device, app, OS/architecture và RN/Expo/Hermes/device class. App version,
build ID và source revision vẫn nằm trong exact digest nhưng được phép khác nhau để
trend có thể mô tả thay đổi giữa build. Nếu điều kiện không đủ, status là
`INSUFFICIENT_DATA`, `NOT_VERIFIED` hoặc `INCOMPATIBLE_FINGERPRINTS` thay vì trend
giả.

`open` chỉ bind `127.0.0.1` hoặc `::1`, chỉ nhận GET/HEAD cho `/`, `/index.html` và
`/healthz`, kiểm Host header, đặt security headers/no-store và đóng theo
`AbortSignal`. Nó là local read-only server, không phải dashboard multi-user.

## Plugin boundary

- Analyzer/reporter có thể chạy `trusted-in-process` sau manifest validation,
  capability check và explicit permission grant. Timeout/abort là cooperative và
  không thể dừng synchronous code, nên chỉ load code tin cậy.
- Provider/action phải khai báo `external-process`, `shell: false`, environment
  allowlist, request/shutdown timeout và message bound. `ExternalPluginHost` resolve
  cwd contained, chỉ forward environment caller cấp + allowlist, handshake identity
  và capability, parse line-delimited JSON-RPC có size/ID validation, bound/redact
  stderr và terminate process tree khi timeout/abort/protocol failure.
- Output analyzer/reporter được parse lại ở runtime boundary. Permission chỉ khai
  báo trong manifest không tự trở thành grant.
- Không có package auto-discovery, lifecycle plugin tổng quát hay MCP plugin tool.
  CLI chỉ có `plugin check`, `target support` và `target collect` với manifest được
  chỉ rõ; host tích hợp vẫn phải tạo registry/`ExternalPluginHost` và grant
  capability/permission rõ ràng.

## Provider strategy và mức xác minh

Android là provider built-in duy nhất, thực thi qua ADB. iOS, web và Windows không
có runtime provider built-in; chúng chỉ là extension-ready qua provider external và
không được diễn giải là platform support đã implement. CLI `target support` có thể
hiển thị matrix nhưng không chạy process provider; `target collect` chỉ chạy provider
được chỉ rõ sau handshake, explicit capability/permission grant và policy của host.

External target provider là plugin `provider` external-process, khai báo capability
`target.<platform>.<operation>` cho một trong các operation bounded: `device-list`,
`device-info`, `app-state`, `screenshot`, `ui-tree`, `logs`, `performance` hoặc
`device-network`. Request/response mang protocol/schema/request ID, selector target,
limit evidence/payload và evidence envelope versioned. Host kiểm provider identity,
target match, status/limitation và cấm inline binary/base64 trước khi dữ liệu được
nhận; provider được cài hay manifest hợp lệ vẫn chưa chứng minh device runtime.

CI chạy host logic trên Windows, Ubuntu và macOS. Một job riêng khởi tạo AVD API 30
x86_64 trên Ubuntu, build/install owned demo, nối Metro và chạy read-only
`app-state -> session -> understand-screen -> ui-model -> session stop`; job phải có
artifact local, UI source/native evidence và không có capture failure mới pass.
Điều này chỉ chứng minh exact CI fixture đó. API/OEM/ABI khác và macOS device runtime
không được suy rộng; bề mặt chưa chạy đúng fixture giữ `NOT_VERIFIED`.

## Runtime state

| State                              | Vị trí                                                   | Quy tắc                                                         |
| ---------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| Config                             | `<project-root>/.rn-observer.json`                       | Versioned, unknown key bị từ chối, artifact root phải contained |
| Session/timeline/artifact metadata | `<artifact-root>/observer.sqlite`                        | SQLite WAL, cleanup metadata theo transaction                   |
| Ref registry trong session         | `<artifact-root>/sessions/<id>/state/last-snapshot.json` | Identity giữ ref qua reorder/scroll; ref mất không tái sử dụng  |
| Ref state standalone               | `<artifact-root>/snapshots/last.json`                    | Chỉ dùng khi không có session                                   |
| CDP lock                           | `<artifact-root>/cdp-locks/inspector.lock`               | Atomic `wx`, owner UUID, queue timeout                          |
| Performance freshness              | `<artifact-root>/performance-state/<app-id>.json`        | Không báo lại cửa sổ gfxinfo cũ như measurement mới             |
| Active trace/recording             | `<artifact-root>/active-traces`, `active-recordings`     | Start/stop qua process khác; artifact attach về session gốc     |
| Reports                            | `<artifact-root>/reports`, `dashboard`                   | Bounded/contained output; dashboard không ghi đè                |

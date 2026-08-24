# Báo cáo kiểm thử và runtime verification

Ngày xác minh host gần nhất: **2026-08-24**
Host của runtime verification hiện tại: Windows, Node.js 22.19, pnpm 9.6.0
Thiết bị của bằng chứng active-security mới: Android AVD do nhóm sở hữu, chạy
development fixture `SecurityLab` của demo.
Thiết bị của bằng chứng runtime mới: Xiaomi `23013PC75G`/`mondrian`, physical
Android 15 API 35, arm64, development fixture. Serial và local session IDs được
lược khỏi tài liệu public. Ma trận emulator mới chạy cùng demo trên API 24, 30 và
36 x86_64; mỗi AVD/session là tạm thời và đã cleanup. Các kết quả chỉ xác minh
scenario ghi riêng bên dưới, không suy rộng thành production benchmark hay mọi OEM.

## Contract trạng thái

| Trạng thái     | Điều kiện                                                                 |
| -------------- | ------------------------------------------------------------------------- |
| `PASS`         | Check/scenario đã chạy trọn với evidence đúng nguồn và đạt policy         |
| `FAIL`         | Check/scenario đã chạy và evidence cho thấy policy không đạt              |
| `NA`           | Không áp dụng; không được chuyển thành PASS                               |
| `NOT_VERIFIED` | Thiếu capability/evidence, bị hủy, audit bất toàn hoặc fixture không chạy |

Unit test/build/CI host có thể PASS trong khi Android runtime vẫn
`NOT_VERIFIED`. Ngược lại, artifact device lịch sử không tự xác minh code mới. Mọi
claim bên dưới ghi rõ lớp evidence: host test, export/build hay device runtime.

## Quality gate repository

Các lệnh chuẩn:

```powershell
pnpm check
pnpm release:check
pnpm android:export:check
```

CI chạy `pnpm check` trên Windows, Ubuntu và macOS để phát hiện lỗi install, lint,
format, TypeScript build và unit test theo host. Package-smoke pack/inspect năm package
public trên Ubuntu; MCP initialization và Expo Android export tiếp tục chạy trên
Windows. Job `Android API 30 runtime smoke` dùng Ubuntu/KVM + Google APIs x86_64,
build/install owned demo, nối Metro, rồi chạy read-only `app-state`,
`understand-screen`, `ui-model` và session stop. Nó fail nếu app không foreground,
không có interactive content/source-native model, thiếu evidence artifact hoặc có
runtime capture failure. Đây chỉ là evidence cho exact API 30 CI fixture, không mở
rộng thành mọi host/OEM/API hay thay thế ma trận local/physical.

`pnpm check` kiểm repo implementation. `rn-observe ci` là application assurance
workflow: nó chạy suite được cấu hình trên target và mặc định exit 1 cho cả `FAIL`
lẫn `NOT_VERIFIED`. Hai lệnh không thay thế nhau.

## Host verification hiện tại — 2026-08-24

Đã chạy trên workspace này:

- `pnpm check`: PASS — ESLint, Prettier, TypeScript build và Vitest; schemas
  19 tests, instrumentation 17, demo Expo 10, core 294, CLI 15, MCP 6 (tổng
  **361 tests**);
- `pnpm mcp:check`: PASS; server MCP khởi tạo được;
- `pnpm rn-observe --version`: `2.4.0`;
- `pnpm pack:check`: PASS cho 5 package public;
- Expo Android/Hermes export: PASS, 581 modules, 2 files và đúng một Hermes bundle;
  output local ở temporary directory;
- `pnpm install --frozen-lockfile`: PASS với checksum `.pnpmfile.cjs`;
- OSV strict: PASS, 673/673 locked component queried và 0 advisory.

Lượt này còn khóa exact inventory 66 MCP tools, policy action fail-closed ở
Core/CLI, redaction deep-link xuyên response/session/replay và SecurityLab
build-time opt-in. CI và local gate chạy Expo prebuild ở cả default lẫn opt-in rồi
inspect Android manifest: default không có custom scheme, `VIEW` intent filter hay
CAMERA permission; opt-in có đúng một CAMERA permission và filter bị giới hạn ở
`rnobs-security-demo://security/lab`. Đây vẫn chỉ là host/native-build evidence,
không thay thế một scenario Android runtime.

`external-host.test.ts` đã được chạy lặp 5 lần trên Windows và full core suite
cũng PASS sau khi cleanup process tree được sửa. Đây vẫn chỉ là host evidence:
target provider ngoài, performance scenario và quality suite mới vẫn chưa có Android
device run mới trong record này. Active-security có evidence AVD hẹp ở mục kế tiếp;
nó không nâng trạng thái runtime của các surface khác.

## Physical Android acceptance — 2026-08-24

Demo development build 2.4.0 đã chạy end-to-end trên physical Xiaomi
`23013PC75G`/`mondrian`, Android 15 API 35. Exact serial được pin trong local config
và mọi ADB call, nhưng không được commit. Session complete có 268 event, 67 artifact
bao gồm summary/evidence graph/replay và 24 runtime telemetry capture; không có
`runtime_telemetry_capture_failed` hoặc `runtime_ui_capture_failed`.

Evidence của đúng run này:

- PerformanceLab phát long JS task `100.0005ms`; `performance` đọc lại được sau
  logcat rollover và `diagnose` tạo finding high có source/confidence basis;
- NetworkLab trả HTTP 200 khoảng 15.05ms và fixture 503 khoảng 102.30ms; query token
  bị redact, không có body preview persisted và percentile ghi low-confidence vì chỉ
  có hai sample;
- RenderLab thu 46 profiler commit và app-data chỉ giữ key allowlist;
- khi Android Settings ở foreground, `ui-model` trả `target-not-foreground`, không
  ghép UI app khác; launch lại app phục hồi đúng target;
- compare sửa contrast chỉ đổi 1,369/2,473,200 pixel trong vùng status text,
  similarity `0.999446`; UI tree giữ 36 node và không đổi semantic structure;
- runtime cache giữ telemetry đã parse/redact qua logcat rollover và xóa toàn bộ
  process-owned evidence khi PID đổi.

Đây là development-build pipeline evidence trên một OEM/API với sample nhỏ, không
phải performance benchmark production, pentest hoặc compatibility wildcard. Raw
`.artifacts`, device serial và session ID vẫn local.

## Android emulator API-tier acceptance — 2026-08-24

Ba AVD tạm do nhóm sở hữu đã chạy cùng debug APK 2.4.0 và cùng kịch bản
PerformanceLab + NetworkLab trên Windows/WHPX, Android Emulator 36.5.10 và ADB
37.0.0. Mỗi target được pin exact `emulator-5554` trong thời gian run, nhưng serial
chỉ được tái sử dụng sau khi AVD trước đã disconnect; mỗi AVD dùng session ID riêng.

| Evidence                        | API 24 / Android 7                                  | API 30 / Android 11                                 | API 36 / Android 16                                 |
| ------------------------------- | --------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| System image / ABI              | Google APIs / x86_64                                | Google APIs / x86_64                                | Google APIs Play Store / x86_64                     |
| Resolution                      | 480×800                                             | 480×800                                             | 1080×2400                                           |
| App install/foreground          | `PASS`                                              | `PASS`                                              | `PASS`                                              |
| Home + NetworkLab understanding | `content`, route đúng                               | `content`, route đúng                               | `content`, route đúng                               |
| Final UI model                  | available, 7 visible/pressable, 0 interaction error | available, 7 visible/pressable, 0 interaction error | available, 7 visible/pressable, 0 interaction error |
| 100ms fixture                   | `100.0103ms`                                        | `100.0002ms`                                        | `100.0003ms`                                        |
| Network fixture                 | 2 request / 1 failure, token redacted               | 2 / 1, token redacted                               | 2 / 1, token redacted                               |
| Session stop                    | `complete`, replay 21 bước                          | `complete`, replay 21 bước                          | `complete`, replay 21 bước                          |

Các availability khác nhau được giữ nguyên: API 24 không có process CPU và gfx
frame rows; API 30 không có gfx frame rows; API 36 có 39 frame sample trong lần đo
fixture. Không giá trị unavailable nào bị đổi thành 0. Network percentile cả ba
tier đều low-confidence vì chỉ có hai sample.

Cold launch có ReactHost window-focus soft-error trên cả ba tier; API 24 còn có
WebView variation-seed file-missing và API 36 có loading `BadToken`/deprecated
pinning message. App vẫn foreground/Home `content`, còn checkpoint NetworkLab cuối
có `runtimeErrors: 0`. Source 2.4.0 hiện phân loại ReactHost non-fatal soft-exception
thành `runtime-platform-warning` info và loại khỏi app `runtimeErrors`/diagnosis,
nhưng vẫn giữ message làm evidence; fatal ReactHost và lỗi độc lập như `BadToken`
không bị hạ cấp. Trên API 24/30, SecurityLab chỉ lộ 31 px ở cuối viewport 480×800;
source mới trả `partially-observed-touch-target`/`NOT_VERIFIED` thay vì kết luận
intrinsic target nhỏ. Artifact run cũ vẫn giữ nguyên kết quả lịch sử trước fix.

Sau run, exact AVD API 24/30/36 đã bị xóa; hai system image API 24/30 cài cho run
đã uninstall; data root tạm trên ổ D và active config cục bộ đã xóa; Metro đã dừng.
Inventory cuối không có device ADB và chỉ còn AVD `Medium_Phone_API_36.1` có sẵn
trước run. Xem [ma trận và lệnh tái lập](android-device-matrix.md).

Đây là API-tier conformance đầu tiên, không phải device-farm matrix: vẫn chỉ có một
host/emulator engine, ABI x86_64 và chưa có ít nhất hai OEM cho mỗi tier.

## Active-security runtime — owned demo AVD (2026-08-23)

Android AVD do nhóm sở hữu đã chạy development build `SecurityLab` của demo theo
policy allowlist/authorized-active và ghi local session artifact. Kết quả hẹp của
đúng fixture/probe này:

- `security active deep-link` với mutation duplicate-query: `PASS`. UI fixture giữ
  `content`, hiện `REJECTED` cùng `unexpected-query`, và không hiện URI/query thô.
- `security active permission` cho `android.permission.CAMERA`: `PASS` cho cả grant
  lẫn revoke; cleanup đã restore permission ban đầu.
- Revoke camera làm process kết thúc với lý do Android `PERMISSION CHANGE`. Tool chỉ
  relaunch sau khi PID trước đó và exit-info cùng khớp transition này; report của
  probe revoke ghi `recoveryObservationAttempts: 2` trước khi quan sát lại `content`.

Evidence nằm trong local session `security-reports`; không commit machine path hay
session ID vào tài liệu public. Đây là run trên demo/AVD do nhóm sở hữu, không phải
evidence cho app ngoài, permission/deep-link khác, mọi Android environment, dynamic
pentest rộng hay security certification.

## Kết quả selection lịch sử trước khi sửa cleanup host (2026-08-22)

Các command đã chạy trong workspace ngày 2026-08-22:

```sh
pnpm --filter @rn-agent-observer/schemas test -- assurance suite evidence-graph performance-assurance
pnpm --filter @rn-agent-observer/core test -- config doctor suite security performance dashboard evidence plugins
pnpm --filter @rn-agent-observer/core test -- src/plugins/external-host.test.ts
pnpm --filter @rn-agent-observer/cli test
pnpm --filter @rn-agent-observer/mcp-server test
```

Kết quả quan sát được:

- schemas: 4 file/10 test PASS;
- CLI: 1 file/10 test PASS;
- MCP: 1 file/1 test PASS cho handshake, representative tools, 6 resource
  URI/template và 2 prompts; source inventory tại thời điểm kiểm có 61 tools;
- external-host test chạy riêng: 1 file/8 test PASS;
- core selection: 24 file/118 test PASS, 1 test FAIL. Case process-tree timeout
  trong `external-host.test.ts` tạo orphan marker dưới tải toàn selection dù cùng
  file chạy riêng pass. Đây là record **trước** bản sửa cleanup process tree; xem
  “Host verification hiện tại” ở trên cho full core suite/repeated run hiện đã PASS.

Các core test đã pass trong selection bao phủ config/doctor, suite loader/runner/
reporter/workflow, passive security + secret scan + CycloneDX/OSV, repeated
performance/startup/memory analysis, dashboard containment/CSP/privacy/server,
evidence graph và trusted in-process plugin. Đây là host evidence, không phải device
runtime evidence.

| Bề mặt mới                                  | Host evidence                                           | Android/device evidence hiện tại                           |
| ------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| doctor/init/config + suite/reporters        | Targeted tests pass                                     | `NOT_VERIFIED` cho suite chưa chạy                         |
| passive security/SBOM/OSV contract          | Targeted tests pass                                     | Static result; không phải runtime pentest                  |
| repeated idle/interaction/startup/memory    | Parser/analyzer/orchestration tests pass                | `NOT_VERIFIED`                                             |
| dashboard offline/loopback + evidence graph | Targeted tests pass                                     | Không cần device cho render; session trend thực chưa rerun |
| trusted in-process plugin                   | Targeted tests pass                                     | Theo từng plugin/fixture                                   |
| external process plugin host                | Repeated Windows timeout cleanup + full core suite PASS | `NOT_VERIFIED`                                             |

Không tuyên bố startup/memory budget, quality suite, security runtime, dashboard
trend hay external community plugin chạy Android chỉ từ các kết quả host trên.

## Bề mặt mới và trạng thái device evidence

Các surface dưới đây có thể có unit/host contract test, nhưng chỉ đúng run có
authorization phù hợp, target fixture đúng và session/artifact review được mới đổi
status device.

| Bề mặt                                                     | Điều host-level có thể kiểm                                                                                   | Device/runtime evidence công bố                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Active security: malformed deep link/permission transition | Bound input, policy binding, outcome/cleanup, Core/CLI fail-closed guard và SecurityLab build config contract | `PASS` hẹp cho duplicate-query deep link và CAMERA grant/revoke+cleanup trên owned demo AVD; mọi target/probe khác vẫn `NOT_VERIFIED` |
| Portable `.rnobs` share bundle                             | Canonical format, hash/limit, metadata-only policy và verifier không extract                                  | Không phải thay thế session/device evidence; bundle có entry omitted/excluded là `NOT_VERIFIED`                                       |
| Route/action coverage                                      | Inventory semantic, threshold, target compatibility, merge/delta và redacted digest                           | `NOT_VERIFIED` cho target nếu checkpoint/interaction chưa được thu đúng fixture; coverage không suy từ source/text/coordinates        |
| External target provider                                   | Manifest/handshake/response validation và process isolation                                                   | Android external provider theo từng fixture; iOS/web/Windows built-in runtime đều **chưa implement** và `NOT_VERIFIED`                |

`PASS` của `.rnobs` chỉ xác nhận serialization/verification policy cho bundle đó; nó
không chứng minh artifact gốc đúng, an toàn để public hay đầy đủ toàn bộ session.
`PASS` coverage chỉ xác nhận ratio của semantic IDs đã khai báo với evidence target
scoped; nó không chứng minh mọi branch/behavior đã test. Một provider report
`AVAILABLE` cũng không tự chứng minh provider runtime đã chạy đúng target ngoài
evidence envelope của lần collect đó.

## Baseline lịch sử trước assurance surface

Kết quả release 2.4.0 lịch sử: lint, Prettier, TypeScript build, MCP initialization,
CLI version và **61 unit tests** pass. Phạm vi gồm schema validation, ADB/UI/log/
frame/memory/CPU parsers, allowlist redaction, heuristic diagnosis + threshold
validation, CDP queue, performance freshness, SQLite session/artifact/cleanup,
stable refs, auto replay, pixel/UI-tree comparison, CLI và MCP.

Kết quả Unreleased screen-understanding: `pnpm check` pass lint, Prettier, TypeScript build và **68 tests**; `pnpm mcp:check` và Expo Android export pass. Bảy test mới bao phủ schema/result có route nullable, content/action refs, error/blank/loading-stuck, pixel statistics và redaction UI-tree/snapshot.

## Source-correlated runtime UI model (Unreleased)

- Focused tests pass cho TypeScript AST source scanner, generated/explicit testID Babel transform, instrumentation privacy, source/native/telemetry correlation, view-flattening state và physical-interaction replay export.
- Static scan Vshop: 115 actionable source element, 22 conditional, chỉ 1 explicit testID. Scanner trả được file/line thật; phần lớn source/runtime ownership sẽ ở trạng thái chưa correlate cho tới khi app bật Babel plugin hoặc thêm testID.
- Physical demo acceptance 2026-08-24 đã đóng positive path hiện tại: model correlate route/source/native interaction, giữ evidence qua logcat rollover, không có capture failure và auto-capture khi stop thành công. Kết quả chỉ áp dụng exact demo fixture/device ở mục trên.
- Full gate hiện tại là 361/361 tests + MCP/package/Android export; các con số 77 test bên dưới chỉ còn là record lịch sử của milestone UI-model đầu tiên.

## Demo Expo native dogfood

Development build `dev.rnagentobserver.demo` đã build Gradle, cài và mở thành công trên thiết bị thật. Observer của chính repo đã thực thi:

- `device_list`/`device_info`: đúng model, Android version, resolution, density và orientation.
- `screenshot` + `get_ui_tree`: PNG 1080×2400, semantic `testID` và JSON UI-tree artifacts.
- `tap`: điều hướng toàn bộ bằng semantic ID, không cần người dùng bấm app.
- PerformanceLab: đo `js_blocking_ms = 100.0007ms` từ instrumentation, CPU process available, native frame metrics và diagnosis `Long JS task observed`.
- React profiler: nhận component name, render/commit count và duration; diagnosis gom evidence theo component thay vì lặp mọi event.
- NetworkLab deterministic: ghi request khoảng 13ms, 507ms, 2008ms và 102ms/HTTP 503; `access_token` trong URL thành `[REDACTED]`; summary có p50/p95/p99, failures và bytes.
- VisualLab: 576.593 pixel thay đổi, similarity `0.77755`, region thay đổi và UI structure `added REGRESSED`, `removed BASELINE`, `changed visual-fixture`.
- Session: timeline persisted qua nhiều CLI process; screenshot/UI-tree metadata nằm trong SQLite, binary ở file; stop tạo summary artifact.
- Perfetto: start/stop qua hai CLI process, pull trace thật khoảng 1.06MB.

Definition-of-done workflow cũng được chạy trọn vòng: cùng `trigger-js-block` đo baseline `100.0007ms`; source fixture được sửa tạm xuống 5ms, Metro fast reload, tái hiện lại đo `5.0042ms` và finding long-task biến mất. Sau bằng chứng before/after, fixture 100ms được khôi phục để repo tiếp tục có regression test xác định.

## Vshop fixture

Vshop được dùng theo hướng read-only/an toàn. Không gọi purchase, queue, lock-agent, party, loadout hoặc endpoint đổi tài khoản.

Quality gate fixture:

```powershell
pnpm run check
pnpm exec expo export --platform android --output-dir <temporary-directory>
```

Kết quả lịch sử của fixture: TypeScript và ESLint pass; Jest 9 suites/83 tests pass; Android Expo export 2.667 modules hoàn tất.

Dogfood 2.4.0 bằng CLI của repo trên package `com.android.vshop`, Metro `--no-dev --minify`:

- device/app discovery, launch, screenshot 1080×2400 và UIAutomator tree chạy thật;
- unified `observe` trả screen/UI/performance/log summary;
- lệnh không có session phát `EVIDENCE_NOT_RECORDED` thay vì âm thầm bỏ event;
- 16/16 element chung giữ nguyên ref qua hai snapshot có scroll/reorder;
- hai `devtools-export --duration 2000` chạy đồng thời được queue và cùng pass trong 4.98s;
- session lịch sử có 51 event/9 artifact; recording 1,286,509 bytes và Perfetto trace attach đúng SQLite session;
- `session stop` sinh replay 30 bước; `replay run` đạt 30/30, không thao tác purchase/login/account;
- diagnosis nhận custom thresholds và trả `confidenceBasis`; ví dụ 51.0 UI FPS/113 frame với threshold 55 cho confidence heuristic 0.32;
- ba lần đọc gfxinfo từng trả đúng cùng cửa sổ 113 frame. Bản fix freshness đã được verify: lần đầu available, lần kế tiếp cùng signature trả `available: false` + reason `No new gfx frame samples...`;
- PNG compare cho cùng ảnh đạt similarity 1;
- RN 0.86 bridgeless từ chối `Profiler.enable`; observer trả đúng `DEVTOOLS_PROFILE_FAILED` recoverable thay vì `INTERNAL_ERROR`.

## Screen-understanding dogfood (Unreleased)

Trên cùng thiết bị thật/Vshop, CLI mới được chạy trong một session local:

- màn Profile ổn định: `state: content`, headline `Vshop`, 144 visible elements, 16 actions, 0 unlabeled và 6 small-touch-target findings;
- cold dev-client: lần đầu `state: loading`, headline `Connecting to the development server...`; gọi lại cùng fingerprint sau ngưỡng trả `loading-stuck` và giữ nguyên `stateSince`;
- sau khi bundle/data hoàn tất: state trở lại `content`, headline `Vshop`, fingerprint đổi;
- mỗi response liên kết screenshot, UI tree đã redact và artifact `ui-understanding` JSON; không trả image bytes;
- unit tests xác nhận visible-error, blank screen, loading-stuck, pixel statistics và text-field/PII redaction. Giá trị text-field không xuất hiện trong UI-tree/snapshot output.
- build cuối được gọi lại trên Vshop trong session local khác: `content`, route `null` trung thực, headline `Vshop`, 156 visible elements, 19 actions, 0 runtime error và 9 small-touch targets. Screenshot được agent mở để kiểm tra trực quan; lớp nổi ở góc phải chưa được quy kết là lỗi app vì không có ownership trong UI tree.

Artifact chính (local, không publish path máy thật):
`<external-app-root>/.artifacts/sessions/<session-id>/summaries/summary.json`.

Final-contract artifact:
`<external-app-root>/.artifacts/sessions/<session-id>/summaries/summary.json`.

## Boundary còn lại

- `devtools-export` tự động có console/heap, nhưng RN 0.86 bridgeless không expose CDP Network/Profiler domains trên runtime đã thử. Không suy rộng giới hạn này sang mọi RN version.
- JS FPS tiếp tục explicit unavailable; Perfetto là artifact thô, chưa tự phân tích thành app-specific CPU flame chart.
- Vshop không được sửa source để thêm instrumentation, nên network/route/render event ở Vshop có thể rỗng. Đây là expected behavior, không phải dữ liệu 0 giả.
- UIAutomator vẫn có latency và không có off-screen FlatList. Runtime UI model đã có source location/handler ownership nhưng chưa export toàn bộ React props/component stack như DevTools. CI Android hiện chỉ cover Ubuntu/API 30 owned-demo smoke; macOS device runtime và broad Linux/OEM matrix vẫn `NOT_VERIFIED`. Contrast/focus-order audit, CDP protocol negotiation và loại native `better-sqlite3` vẫn là backlog.
- Cold-start metric chỉ là Android `am start -W` khi `LaunchState=COLD`, không phải React Native time-to-interactive/full-display. Memory growth chỉ là process PSS signal, không chứng minh JS/native leak nếu chưa heap-profile.
- Passive security/MASVS mapping không thay thế dynamic pentest. OSV match cần triage reachability/exploitability; OSV query bất toàn là `NOT_VERIFIED`.
- Dashboard aggregate loại payload/path/secret/binary; session resource/report khác vẫn có thể chứa internal path/timeline và phải được review trước khi share.
- Active-security hiện chỉ có Android malformed deep-link query và bounded runtime
  permission transition cho owned, allowlisted development fixture. Run AVD ở trên
  chỉ cover duplicate-query và CAMERA grant/revoke+cleanup của demo; tuyệt đối không
  suy diễn unit test, policy grant, `PASS` host hoặc evidence hẹp này thành
  dynamic-pentest/device verification cho target khác.
- `.rnobs` portable bundle metadata-first không mang binary/timeline mặc định; text
  opt-in bị giới hạn và secret-scan. Verify bundle kiểm format/hash/policy, không
  extract và không xác nhận artifact gốc là an toàn hoặc đầy đủ.
- Route/action coverage chỉ nhận ID semantic explicit; route/action null, unknown
  hoặc unobservable bị bỏ qua. Không suy coverage từ source, text hoặc tọa độ, và
  không merge/delta evidence khác target fingerprint.
- iOS/web/Windows chỉ có external target-provider contract, chưa có built-in runtime
  provider. Android built-in vẫn phải có ADB target sẵn sàng; external provider chỉ
  được coi available sau handshake/evidence validation của chính run đó.
- External plugin host process-tree cleanup đã pass repeated Windows host test và full core suite; điều này không thay thế runtime evidence cho một external provider/target cụ thể.
- Chỉ các case có artifact cụ thể ở trên được coi runtime verified; case blueprint chưa chạy đúng fixture vẫn là `NOT_VERIFIED`.

# Changelog

## Unreleased — screen understanding cho Codex/agent

### Community và public distribution

- Năm package `schemas`, `core`, `rn-instrumentation`, `cli` và `mcp-server` đã bỏ
  `private`, thêm metadata npm public/provenance, README riêng và dependency nội bộ
  vẫn giữ `workspace:*` khi phát triển. Root và demo Expo tiếp tục private.
- MCP package thêm executable `rn-observer-mcp`; hướng dẫn release chuyển từ bundle
  bàn giao cố định 2.0.0 sang npm/version-neutral và phân biệt rõ static CI với
  Android runtime verification trên device.
- Thêm `pnpm pack:check` để pack/inspect cả năm tarball, CI quality gate
  Windows/Linux/macOS, workflow publish npm được bảo vệ và Android export ghi rõ
  không phải device runtime.
- Thêm CONTRIBUTING, SECURITY, GOVERNANCE, Code of Conduct, issue/RFC/PR templates và
  Dependabot cho dependency/action updates.

### Security hardening và bounded active testing

- Instrumentation và SecurityLab đều development-only; SecurityLab cần flag build
  explicit. CI prebuild/inspect cả manifest release-default lẫn opt-in: default không
  có CAMERA/deep link, opt-in chỉ có filter
  `rnobs-security-demo://security/lab` hẹp.
- Deep-link evidence/replay/report redact credential, query và fragment; active
  permission recovery chỉ relaunch sau khi PID + Android exit-info xác nhận đúng
  `PERMISSION CHANGE`, rồi quan sát lại bounded.
- Active action giờ pin exact `target.deviceId`: serial ADB từ env/option khác config
  bị từ chối trước khi mutation dispatch. Read-only evidence không bị ảnh hưởng.
- MCP path input chỉ đọc regular file nằm vật lý trong project; baseline output chỉ
  tạo file mới dưới artifact root, không overwrite. Artifact root/session writer và
  cleanup chặn traversal, symlink/junction escape; cleanup mặc định tôn trọng
  `artifacts.retentionDays`.
- Demo AVD owned đã chạy bounded duplicate-query deep link và CAMERA grant/revoke +
  cleanup; evidence này chỉ áp dụng fixture/probe đó, không phải pentest hay chứng
  nhận security cho target khác.

### Source-correlated runtime UI model

- Thêm CLI `ui-model` và MCP `runtime_ui_model` (tool 45). Core parse `.tsx/.jsx` bằng TypeScript AST để lấy actionable component, explicit/generated testID, conditional/disabled state và `file:line:column`.
- Model correlate source với telemetry React và UIAutomator: mỗi node phân biệt `rendered`, `visible`, `offscreen`, `hidden`, `unmounted`, `flattened-or-unobserved`, `enabled` và `canPress` kèm reason. Trạng thái thiếu evidence trả `unknown`, không đoán.
- Thêm Babel plugin development-only tự inject `rnobs-<source-hash>` khi thiếu testID và wrap `onPress` bằng `observeInteraction`. Event chỉ ghi identity, `start/success/error`, duration và lỗi đã sanitize; không ghi handler arguments/return value/props/input.
- `session stop` tự capture model cuối, ingest physical/user app interactions vào SQLite rồi đưa event `start` có testID vào replay. Capture lỗi được ghi `runtime_ui_capture_failed`, session vẫn stop an toàn.
- Core `stopSession()` nay trả `Promise<Session>` vì phải thu runtime evidence trước khi finalize; CLI/MCP adapter đã await. Đây là thay đổi contract cần lưu ý cho consumer gọi core trực tiếp.
- `reportUiElement` cho app báo mounted/visible/enabled mà không ép `collapsable={false}`; giữ nguyên tối ưu view flattening của React Native.

### Verification runtime UI model

- `pnpm check` pass lint, Prettier, TypeScript build và **77 tests**; MCP server initialization + Expo Android export có Babel plugin đều pass.
- Unit/integration test bao phủ TypeScript AST source ownership, generated testID Babel transform, explicit testID preservation, source/native/telemetry correlation, flattened view honesty, sync handler success/error privacy và app-interaction → replay.
- Static scan trên Vshop đọc được 115 source actions, 22 conditional và chỉ 1 explicit testID; đây là evidence rằng Vshop cần bật plugin hoặc bổ sung testID trước khi agent map source/runtime đáng tin cậy.
- Runtime/device verification của `ui-model` đã hoàn tất trên emulator-5554 (Android x86_64, demo app pid 10385, session `aa0d2067-8c0e-4222-b2de-cb3d10acb961`): source-correlation đúng (`App.tsx:527:11` cho `open-PerformanceLab`), 8 app interaction events start/success có duration qua Babel plugin, 18 source actions vs 5 native, issues `source-action-without-testid`/`native-action-without-source` hoạt động, `session stop` ingest + capture model cuối thành công (32 events/13 artifacts, gồm `runtime_ui_model` và `app_interaction`). Case NOT VERIFIED trước đó đã đóng.

### Agent biết màn hình đang hiển thị gì

- Thêm CLI `understand-screen [--stuck-after MS]` và MCP `understand_screen` (tool 44). Core hợp nhất screenshot, UIAutomator, app-state và error/fatal log gần đây thành một response token-efficient.
- Response có `state` (`content`, `loading`, `error`, `empty`, `blank`, `background`, `not-running`), `stateSince`, fingerprint, route từ instrumentation (hoặc `null`, không đoán), headline, visible text, action refs/testID/bounds, counters, thống kê pixel và artifact paths.
- `issues[]` có severity + evidence + suggestion cho visible error text, recent runtime log, blank screen, loading/loading-stuck, empty state, unlabeled/small touch target, duplicate testID, zero-size và off-screen control.
- Classification là heuristic deterministic và ghi limitation ngay trong response; agent vẫn phải mở `screenshotPath`, tái hiện và compare trước/sau thay đổi.

### Loading-stuck bền qua nhiều process

- Fingerprint màn + `stateSince` được lưu dưới state của session/standalone. Gọi lại cùng loading screen sau ngưỡng sẽ nâng `loading-state` (info) thành `loading-stuck` (warning), thay vì đoán chỉ từ một ảnh.
- Khi UI đổi sang content/error/empty, fingerprint và thời điểm state reset; không kéo finding cũ sang màn mới.

### Privacy UI fail-closed

- `getUiTree()` redact trước khi persist hoặc return. Mọi `EditText`/`TextInput` bỏ nội dung hiện tại và content description; email, JWT, sensitive key/value và opaque token dài trong static UI text cũng được che.
- Snapshot ref của text-field luôn trả `value: null`; label lấy từ testID/resource/class thay vì nội dung người dùng nhập. Fix này đóng lỗ hổng credential WebView phát hiện khi dogfood Vshop.
- Artifact mới kind `ui-understanding` chứa JSON structured result; screenshot/UI tree vẫn là path/reference, không nhúng binary/base64 vào MCP.

### Workflow cho agent

- Cập nhật `AGENTS.md`, skill, README và docs theo vòng `session -> observe -> understand-screen -> reproduce -> diagnose -> smallest fix -> understand-screen -> compare -> replay`.
- MCP description hướng dẫn Codex/Claude/Cursor đọc state/headline/actions/findings và kiểm chứng artifact, không tự coi heuristic là nguyên nhân chắc chắn.

### Test và runtime dogfood

- Quality gate của phần screen-understanding trước runtime UI model pass **68 tests**; kết quả tổng mới được ghi ở mục verification phía trên sau khi chạy lại full gate.
- Unit test bao phủ content summary/action refs, route instrumentation, visible error, blank screen từ semantic + pixel evidence, loading → loading-stuck, pixel statistics và text-field/PII redaction.
- Device thật Xiaomi 23013PC75G / Android 15 / Vshop: content nhận đúng headline `Vshop`, 144 visible elements, 16 actions và 6 small touch targets; cold dev-client nhận `loading` rồi cùng fingerprint chuyển `loading-stuck`, sau khi load xong chuyển về `content` với fingerprint mới.
- Session evidence: `C:\Users\kona\Desktop\Vshop\.artifacts\sessions\06911da4-9703-4be0-aff5-302cb59bc050\summaries\summary.json`.
- Final contract được chạy lại từ build cuối trong session `7dd5dd63-00e6-4384-81b9-48a5b7c361ac`: `state: content`, `route: null` (Vshop không instrumentation), headline `Vshop`, 156 visible elements, 19 actions, 0 runtime error và 9 small touch targets. Agent cũng mở screenshot artifact để review trực quan thay vì chỉ tin semantic tree.

### Giới hạn còn lại

- Đây chưa phải React component/props owner tree: UIAutomator không thấy off-screen FlatList, component stack, contrast hoặc focus order. Agent dùng route/file search, instrumentation và DevTools để tìm component sở hữu sau khi screen-understanding chỉ ra symptom/evidence.
- Blank detection dùng semantic emptiness + pixel distribution; theme/canvas tối giản có thể cần người/agent mở screenshot để xác nhận.
- Runtime log lỗi có thể gồm ReactHost/system soft error; response ghi rõ phải correlate timestamp, không coi số log là proof app defect.

## 2.4.0 — 2026-08-22

Xử lý các điểm yếu ưu tiên đã thừa nhận, kèm runtime verification có phạm vi trên device thật (Xiaomi 23013PC75G, Android 15, MIUI). Các case chưa chạy đúng fixture vẫn giữ trạng thái `NOT VERIFIED`.

### Diagnosis: confidence tính từ data + ngưỡng cấu hình được

- Confidence giờ là hàm của (1) mức độ vượt ngưỡng và (2) độ mạnh đo được (frame sample count, tỷ lệ request chậm) — không còn hằng số viết tay.
- `DiagnosisThresholds` override được qua core, các flag `diagnose`, và input MCP; quan hệ ngưỡng sai bị từ chối trước khi đo.
- Mỗi finding trả `confidenceBasis`, ghi rõ đây là `heuristic-v1`, **không phải xác suất thống kê**. Ít mẫu sẽ gate confidence xuống (1 frame không còn cho score cao chỉ vì giá trị cực đoan).

### CDP connection lock (giữa các process)

- `CdpConnectionLock` dùng atomic create (`wx`) + owner UUID + pid-alive check. Lệnh thứ hai xếp hàng tối đa 180s; không cướp lock sống dù command chạy lâu. Hết thời gian trả `CDP_LOCK_HELD` recoverable.
- Áp dụng cho `devtools-export`, `devtools-profile`, `metro-network`, `reload --fast`.

### Evidence honest

- Mọi event gọi `record()` khi chưa có session phát cảnh báo `EVIDENCE_NOT_RECORDED`; không còn âm thầm bỏ timeline. `launch`/`reload` còn trả `evidenceRecorded` trực tiếp.

### Auto-record replay

- `session stop` tự sinh replay JSON; `replay export SESSION_ID` / MCP `replay_export` vẫn dùng được khi cần export thủ công.
- Text nhập chỉ lưu độ dài và bị bỏ khỏi replay để không ghi password/token. `press --ref` ghi testID hoặc tọa độ fallback nên export không còn bỏ tap có cấu trúc.

### Ref ổn định theo session

- Registry ref được lưu trong thư mục session. Element cùng identity giữ nguyên ref khi reorder/scroll; ref đã biến mất không bị tái sử dụng cho element mới.

### Artifact retention

- `artifacts cleanup [--days N] [--dry-run]` / MCP `cleanup_artifacts`: xóa session + artifact cũ hơn N ngày (mặc định 14), trả số file/bytes; bỏ qua session active; SQLite xóa trong transaction.

### A11y nâng cấp

- `a11y-audit` thêm kiểm tra **touch-target** (nhỏ hơn 48dp theo density device, chuẩn Android) bên cạnh unlabeled; trả cả hai counters.

### Public contract và CLI/MCP

- `FindingSchema` thêm optional `confidenceBasis: string[]`; contract cũ vẫn parse được.
- `diagnose` CLI nhận `--ui-fps-low`, `--ui-fps-critical`, `--js-blocking`, `--js-blocking-high`, `--slow-request`, `--very-slow-request`, `--render-count`; MCP nhận các field snake_case tương ứng.
- Ngưỡng phải hữu hạn/dương; critical FPS phải thấp hơn low FPS; JS/network high threshold phải lớn hơn warning threshold. Input sai trả `DIAGNOSIS_THRESHOLDS_INVALID` recoverable trước khi gọi ADB.
- Thêm CLI `replay export`, `artifacts cleanup`; thêm MCP `replay_export`, `cleanup_artifacts`.
- `appLaunch` và `appReload` trả `evidenceRecorded`; các command khác vẫn giữ response schema và dùng warning channel để tránh breaking response envelope.
- `OBSERVER_VERSION` đọc package metadata tại runtime; `rn-observe --version`, MCP version và package manifests cùng một nguồn.

### Redaction fail-closed

- Query/header/body preview chuyển từ blocklist sang allowlist. Key lạ mặc định `[REDACTED]`; body text không có cấu trúc bị che toàn bộ.

### Fix bug thật phát hiện khi verify

- `record start`: `sh -c` multi-arg bị adb ghép mất quoting → screenrecord không bao giờ chạy. Fix: truyền pipeline là một string duy nhất + `setsid` detach khỏi session adbd (MIUI kill SIGHUP). Verify: mp4 366KB/6s.
- `press` settle-diff dùng snapshot chế độ khác snapshot gốc (`-i` vs full) → diff nhiễu text node. Fix: lưu `interactiveOnly` vào state và tái dùng.
- `record stop`/`trace stop` trước đây tạo file nhưng không attach artifact vào SQLite session khi stop từ process khác; giờ lấy session ID từ state và ghi artifact/event đúng session.
- `Profiler.enable` bị runtime từ chối trước đây rơi thành `INTERNAL_ERROR`; giờ trả `DEVTOOLS_PROFILE_FAILED` recoverable.
- `dumpsys gfxinfo` có thể trả lại nguyên cửa sổ frame cũ: observer giờ lưu chữ ký và đánh dấu frame metrics `available: false` nếu không có sample mới, thay vì trình bày cùng số như ba benchmark độc lập.
- Version runtime đọc trực tiếp từ `packages/core/package.json`, bỏ hằng số version thứ hai dễ lệch.

### Known limitations mới xác nhận trên runtime thật

- `reload --fast` (CDP Page.reload): JS tải lại nhưng **input tap có thể bị nuốt** trên MIUI/Android 15 tới khi relaunch thật — khuyến nghị dùng fast reload chỉ cho quan sát không tương tác, dùng `reload` đầy đủ trước khi tái hiện.
- RN 0.86 bridgeless (Hermes) hiện **không expose CDP Network domain** (`metro-network` attach thành công nhưng 0 events) và **không hỗ trợ `Profiler.enable`** (`devtools-profile` lỗi tường minh). Cả hai kênh vẫn hữu ích với runtime RN hỗ trợ (0.83+ docs) và fallback instrumentation network vẫn hoạt động.
- `exceptions[]` của `devtools-export` rỗng trên runtime này (unhandled error đi redbox/logcat, không qua `Runtime.exceptionThrown`).

### Runtime verification đã chạy (device thật 45218ba)

- Vshop 4.1.1, `com.android.vshop`, perf mode: cảnh báo thiếu session xuất hiện; 16/16 element chung giữ ref qua scroll; auto replay 30 step chạy lại 30/30; recording 1,286,509 bytes và Perfetto trace đều attach session; hai `devtools-export` 2s chạy đồng thời hoàn thành nối tiếp trong 4.98s; custom diagnosis trả threshold + `confidenceBasis`.
- Demo/device verification từ các lượt trước vẫn chỉ được công nhận theo từng case đã có artifact; không suy rộng thành toàn bộ blueprint 2.2–2.4.
- NOT APPLICABLE trên runtime này: NET-017/018 (CDP Network), DTL-008 (Profiler) — runtime không expose; đã ghi rõ ở trên.

Artifact chính của lượt Vshop nằm dưới `.artifacts/sessions/eba59716-bc2b-4fed-88c9-d8ae9037ba3e/`: `summaries/summary.json`, replay JSON, recording mp4 và Perfetto trace. Lượt benchmark freshness riêng dùng session `cbc0e2c8-88ad-496f-a974-85745a8ec429`.

### Validation/release gate

- `pnpm release:check`: PASS (`lint`, `format:check`, build 6 workspace packages, 61 tests, MCP init, CLI version 2.4.0).
- Android Expo export fixture: PASS, Hermes bundle khoảng 1.4MB.
- `git diff --check`: PASS.

### Chưa giải quyết trong 2.4.0

- UIAutomator vẫn chậm, không thấy off-screen FlatList và không thay thế React component/props tree.
- Chưa có host support chính thức cho macOS/Linux; usage/protocol/troubleshooting chi tiết vẫn chủ yếu tiếng Việt/PowerShell.
- `better-sqlite3` vẫn là native dependency; chưa có migration an toàn sang storage không cần build tools.
- A11y mới có label + touch target; contrast/focus order chưa có nguồn dữ liệu đủ tin cậy.
- CDP chưa negotiation protocol version; runtime capability hiện được xác nhận bằng command success/structured unsupported error.
- Chưa chạy lại toàn bộ blueprint 2.2–2.4 đúng fixture; case thiếu artifact vẫn `NOT VERIFIED`, không được suy rộng từ Vshop smoke/performance flow.

### Khác

- MCP 41 → 43 tools (`replay_export`, `cleanup_artifacts`); CLI 35 → 37 lệnh; version 2.4.0 lấy từ package metadata; 61 unit tests.

## 2.3.0 — 2026-08-22

Tổng hợp các tính năng đáng giá nhất của agent-device / Expo MCP / agent-devtools / podium-mcp, giữ nguyên triết lý offline + evidence contract.

### Ref snapshot + press + diff (theo agent-device)

- `snapshot [--interactive|-i]`: gán ref `e1..eN` cho phần tử visible (kind button/text/text-field/switch/link, label, testId, bounds) — token-efficient hơn UI tree thô; state lưu `.artifacts/snapshots/last.json`.
- `tap --ref E1 [--settle MS]` / MCP `press`: tap theo ref (ưu tiên testId, fallback center-of-bounds); sau settle tự chụp snapshot mới và trả diff `+/-/=` theo dòng (`added/removed/changed` với from→to).
- Text node thuần đổi giá trị được nhận diện là _changed_ (key theo thứ tự kind), không phải removed+added.

### Replay script (theo agent-device .ad)

- `replay run SCRIPT.json` / MCP `replay_run`: chạy tuần tự các bước `tap/swipe/type-text/back/deep-link/reload/assert/wait/screenshot`, dừng ở lỗi đầu trừ khi `continueOnError`; báo cáo từng bước ok/summary. assert fail được tính là step fail.

### App data channel (theo agent-devtools)

- Instrumentation thêm `reportAppData(namespace, data)` (Redux store, navigation state, MMKV, feature flags...).
- `app-data [--namespace]` / MCP `get_app_data`: đọc snapshot mới nhất theo namespace từ log; demo RenderLab thêm nút `dump-state`.

### Expo Router sitemap (theo Expo MCP)

- `routes` / MCP `list_routes`: suy ra sitemap từ thư mục `app/` của app đích (loại `_file`, gộp `(group)`, `index` → route cha); trung thực khi app không dùng expo-router (`appDirExists: false`).

### Deep link + permissions + assert + a11y audit

- `deep-link --uri` / MCP `open_deep_link`: `am start VIEW` giới hạn package.
- `permissions [list|grant|revoke --perm]` / MCP `list_permissions`/`set_permission`: parse runtime permissions từ `dumpsys package`, đổi qua `pm grant/revoke`.
- `assert (--test-id|--text) [--visible]` / MCP `assert_element`: assertion có evidence (matchCount, label, visible); pass/fail rõ ràng cho replay.
- `a11y-audit` / MCP `a11y_audit`: liệt kê phần tử interactive thiếu text/contentDescription/testID (điểm yếu accessibility cho cả agent lẫn người dùng screen reader).

### Khác

- MCP 31 → 41 tools; CLI 27 → 35 lệnh; version 2.3.0 đồng bộ.
- Runtime verification 2.3.0: NOT VERIFIED — Android device unavailable; 45 unit tests pass; chạy lại blueprint T0 + case mới khi có device.

## 2.2.0 — 2026-08-22

### Network qua Metro CDP (không cần instrumentation)

- `metro-network` CLI / tool MCP `get_metro_network`: bật CDP Network domain trên target Metro, thu per-request URL/method/status/duration/bytes trong cửa sổ thời gian; merge event redirect/failed deterministic; URL redact host-side.
- Lấp gap lớn nhất cho app không cài instrumentation (lỗi tường minh `METRO_NETWORK_UNSUPPORTED` khi runtime không expose Network domain, cần RN 0.83+).
- Demo NetworkLab thêm fixture `network-real` (fetch thật tới Metro `/status`, không phụ thuộc Internet) để dogfood hai nguồn network (CDP vs instrumentation).

### Reload nhanh qua Metro

- `reload --fast` (MCP `app_reload` với `mode: "metro"`): CDP `Page.reload` — JS-only, giữ native state, nhanh hơn force-stop nhiều lần.
- Fallback tự động: khi Metro/target không khả dụng thì force-stop + relaunch, response ghi rõ `mode: 'app-fallback'` + `fallbackReason`.

### Video recording

- `record start [--duration MS]` / `record stop RECORDING_ID` (MCP `start_recording`/`stop_recording`): `adb shell screenrecord` nền, SIGINT để finalize, pull mp4 artifact (kind `recording`); clamp 1–180s theo giới hạn Android; state file `.artifacts/active-recordings/` cho start/stop hai process.

### JS CPU profile

- `devtools-profile [--duration] [--metro]` (MCP `devtools_profile`): CDP `Profiler.start/stop` (Hermes sampling), artifact `.cpuprofile` (kind `profile`) mở được bằng Chrome DevTools/Speedscope; lỗi trung thực `DEVTOOLS_PROFILE_FAILED` nếu runtime không hỗ trợ.

### Khác

- MCP 27 → 31 tools; CLI 24 → 27 lệnh; version 2.2.0 đồng bộ.
- Core thêm `redactUrl` host-side (song song với instrumentation — package đó phải không-dependency cho app bundle).
- Runtime verification 2.2.0: NOT VERIFIED — Android device unavailable (mất kết nối USB lúc verify); unit test 35 case pass toàn bộ; cần chạy lại blueprint T0 + case mới khi device sẵn sàng.

## 2.1.0 — 2026-08-21

### DevTools export (CDP)

- `devtools-export` CLI và tool MCP `devtools_export`: attach vào runtime React Native qua Metro inspector (Chrome DevTools Protocol), thu console entries, exceptions và Hermes heap usage trong cửa sổ thời gian, ghi artifact `devtools-export` JSON.
- CDP client riêng dựa trên `ws` với header `Origin` suy từ URL (Metro từ chối handshake 401 khi thiếu).
- Lỗi tường minh: `METRO_UNREACHABLE`, `DEVTOOLS_TARGET_NOT_FOUND`, `DEVTOOLS_CONNECT_FAILED`.
- Env mới `RN_OBSERVER_METRO_URL`.

### Fallback evidence cho app không instrumentation

- `app-state` CLI/MCP `app_state`: PID, process running, foreground activity, app-in-foreground từ `pidof` + `dumpsys activity`.
- `device-network` CLI/MCP `get_device_network`: byte counters `/proc/net/dev` hai điểm và delta theo interface; device-level, không quy về app.
- `observe`/`observe_screen` mặc định thêm `app_state` vào `include`.

### Network body capture hoàn thiện

- `reportNetworkRequest` nhận `requestBodyPreview`/`responseBodyPreview`, redact trước khi emit.
- Fetch observer opt-in kèm `responseHeaders` đã redact qua `redactHeaders`.
- Demo NetworkLab thêm fixture `network-body` (POST + body chứa token/email) để xác minh redaction.

### Khác

- MCP 24 → 27 tools; `plannedCommands` giờ rỗng.
- Version đồng bộ 2.1.0 toàn workspace; `OBSERVER_VERSION` là nguồn duy nhất.
- Thêm `docs/test-blueprint.md` (bộ tham chiếu test chuẩn ~160 case, 21 domain, 4 tier).
- Runtime verification trên Xiaomi 23013PC75G (Android 15): app-state, device-network delta, devtools-export thu console error thật + heap Hermes.

## 2.0.0 — 2026-08-21

Đây là bản Android v1 ổn định đầu tiên của RN Agent Observer.

### Runtime observer

- Điều khiển Android bằng ADB: discovery, device info, launch/reload, screenshot, tap, swipe, text và back.
- Chuẩn hóa UIAutomator tree với semantic `testID`, accessibility label, text, bounds và trạng thái interaction.
- Thu logcat có filter, Android gfx framestats, worst/average frame, dropped frames, refresh rate, process memory và CPU.
- Start/stop/pull Perfetto trace qua nhiều CLI process.

### React Native instrumentation

- Development-only network timing, route events, React Profiler renders và long JS task reporting.
- Redact token, API key, password, secret và PII rõ ràng trong URL/body preview.
- Network body capture tắt mặc định; explicit opt-in có cảnh báo và giới hạn 4096 ký tự.

### Evidence và diagnosis

- `observe_screen` hợp nhất screenshot, UI, route, performance, network và errors.
- SQLite session timeline với screenshot, UI-tree, trace và summary artifacts trên đĩa.
- Deterministic diagnosis cho long JS task, UI FPS thấp, request chậm, rerender và runtime errors.
- Pixel diff kết hợp structural UI-tree diff.

### Interfaces

- CLI `rn-observe` với toàn bộ workflow Android v1.
- MCP stdio server với 24 tools dùng chung `ObserverCore`.
- Shared strict TypeScript/Zod schemas.
- Expo demo gồm Performance, Network, Render, Animation, Error và Visual labs.

### Verification

- Full lint/format/build/test quality gate.
- Native dogfood trên Android 15 physical device.
- Vshop: 83 tests, Android export và runtime observation thực tế.

### Breaking changes so với 0.2.0

- Version public chuyển thành `2.0.0` cho root, CLI, core, MCP, schemas, instrumentation và demo.
- `OBSERVER_VERSION` trong core là nguồn version runtime duy nhất cho CLI/MCP/status.
- Package tarballs chỉ chứa `dist`; source đầy đủ nằm trong source release archive.
- Observer chỉ công bố Android/Windows; mọi platform native ngoài Android đã được loại khỏi status và device schema.

### Release artifacts

- Portable CLI Windows x64 đã kèm production dependencies và native SQLite.
- Portable MCP server Windows x64 đã kèm production dependencies.
- Source ZIP để build lại bằng pnpm.
- Năm package tarball với workspace dependency được rewrite thành `2.0.0`.
- SHA-256 manifest cho toàn bộ file bàn giao.

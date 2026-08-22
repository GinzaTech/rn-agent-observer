# Changelog

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

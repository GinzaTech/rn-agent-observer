# Báo cáo kiểm thử và runtime verification

Ngày xác minh gần nhất: **2026-08-22**
Host: Windows, Node.js >=22.12, pnpm 9.6.0
Thiết bị: physical Android `23013PC75G`, serial `45218ba`, Android 15, 1080×2400

## Quality gate repository

Các lệnh chuẩn:

```powershell
pnpm check
pnpm release:check
pnpm --filter @rn-agent-observer/demo-expo exec expo export --platform android --output-dir <temporary-directory>
```

Kết quả 2.4.0: lint, Prettier, TypeScript build, MCP initialization, CLI version và **61 unit tests** pass. Phạm vi gồm schema validation, ADB/UI/log/frame/memory/CPU parsers, allowlist redaction, heuristic diagnosis + threshold validation, CDP queue, performance freshness, SQLite session/artifact/cleanup, stable refs, auto replay, pixel/UI-tree comparison, CLI và MCP.

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

Kết quả gần nhất: TypeScript và ESLint pass; Jest 9 suites/83 tests pass; Android Expo export 2.667 modules hoàn tất.

Dogfood 2.4.0 bằng CLI của repo trên package `com.android.vshop`, Metro `--no-dev --minify`:

- device/app discovery, launch, screenshot 1080×2400 và UIAutomator tree chạy thật;
- unified `observe` trả screen/UI/performance/log summary;
- lệnh không có session phát `EVIDENCE_NOT_RECORDED` thay vì âm thầm bỏ event;
- 16/16 element chung giữ nguyên ref qua hai snapshot có scroll/reorder;
- hai `devtools-export --duration 2000` chạy đồng thời được queue và cùng pass trong 4.98s;
- session `eba59716-bc2b-4fed-88c9-d8ae9037ba3e` có 51 event/9 artifact; recording 1,286,509 bytes và Perfetto trace attach đúng SQLite session;
- `session stop` sinh replay 30 bước; `replay run` đạt 30/30, không thao tác purchase/login/account;
- diagnosis nhận custom thresholds và trả `confidenceBasis`; ví dụ 51.0 UI FPS/113 frame với threshold 55 cho confidence heuristic 0.32;
- ba lần đọc gfxinfo từng trả đúng cùng cửa sổ 113 frame. Bản fix freshness đã được verify: lần đầu available, lần kế tiếp cùng signature trả `available: false` + reason `No new gfx frame samples...`;
- PNG compare cho cùng ảnh đạt similarity 1;
- RN 0.86 bridgeless từ chối `Profiler.enable`; observer trả đúng `DEVTOOLS_PROFILE_FAILED` recoverable thay vì `INTERNAL_ERROR`.

## Boundary còn lại

- `devtools-export` tự động có console/heap, nhưng RN 0.86 bridgeless không expose CDP Network/Profiler domains trên runtime đã thử. Không suy rộng giới hạn này sang mọi RN version.
- JS FPS tiếp tục explicit unavailable; Perfetto là artifact thô, chưa tự phân tích thành app-specific CPU flame chart.
- Vshop không được sửa source để thêm instrumentation, nên network/route/render event ở Vshop có thể rỗng. Đây là expected behavior, không phải dữ liệu 0 giả.
- UIAutomator vẫn có latency và không có off-screen FlatList/React props tree. macOS/Linux host, tài liệu EN đầy đủ, contrast/focus-order audit, CDP protocol negotiation và loại native `better-sqlite3` vẫn là backlog.
- Chỉ các case có artifact cụ thể ở trên được coi runtime verified; case blueprint chưa chạy đúng fixture vẫn là `NOT VERIFIED`.

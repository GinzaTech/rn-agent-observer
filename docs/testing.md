# Báo cáo kiểm thử và runtime verification

Ngày xác minh: **2026-08-21**  
Host: Windows, Node.js 22.13.0, pnpm 9.6.0, ADB 37.0.0  
Thiết bị: physical Android `23013PC75G`, serial `45218ba`, Android 15, 1080×2400

## Quality gate repository

Các lệnh chuẩn:

```powershell
pnpm check
pnpm mcp:check
pnpm exec expo export --platform android --output-dir <temporary-directory>
```

Phạm vi unit/integration gồm schema validation, ADB/UI/log/frame/memory/CPU parsers, network percentile/redaction, deterministic diagnosis, SQLite session/artifact persistence, pixel/UI-tree comparison, CLI error behavior và MCP in-memory handshake/tool listing.

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

Dogfood bằng CLI của repo trên package `com.android.vshop`:

- device/app discovery, launch, screenshot 1080×2400 và UIAutomator tree chạy thật;
- unified `observe` trả screen/UI/performance/log summary;
- performance có UI frame time/FPS, dropped frames, 120Hz display và process memory; JS-only fields unavailable trung thực vì Vshop chưa gắn instrumentation;
- SQLite session start/observe/stop/get chạy qua nhiều process;
- PNG compare cho cùng ảnh đạt similarity 1;
- Perfetto trace được start, stop và pull thành artifact.

## Boundary còn lại

- Chưa có automated React Native DevTools export; JS FPS tiếp tục explicit unavailable.
- Vshop không được sửa source để thêm instrumentation, nên network/route/render event ở Vshop có thể rỗng. Đây là expected behavior, không phải dữ liệu 0 giả.

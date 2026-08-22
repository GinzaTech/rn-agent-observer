# RN Agent Observer

RN Agent Observer 2.3.0 là cầu nối quan sát runtime cục bộ cho React Native/Expo. Công cụ dùng cùng một core TypeScript cho CLI và MCP, điều khiển Android qua ADB/UIAutomator, nhận telemetry từ instrumentation phát triển, export console/exception/heap/JS CPU profile qua Chrome DevTools Protocol của Metro, thu network per-request không cần instrumentation, ref snapshot + diff + replay script, quay video màn hình, lưu session bằng SQLite và giữ ảnh/trace/UI tree ở dạng artifact trên đĩa.

Phiên bản hiện tại hoàn thành Android v1 trên Windows: 41 MCP tools, CLI tương ứng, demo Expo có các lab xác định, chẩn đoán dựa trên rule và so sánh ảnh + cấu trúc UI.

## Yêu cầu

- Node.js 22.12 trở lên
- pnpm 9.6
- Android Platform Tools (`adb`)
- Android emulator hoặc thiết bị vật lý đã cho phép USB debugging
- Expo development build nếu cần telemetry riêng của ứng dụng

## Bắt đầu nhanh

```powershell
pnpm install
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

pnpm rn-observe launch
pnpm rn-observe observe
pnpm rn-observe tap --test-id buy-button
pnpm rn-observe performance
pnpm rn-observe diagnose
```

Artifacts và SQLite được tạo trong `<projectRoot>/.artifacts/`; binary lớn không được nhúng vào MCP response.

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

Server dùng stdio. Cấu hình client và danh sách 41 tool nằm trong [docs/protocol.md](docs/protocol.md).

## Tài liệu

- [Hướng dẫn sử dụng chi tiết](docs/usage.md)
- [Tổng quan dự án đầy đủ (VI/EN)](PROJECT.md)
- [Kiến trúc](docs/architecture.md)
- [CLI và MCP protocol](docs/protocol.md)
- [Định nghĩa metrics](docs/metrics.md)
- [Capability matrix](docs/capability-matrix.md)
- [Kiểm thử và runtime verification](docs/testing.md)
- [Lộ trình test chuẩn (test blueprint)](docs/test-blueprint.md)
- [Xử lý sự cố](docs/troubleshooting.md)
- [Release 2.0.0](CHANGELOG.md)

## Biên hiện tại

- Android/Windows là target duy nhất của Observer 2.1.0.
- ADB không có tín hiệu JS FPS đáng tin cậy; field được trả `available: false`, không đoán số.
- JS blocking, route, React renders và network metadata cần instrumentation phát triển trong app.
- Export DevTools qua CDP (`devtools-export`, `devtools-profile`) và network per-request (`metro-network`) cần Metro đang chạy và app kết nối được Metro (`adb reverse tcp:8081 tcp:8081`); không dùng được khi một phiên React Native DevTools khác đang giữ kết nối.
- `reload --fast` dùng CDP Page.reload (JS-only); tự fallback về force-stop khi Metro không khả dụng.
- App không có instrumentation: dùng `metro-network` (CDP), `app-state` (foreground activity, PID) và `device-network` (byte counters device-level, không quy về app) làm evidence fallback.
- `record` (screenrecord) giới hạn 180s/clip theo Android.
- Perfetto trace đã hỗ trợ Android; phân tích trace sâu vẫn dùng Perfetto UI/Android Studio.
- Observer không thu network body mặc định. Opt-in development-only có cảnh báo và có thể làm lộ dữ liệu nhạy cảm.

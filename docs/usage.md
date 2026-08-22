# Hướng dẫn sử dụng chi tiết

Tài liệu áp dụng cho RN Agent Observer 2.4.0, target Android + Windows + Expo/React Native.

## 1. Cài đặt và kiểm tra môi trường

```powershell
node --version
pnpm --version
adb version
pnpm install
pnpm check
```

Yêu cầu Node 22.12+, pnpm 9.6 và một Android device/emulator ở state `device`:

```powershell
adb devices -l
```

## 2. Chọn app và device

Chạy CLI từ repo observer nhưng trỏ vào app đích bằng biến môi trường:

```powershell
$env:RN_OBSERVER_PROJECT_ROOT = 'C:\Users\me\my-expo-app'
$env:RN_OBSERVER_DEVICE_ID = 'emulator-5554'
```

Observer đọc package từ `app.json`:

```json
{
  "expo": {
    "android": { "package": "com.example.app" }
  }
}
```

Nếu dự án không có trường đó:

```powershell
$env:RN_OBSERVER_APP_ID = 'com.example.app'
```

Kiểm tra resolution thực tế:

```powershell
pnpm rn-observe devices
pnpm rn-observe device-info
pnpm rn-observe status
```

## 3. Mở và quan sát app

```powershell
pnpm rn-observe launch
pnpm rn-observe observe
```

`observe` mặc định thu một snapshot gọn gồm screenshot artifact, số phần tử UI, route nếu có instrumentation, performance, network summary và lỗi gần đây. Ảnh nằm ở `<app>/.artifacts/sessions/standalone/screenshots` nếu chưa mở session.

Thu riêng evidence đầy đủ:

```powershell
pnpm rn-observe screenshot
pnpm rn-observe ui-tree
pnpm rn-observe logs --level error --limit 200
pnpm rn-observe logs --keyword RN_AGENT_OBSERVER --limit 2000
pnpm rn-observe performance
pnpm rn-observe render-stats
pnpm rn-observe network requests
pnpm rn-observe network summary
```

## 4. Điều khiển UI

Ưu tiên semantic target từ `ui-tree`:

```powershell
pnpm rn-observe tap --test-id buy-button
```

Fallback tọa độ và gesture:

```powershell
pnpm rn-observe tap --x 540 --y 1200
pnpm rn-observe swipe --from 540,1800 --to 540,500 --duration 500
pnpm rn-observe type-text --text 'hello world'
pnpm rn-observe back
```

Input thiếu/không phải số trả `INVALID_ARGUMENT`; observer không gửi `NaN` cho ADB.

## 5. Session giữa nhiều lệnh CLI

Bắt đầu session và ghi lại ID:

```powershell
pnpm rn-observe session start
$env:RN_OBSERVER_SESSION_ID = '<session-id-vừa-trả-về>'
```

Tất cả lệnh sau đó ghi timeline/artifact vào SQLite:

```powershell
pnpm rn-observe observe
pnpm rn-observe tap --test-id trigger-js-block
pnpm rn-observe performance
pnpm rn-observe diagnose
pnpm rn-observe session stop $env:RN_OBSERVER_SESSION_ID
pnpm rn-observe session get $env:RN_OBSERVER_SESSION_ID
```

Khi stop, core tạo `summary.json`. `get` trả timeline và metadata/path của mọi artifact, không chứa binary blob.

## 6. Trace Perfetto

```powershell
pnpm rn-observe trace start --duration 10000
# tái hiện vấn đề, ghi lại trace ID
pnpm rn-observe trace stop <trace-id>
```

Start và stop có thể là hai tiến trình CLI khác nhau. Trace được pull thành `.perfetto-trace`; mở bằng Perfetto UI hoặc Android Studio để phân tích native/system thread.

## 6b. App không có instrumentation (fallback evidence)

Với app ngoài repo hoặc app chưa cài `rn-instrumentation`:

```powershell
pnpm rn-observe app-state
pnpm rn-observe device-network --window 2000
```

- `app-state` trả PID, tiến trình có chạy không, foreground activity và app có thực sự ở foreground không — thay thế(route-level knowledge)bằng activity-level.
- `device-network` lấy byte counters toàn thiết bị hai lần rồi trả delta theo interface (`wlan0`, `rmnet_*`). Đây là evidence device-level, **không** quy về app cụ thể; không dùng làm kết luận network của app.
- `observe` mặc định đã gồm `app_state` từ 2.1.0.

## 6c. Export React Native DevTools qua CDP

Yêu cầu: Metro đang chạy cho đúng app và app load JS từ Metro (`adb reverse tcp:8081 tcp:8081` nếu chạy qua USB, hoặc port khác kèm `--metro`). Không mở React Native DevTools song song vì chỉ một phiên inspector được phép.

```powershell
pnpm rn-observe devtools-export --duration 10000 --metro http://127.0.0.1:8082
```

Trong cửa sổ thu, tái hiện kịch bản trên app (tap, điều hướng). Kết quả gồm:

- `consoleEntries`: mọi console log/warn/error từ JS runtime qua CDP (kể cả event instrumentation).
- `exceptions`: message dòng đầu của exception chưa xử lý.
- `heap`: Hermes heap usage qua `Runtime.getHeapUsage`; unavailable trung thực nếu runtime không trả.
- `artifactId`: file JSON đầy đủ dưới `.artifacts/.../devtools-exports/`.

Lỗi thường gặp: `METRO_UNREACHABLE` (Metro chưa chạy/sai URL), `DEVTOOLS_TARGET_NOT_FOUND` (app chưa kết nối Metro), `DEVTOOLS_CONNECT_FAILED` (phiên DevTools khác đang giữ kết nối).

## 6d. Tính năng Metro/CDP bổ sung (2.2.0)

Reload nhanh (JS-only, giữ native state — nhanh hơn force-stop nhiều lần):

```powershell
pnpm rn-observe reload --fast              # tự fallback force-stop nếu Metro lỗi
pnpm rn-observe reload --fast --metro http://127.0.0.1:8082
```

Network per-request không cần instrumentation (CDP Network domain, cần RN 0.83+):

```powershell
pnpm rn-observe metro-network --duration 10000 --metro http://127.0.0.1:8082
```

Trong cửa sổ thu, thao tác app để phát sinh request. Response gồm `requests[]` (URL đã redact, status, durationMs, responseBytes) và `summary` (p50/p95/p99, failures, slowest). Lưu ý: chỉ thấy request từ JS runtime (fetch/XHR); request native (symbolicate, bundle) không nằm trong nguồn này.

JS CPU profile (Hermes sampling, artifact `.cpuprofile` mở bằng Chrome DevTools/Speedscope):

```powershell
pnpm rn-observe devtools-profile --duration 10000 --metro http://127.0.0.1:8082
```

## 6e. Quay video màn hình

```powershell
pnpm rn-observe record start --duration 15000    # trả recording ID, max 180s/clip
# tái hiện kịch bản
pnpm rn-observe record stop <recording-id>       # pull mp4 artifact
```

Start/stop chạy được ở hai process CLI khác nhau (state tại `.artifacts/active-recordings/`). Screenrecord không quay được khi màn hình khóa; clip đơn tối đa 180s theo giới hạn Android — cần dài hơn thì quay nhiều clip.

## 6f. Ref snapshot, assert, replay (2.3.0)

Snapshot token-efficient thay cho ui-tree thô khi agent cần đọc màn:

```powershell
pnpm rn-observe snapshot --interactive     # chỉ phần tử tương tác, ref e1..eN
pnpm rn-observe snapshot                    # gồm cả text node
```

Tap theo ref, kèm settle+diff:

```powershell
pnpm rn-observe tap --ref e2 --settle 1500
# trả về { performed, target, diff: { added, removed, changed, lines } }
# lines dạng: + @e7 [text-field] "Ada"  |  = @e3 [text] "idle" -> "done"
```

Khi có session, ref registry nằm trong `.artifacts/sessions/<sessionId>/state/last-snapshot.json`: element cùng identity giữ ref qua reorder/scroll và ref đã mất không bị cấp lại cho element mới. Ngoài session, state standalone vẫn nằm ở `.artifacts/snapshots/last.json`.

Assertion có evidence (nền cho replay):

```powershell
pnpm rn-observe assert --test-id buy-button --visible true
```

Replay script (ghi lại thao tác thành JSON, chạy lại deterministic):

```powershell
pnpm rn-observe replay run .\scripts\checkout.json
pnpm rn-observe replay export <session-id>
```

`session stop` tự export interaction timeline thành replay JSON. Vì an toàn, `type-text` chỉ ghi character count trong timeline và bị bỏ khỏi script; điền text fixture thủ công nếu kịch bản cần bước này.

Nếu chạy command có timeline event mà quên session, CLI in warning `EVIDENCE_NOT_RECORDED` ra stderr. Data/artifact standalone vẫn được trả, nhưng không được phép báo cáo như session evidence.

Cleanup retention nên preview trước:

```powershell
pnpm rn-observe artifacts cleanup --days 14 --dry-run
pnpm rn-observe artifacts cleanup --days 14
```

Cleanup bỏ qua active session và xóa metadata SQLite đồng bộ với session directory.

Diagnosis thresholds có thể tune cho app/fixture:

```powershell
pnpm rn-observe diagnose --ui-fps-low 55 --ui-fps-critical 35 `
  --js-blocking 50 --js-blocking-high 120 `
  --slow-request 1200 --very-slow-request 2500 --render-count 15
```

`confidenceBasis` giải thích signal/sample strength; confidence là heuristic score, không phải xác suất hay thống kê baseline.

Ví dụ script:

```json
{
  "name": "smoke",
  "steps": [
    { "action": "tap", "testId": "open-NetworkLab", "settleMs": 1500 },
    { "action": "tap", "testId": "network-500" },
    { "action": "assert", "testId": "network-result" },
    { "action": "wait", "ms": 300 },
    { "action": "screenshot" }
  ]
}
```

## 6g. Deep link, permissions, a11y, app data, routes (2.3.0)

```powershell
pnpm rn-observe deep-link --uri 'demo://detail/42'
pnpm rn-observe permissions
pnpm rn-observe permissions grant --perm android.permission.CAMERA
pnpm rn-observe a11y-audit          # interactive element thiếu label/testID
pnpm rn-observe app-data            # snapshot state mới nhất theo namespace
pnpm rn-observe routes              # sitemap expo-router từ app/ của app đích
```

App cần gửi app-data qua instrumentation:

```tsx
import { reportAppData } from '@rn-agent-observer/rn-instrumentation';
reportAppData('redux-store', { cart: { items: 2 } });
reportAppData('navigation', { route: 'Cart' });
```

## 7. So sánh before/after

Chụp PNG và `ui-tree`; mỗi output UI tree có `artifactPath`. Sau thay đổi, chụp lại rồi chạy:

```powershell
pnpm rn-observe compare <before.png> <after.png> `
  --before-ui <before-ui-tree.json> `
  --after-ui <after-ui-tree.json>
```

Kết quả gồm dimensions, similarity, changed pixel count/region, diff PNG và structural changes (`added`, `removed`, `changed`). Nếu chỉ có ảnh, bỏ cả hai UI flags; không được truyền một flag đơn lẻ.

## 8. Instrumentation phát triển

Thêm workspace/package `@rn-agent-observer/rn-instrumentation`, chỉ bật trong development build:

```tsx
import {
  createRenderTracker,
  installNetworkObserver,
  reportJsTask,
  reportRoute,
} from '@rn-agent-observer/rn-instrumentation';
import { Profiler, useEffect, useMemo } from 'react';

const onRender = useMemo(() => createRenderTracker('App'), []);
useEffect(() => installNetworkObserver(), []);
reportRoute(currentRoute);

const started = performance.now();
expensiveWork();
reportJsTask(performance.now() - started, 'expensiveWork');

return (
  <Profiler id="App" onRender={onRender}>
    {children}
  </Profiler>
);
```

Fetch metadata được redact sensitive query values. Body capture tắt mặc định. Opt-in development-only:

```ts
installNetworkObserver(createInstrumentationConfig(true, true));
```

Lệnh này in cảnh báo, clone response và giữ preview tối đa 4096 ký tự. Chỉ dùng với dữ liệu fixture; không bật trên tài khoản/dữ liệu thật.

## 9. Chạy demo

Build/cài development build:

```powershell
pnpm --filter @rn-agent-observer/demo-expo android -- --device <device-name>
```

Các semantic ID chính:

| Lab            | ID                                                                                            | Kỳ vọng                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| PerformanceLab | `trigger-js-block`                                                                            | `js_blocking_ms` khoảng 100ms, worst frame/dropped frames có evidence                             |
| NetworkLab     | `network-fast`, `network-500`, `network-2000`, `network-fail`, `network-body`, `network-real` | 0/500/2000ms, status 503, token bị redact; body preview bị redact; fetch thật tới Metro `/status` |
| RenderLab      | `rerender-list`                                                                               | React render count tăng bất thường                                                                |
| AnimationLab   | `animated-box`                                                                                | Animation fixture, tôn trọng Reduce Motion                                                        |
| ErrorLab       | `console-error`, `handled-error`, `unhandled-error`                                           | Log/error collection                                                                              |
| VisualLab      | `toggle-regression`                                                                           | Pixel + UI structural diff                                                                        |

Luồng dogfood ngắn:

```powershell
pnpm rn-observe tap --test-id open-PerformanceLab
pnpm rn-observe tap --test-id trigger-js-block
pnpm rn-observe performance
pnpm rn-observe diagnose
```

## 10. MCP

```powershell
pnpm mcp:check
pnpm mcp:start
```

Server stdio dùng cùng bốn biến môi trường. Cấu hình client và inputs nằm trong [protocol.md](protocol.md). MCP không chứa business logic riêng; kết quả CLI/MCP cùng đi qua `ObserverCore`.

## 11. Dọn biến môi trường

```powershell
Remove-Item Env:RN_OBSERVER_PROJECT_ROOT -ErrorAction SilentlyContinue
Remove-Item Env:RN_OBSERVER_DEVICE_ID -ErrorAction SilentlyContinue
Remove-Item Env:RN_OBSERVER_APP_ID -ErrorAction SilentlyContinue
Remove-Item Env:RN_OBSERVER_SESSION_ID -ErrorAction SilentlyContinue
```

Không xóa `.artifacts` khi còn cần audit session/trace. Không commit artifact có UI hoặc dữ liệu runtime nhạy cảm.

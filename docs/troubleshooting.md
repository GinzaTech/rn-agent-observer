# Xử lý sự cố

> **English summary**: Android is the built-in runtime target; Windows/Linux/macOS
> are Node hosts. Start read-only. Active actions require exact policy binding and
> process trust; CDP commands require the correct Metro target and ADB reverse.

## Không tìm thấy pnpm/workspace package

```powershell
corepack enable
corepack prepare pnpm@9.6.0 --activate
pnpm install --frozen-lockfile
pnpm build
```

Repo đặt pnpm virtual store ngắn (`.pnpm`) để tránh giới hạn đường dẫn CMake/Prefab trên Windows. Không chạy package-local `npm install`.

Chỉ thêm `--force` khi active virtual store bị stale và bạn đã xác nhận
`pnpm-lock.yaml`/`.pnpmfile.cjs` đúng; không xóa lockfile để né lỗi frozen install.

## npm trả 404 cho package Observer

Kiểm tra trực tiếp:

```powershell
pnpm view @rn-agent-observer/cli version
```

Tại snapshot 2026-08-24, package scoped chưa được publish. Dùng
[source installation](installation.md) thay vì đổi registry hoặc cài package cùng
tên không thuộc scope. Sau lần publish đầu, chỉ tin exact package
`@rn-agent-observer/*` và verify version/provenance.

## ADB không thấy device hoặc có nhiều device

```powershell
adb kill-server
adb start-server
adb devices -l
$env:RN_OBSERVER_DEVICE_ID = '<serial>'
```

Chấp nhận USB debugging prompt. State `unauthorized`/`offline` chưa thể quan sát. Khi có nhiều device, observer cố ý báo `MULTIPLE_DEVICES` thay vì chọn ngẫu nhiên.

## Không resolve được app ID

Đảm bảo `app.json` có:

```json
{ "expo": { "android": { "package": "com.example.app" } } }
```

Hoặc đặt `$env:RN_OBSERVER_APP_ID`.

## `tap --test-id` không tìm thấy

```powershell
pnpm rn-observe ui-tree
```

Target phải visible và có bounds. React Native `testID`, `accessibilityLabel`, text hoặc Android resource-id đều có thể match. Nếu native view không expose semantics, dùng tọa độ sau khi kiểm tra screenshot.

## Network/render/route rỗng

Đây là telemetry opt-in. Cài `@rn-agent-observer/rn-instrumentation` trong development build và gọi:

```ts
useEffect(() => installNetworkObserver(), []);
reportRoute(routeName);
<Profiler id="App" onRender={createRenderTracker('App')}>...</Profiler>;
```

Không bật instrumentation trong production. Network body mặc định luôn tắt. Nếu không thể sửa app (app ngoài repo), dùng fallback `app-state` và `device-network`; không suy diễn network của app từ byte counters toàn thiết bị.

## devtools-export lỗi

- `METRO_UNREACHABLE`: Metro chưa chạy hoặc sai URL. Khởi động Metro cho đúng app, chạy `adb reverse tcp:8081 tcp:8081` (hoặc truyền `--metro http://127.0.0.1:<port>` khi Metro dùng port khác).
- `DEVTOOLS_TARGET_NOT_FOUND`: app chưa kết nối Metro. Mở/relaunch app để nó load bundle từ Metro; kiểm tra `http://127.0.0.1:<port>/json` có target của app.
- `DEVTOOLS_CONNECT_FAILED`: một phiên React Native DevTools khác đang giữ inspector. Đóng DevTools rồi thử lại.
- `CDP_LOCK_HELD`: observer đã xếp hàng chờ inspector nhưng quá timeout 180s. Command sống không bị cướp lock theo tuổi; retry sau khi command kia xong hoặc đóng React Native DevTools.
- Metro inspector từ chối handshake nếu thiếu header `Origin`; observer tự gửi origin suy từ URL — không dùng client WebSocket không cho phép set header.

## metro-network rỗng hoặc devtools-profile lỗi

- RN 0.86 bridgeless (Hermes) đã xác nhận **không expose CDP Network domain** (attach thành công nhưng 0 events) và **từ chối `Profiler.enable`**. Đây là giới hạn runtime, không phải lỗi observer.
- Fallback network: dùng instrumentation (`installNetworkObserver`) — đã verify hoạt động trên cùng runtime.
- `metro-network` trả requestCount 0 trung thực; không coi là lỗi.

## Tap không tác dụng sau reload --fast

- Trên một số device (xác nhận MIUI/Android 15): sau `reload --fast` (CDP Page.reload), JS tải lại nhưng input tap bị nuốt đến khi relaunch thật.
- Khuyến nghị: dùng `reload --fast` cho quan sát không tương tác; trước khi tái hiện kịch bản tương tác, dùng `reload` đầy đủ (force-stop + launch).

## record start không tạo file

- Đã fix ở 2.4.0 (adb multi-arg mất quoting + cần `setsid` detach). Nếu gặp lại: kiểm tra `adb shell "ps -A | grep screenrecord"` và thử `record stop`; màn hình khóa cũng làm screenrecord dừng ngay.

## JS FPS hoặc JS blocking unavailable

ADB không cung cấp JS FPS đáng tin cậy. Đây là limitation bình thường. `js_blocking_ms` chỉ available sau khi app gọi `reportJsTask`; nếu không, dùng React Native DevTools/Hermes trace để phân tích sâu.

## Perfetto start/stop

Luôn dùng trace ID do `trace start` trả về. State được giữ ở `.artifacts/active-traces`, nên start/stop có thể chạy ở hai CLI process khác nhau. Nếu process app/device mất kết nối, kiểm tra `adb devices -l`, rồi bắt đầu trace mới.

## MCP có vẻ treo

`pnpm mcp:start` là stdio server và phải chờ client. Dùng health check hữu hạn:

```powershell
pnpm mcp:check
```

## Expo development build không kết nối Metro

```powershell
adb reverse tcp:8081 tcp:8081
pnpm --filter @rn-agent-observer/demo-expo start
```

Nếu native Android build lỗi đường dẫn quá dài, chạy `pnpm install --force` ở root để áp dụng virtual store ngắn, rồi `expo run:android` lại.

## Session/artifact ở đâu

`<target-project>/.artifacts/observer.sqlite` và `.artifacts/sessions/<session-id>/`. Xóa artifact chỉ khi chắc chắn không cần evidence; SQLite reference không chứa binary để khôi phục file đã xóa.

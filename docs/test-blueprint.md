# Lộ trình test chuẩn — RN Agent Observer Test Blueprint

Tài liệu này là **bộ tham chiếu chuẩn (golden test battery)** để test mọi app React Native/Expo bằng RN Agent Observer, đồng thời regression-test chính observer. Mọi phiên làm việc debug/metrics trên app mới đều quy về và ghi nhận theo ID case trong tài liệu này.

- Phiên bản blueprint: **1.4.0** (áp dụng observer 2.4.0, Android + Windows)
- App tham chiếu vàng (golden AUT): `apps/demo-expo` (`dev.rnagentobserver.demo`)
- App ngoài repo tham chiếu chế độ read-only: Vshop (`com.android.vshop`)
- Thiết bị xác minh gần nhất: `45218ba` — Xiaomi 23013PC75G, Android 15, 1080×2400, 120Hz
- Yêu cầu riêng cho DTL (từ 1.1.0): Metro chạy cho đúng app + `adb reverse tcp:8081 tcp:8081` (hoặc `RN_OBSERVER_METRO_URL` khi Metro dùng port khác); không mở React Native DevTools song song

---

## 1. Cách dùng tài liệu

1. Với **app mới**: chạy chương 4 (bring-up) → chọn tier theo mục đích → ghi kết quả theo template chương 9.
2. Với **observer thay đổi source**: tối thiểu T0 + nhóm bị ảnh hưởng; trước release chạy T2.
3. Mọi kết luận PASS/FAIL phải kèm **artifact path hoặc metric envelope** (chương 2.3). Không có evidence thì ghi `NOT VERIFIED — <lý do>`.
4. Khi thêm case mới: cấp ID theo namespace chưa dùng, cập nhật ma trận chương 5, bump phiên bản blueprint ở header.

## 2. Quy ước bắt buộc

### 2.1 Định danh case

```text
{DOMAIN}-{NNN}
```

| Domain | Phạm vi                                                                 |
| ------ | ----------------------------------------------------------------------- |
| `ENV`  | Môi trường, cài đặt, build                                              |
| `DEV`  | Device discovery & device info                                          |
| `APP`  | Vòng đời app (launch/reload/app ID)                                     |
| `SCR`  | Screenshot & UI tree                                                    |
| `INT`  | Tương tác (tap/swipe/type/back)                                         |
| `LOG`  | Logcat & lỗi có cấu trúc                                                |
| `PERF` | Performance snapshot (frame/memory/CPU/JS blocking)                     |
| `NET`  | Network evidence & redaction                                            |
| `REN`  | React render stats                                                      |
| `ANI`  | Animation & Reduce Motion                                               |
| `VIS`  | Visual comparison (pixel + structural)                                  |
| `SES`  | Session, artifact, SQLite                                               |
| `TRC`  | Perfetto trace                                                          |
| `DTL`  | DevTools export qua Metro CDP (2.1.0)                                   |
| `REC`  | Screen recording (2.2.0)                                                |
| `SNP`  | Ref snapshot + press/diff (2.3.0)                                       |
| `RPL`  | Replay script (2.3.0)                                                   |
| `ASM`  | Assert + a11y audit + app-data + routes + deep-link/permissions (2.3.0) |
| `DIA`  | Diagnosis rules                                                         |
| `OBS`  | `observe` tổng hợp                                                      |
| `INS`  | Instrumentation trong app                                               |
| `MCP`  | MCP protocol                                                            |
| `CLI`  | CLI contract                                                            |
| `SEC`  | Bảo mật/privacy                                                         |
| `STR`  | Stress & ổn định                                                        |
| `E2E`  | Workflow end-to-end before/after                                        |

### 2.2 Tier

| Tier | Tên        | Khi chạy                                 | Thời lượng ước tính |
| ---- | ---------- | ---------------------------------------- | ------------------- |
| T0   | Smoke      | Mỗi phiên làm việc / sau `pnpm build`    | ~10 phút            |
| T1   | Chuẩn      | Mỗi thay đổi core/adapter, mỗi ngày      | ~45 phút            |
| T2   | Sâu        | Trước release, bring-up app mới          | 2–4 giờ             |
| T3   | Thách thức | Thay đổi ADB/native/timer, nghi ngờ race | Không cố định       |

### 2.3 Quy ước evidence

- **Metric envelope**: mọi số liệu trích dẫn phải đủ `{ name, value, unit, source, timestamp, available }`. Metric `available: false` phải kèm `reason` — đây là kết quả hợp lệ, không phải failure.
- **Artifact**: đường dẫn tuyệt đối dưới `<projectRoot>/.artifacts/`. File phải tồn tại tại thời điểm báo cáo.
- **Không được**: chụp số từ trí nhớ, đổi UI FPS thành JS FPS, suy ra network timing khi không có instrumentation.
- **Finding = hypothesis có evidence**: kết quả `diagnose` không phải chân lý; case chỉ PASS khi evidence string chứa số đo khớp fixture.

### 2.4 Chuẩn bị môi trường chuẩn (mọi tier)

```powershell
# Từ repo observer
$env:RN_OBSERVER_PROJECT_ROOT = '<app-duoc-test>'   # demo: <repo>\apps\demo-expo
$env:RN_OBSERVER_DEVICE_ID   = '<serial>'           # VD: 45218ba
# RN_OBSERVER_APP_ID chỉ cần khi app.json không có expo.android.package
pnpm build   # CLI/MCP chạy thẳng dist — bắt buộc sau khi sửa source
adb devices -l
```

---

## 3. Chuẩn fixture cho app tham chiếu (AUT)

App được test bằng bộ này **nên** đáp ứng các yêu cầu sau để độ phủ tối đa. Thiếu mục nào thì các case liên quan chuyển thành `N/A — thiếu fixture` (không tính FAIL).

### 3.1 Yêu cầu với mọi AUT

| #    | Yêu cầu                                                   | Phục vụ        |
| ---- | --------------------------------------------------------- | -------------- |
| F-01 | Mọi phần tử tương tác chính có `testID` ổn định, duy nhất | INT, E2E       |
| F-02 | `app.json` khai báo `expo.android.package`                | APP            |
| F-03 | Development build (không Expo Go) khi cần instrumentation | INS, NET, REN  |
| F-04 | Cài `@rn-agent-observer/rn-instrumentation` ở dev build   | INS, NET, REN  |
| F-05 | Bọc app trong `<Profiler id="App" onRender={tracker}>`    | REN            |
| F-06 | Gọi `reportRoute(route)` khi đổi màn                      | OBS            |
| F-07 | Có màn danh sách dài (≥300 dòng) có thể scroll            | SCR, INT, PERF |
| F-08 | Có nút kích hoạt tác vụ JS tốn thời gian đo được          | PERF, DIA      |
| F-09 | Có fixture network tĩnh (không phụ thuộc Internet)        | NET            |
| F-10 | Có fixture visual toggle (BASELINE/REGRESSED)             | VIS            |

### 3.2 Snapshot instrumentation chuẩn

```tsx
import {
  createRenderTracker,
  installNetworkObserver,
  reportRoute,
} from '@rn-agent-observer/rn-instrumentation';
import { Profiler, useEffect, useMemo } from 'react';

const onRender = useMemo(() => createRenderTracker('App'), []);
useEffect(() => installNetworkObserver(), []);
useEffect(() => reportRoute(route), [route]);

return (
  <Profiler id="App" onRender={onRender}>
    {children}
  </Profiler>
);
```

### 3.3 Map testID chuẩn của golden AUT (demo-expo)

| Lab            | testID                                              | Kỳ vọng deterministic                                            |
| -------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| Home           | `open-{LabName}`                                    | Điều hướng 1 bước, route event đổi                               |
| PerformanceLab | `trigger-js-block`, `last-block`                    | JS block ≈ 100ms (±20%)                                          |
| NetworkLab     | `network-fast/500/2000/fail/body`, `network-result` | 0/500/2000ms + HTTP 503; token bị redact; body preview bị redact |
| RenderLab      | `rerender-list`, `render-count`                     | 100 row re-render mỗi lần bấm                                    |
| AnimationLab   | `animated-box`                                      | Native driver; tôn trọng Reduce Motion                           |
| ErrorLab       | `console-error/handled-error/unhandled-error`       | 3 loại lỗi vào logcat                                            |
| VisualLab      | `toggle-regression`, `visual-fixture`               | Toggle đổi màu/dịch chuyển/văn bản                               |
| Chung          | `back-button`                                       | Về Home                                                          |

---

## 4. Bring-up app mới (bắt buộc trước khi chạy tier nào)

```text
BU-1  Xác định app ID: app.json hoặc RN_OBSERVER_APP_ID        → APP-001..003
BU-2  devices/device-info/launch                                 → DEV-001..003, APP-004
BU-3  observe (include mặc định)                                 → OBS-001
BU-4  ui-tree: kiểm tra phủ testID của app (F-01)                → SCR-004
BU-5  Đánh giá instrumentation: có (F-04) hay không              → quyết định NET/REN chạy hay N/A
BU-6  Chọn tier: smoke debug = T0; bàn giao/release = T2
BU-7  App ngoài repo/không có source: khóa chế độ read-only       → SEC-006
```

Kết quả bring-up ghi vào báo cáo chương 9 mục "Phạm vi".

---

## 5. Ma trận tổng quan

| Nhóm (số case) | T0          | T1     | T2     | T3          |
| -------------- | ----------- | ------ | ------ | ----------- |
| ENV (7)        | 001–003     | tất cả | tất cả | —           |
| DEV (6)        | 001–002     | tất cả | tất cả | 006         |
| APP (7)        | 004–005     | tất cả | tất cả | 006         |
| SCR (8)        | 001–004     | tất cả | tất cả | 007         |
| INT (15)       | 001,004,012 | tất cả | tất cả | 006,013–015 |
| LOG (8)        | 001–002     | tất cả | tất cả | 007         |
| PERF (12)      | 001–005     | tất cả | tất cả | 012         |
| NET (14)       | 001–003,007 | tất cả | tất cả | 013         |
| REN (6)        | 001–002     | tất cả | tất cả | —           |
| ANI (4)        | 001         | tất cả | tất cả | —           |
| VIS (8)        | 001–002     | tất cả | tất cả | 005         |
| SES (11)       | 001–004     | tất cả | tất cả | 008         |
| TRC (7)        | 001–002     | tất cả | tất cả | 004         |
| DIA (12)       | 001,011     | tất cả | tất cả | —           |
| OBS (5)        | 001         | tất cả | tất cả | 005         |
| INS (8)        | —           | tất cả | tất cả | —           |
| MCP (8)        | 001         | tất cả | tất cả | 008         |
| CLI (6)        | 001–003     | tất cả | tất cả | —           |
| SEC (6)        | 001,005     | tất cả | tất cả | —           |
| STR (7)        | —           | —      | tất cả | tất cả      |
| E2E (6)        | —           | 001    | tất cả | —           |

Tổng: **~160 case** (tính cả biến thể).

---

## 6. Chi tiết case

> Format mỗi case: tiền điều kiện → thực thi → PASS → FAIL (nếu khác định nghĩa mặc định). Lệnh viết cho CLI; **map MCP tương đương ở 6.17** — ở tier T1 chạy cả bản MCP mirror của các case T0.

### 6.1 ENV — Môi trường

#### ENV-001 — Version khớp engines (T0)

- **Chạy**: `node --version; pnpm --version; adb version`
- **PASS**: Node ≥ 22.12, pnpm 9.6.x, adb bất kỳ ≥ 35. `packageManager: pnpm@9.6.0` khớp thực tế.

#### ENV-002 — Build sạch (T0)

- **Chạy**: `pnpm check`
- **PASS**: lint (max-warnings=0) → format:check → build → test đều exit 0.

#### ENV-003 — dist sẵn sàng (T0)

- **Chạy**: `Test-Path packages/cli/dist/index.js` và `Test-Path packages/mcp-server/dist/server.js`
- **PASS**: cả hai `True`. `pnpm rn-observe --version` in đúng `OBSERVER_VERSION`.

#### ENV-004 — Một device ready (T0/T1)

- **Chạy**: `adb devices -l`
- **PASS**: ≥1 dòng state `device`. State `unauthorized`/`offline` → FAIL với đề xuất chấp nhận prompt.

#### ENV-005 — Đúng app đích qua env

- **Chạy**: đặt `RN_OBSERVER_PROJECT_ROOT`, `RN_OBSERVER_DEVICE_ID`; `pnpm rn-observe status`
- **PASS**: `projectRoot` = app đích (resolve tuyệt đối); các lệnh đọc artifact dưới app đích.

#### ENV-006 — Nhiều device

- **Chuẩn bị**: cắm 2 device ready, **không** đặt `RN_OBSERVER_DEVICE_ID`.
- **Chạy**: `pnpm rn-observe devices` rồi lệnh cần selected device (VD `device-info`)
- **PASS**: device_list trả cả 2; `device-info` trả lỗi `MULTIPLE_DEVICES` (recoverable) thay vì chọn ngẫu nhiên.

#### ENV-007 — adb override

- **Chạy**: `$env:RN_OBSERVER_ADB='<đường-dẫn-adb-khác>'; pnpm rn-observe devices`
- **PASS**: dùng executable tùy chỉnh; xong env thì observer dùng lại `adb` mặc định.

#### ENV-008 — CDP queue giữa process (T1/T3)

- **Chạy**: khởi động đồng thời hai `devtools-export --duration 2000` cùng project/app/target.
- **PASS**: cả hai hoàn thành nối tiếp, tổng wall time xấp xỉ ≥4s; command thứ hai không cướp WebSocket; lock file được dọn sau success/error.
- **Timeout**: chờ quá 180s trả `CDP_LOCK_HELD` recoverable; không force-delete lock có PID còn sống.

### 6.2 DEV — Device

#### DEV-001 — device_list schema (T0)

- **Chạy**: `pnpm rn-observe devices`
- **PASS**: JSON `{ devices: Device[] }`, mỗi phần tử qua `DeviceSchema` (id, platform=android, state). `model` thay `_` bằng space.

#### DEV-002 — device_info đủ trường (T0)

- **Chạy**: `pnpm rn-observe device-info`
- **PASS**: `id` = serial đang chọn; `model` khớp vỏ máy; `osVersion` khớp Settings; `resolution` khớp `wm size` (ưu tiên Override nếu có); `densityDpi` > 0; `orientation` ∈ {portrait, landscape}.

#### DEV-003 — Orientation đổi theo máy (T1)

- **Chạy**: `device-info` → xoay máy (auto-rotate) → `device-info` lại
- **PASS**: orientation đổi tương ứng 0/2↔portrait, 1/3↔landscape; không cần relaunch.

#### DEV-004 — Resolution override

- **Chạy**: `adb shell wm size 1080x2340` → `device-info` → `adb shell wm size reset`
- **PASS**: resolution phản ánh Override (match cuối trong output), không phải chỉ Physical.

#### DEV-005 — Density

- **PASS**: `wm density` và `densityDpi` khớp nhau.

#### DEV-006 — Chọn đúng device qua env khi nhiều device (T3)

- **Chuẩn bị**: 2 device, đặt `RN_OBSERVER_DEVICE_ID` = serial 1.
- **PASS**: mọi lệnh shell chỉ đánh device 1 (kiểm tra qua model trả về); device 2 không bị tác động (kiểm tra bằng `adb -s <serial2> shell dumpsys activity activities | grep top`).

### 6.3 APP — Vòng đời app

#### APP-001 — App ID từ app.json (T0)

- **Chạy**: không đặt `RN_OBSERVER_APP_ID`; `pnpm rn-observe launch`
- **PASS**: response `appId` = `expo.android.package` của AUT.

#### APP-002 — Override env (T1)

- **Chạy**: `$env:RN_OBSERVER_APP_ID='dev.rnagentobserver.demo'` → `launch`
- **PASS**: ưu tiên env hơn app.json.

#### APP-003 — Không suy ra được app ID

- **Chuẩn bị**: trỏ `RN_OBSERVER_PROJECT_ROOT` vào thư mục không có `app.json` hợp lệ, bỏ env app ID.
- **PASS**: lỗi `APP_ID_NOT_FOUND`, recoverable, suggestion hướng dẫn set env/app.json.

#### APP-004 — Launch từ killed state (T0)

- **Chạy**: `adb shell am force-stop <appId>` → `pnpm rn-observe launch`
- **PASS**: `launched: true`; screenshot sau đó không phải màn hình home.

#### APP-005 — Reload = force-stop + relaunch (T0)

- **Chạy**: `pnpm rn-observe reload` hai lần liên tiếp
- **PASS**: `reloaded: true`; PID app thay đổi giữa 2 lần (so `adb shell pidof <appId>` trước/sau); route về initial route (verify `observe` → route).

#### APP-006 — App chưa cài (T3)

- **Chạy**: `RN_OBSERVER_APP_ID='dev.not.installed'` → `launch`
- **PASS**: monkey trả nonzero → lỗi `ADB_COMMAND_FAILED` recoverable, message chứa stderr adb, không crash process.

#### APP-007 — Cold start đến evidence đầu tiên

- **Chạy**: force-stop → `launch` → ngay `observe`
- **PASS**: observe hoàn thành, logs/perf có thể thưa (app mới khởi động) nhưng response schema hợp lệ; SLA mềm ≤ 60s trên device thật.

### 6.4 SCR — Screenshot & UI tree

#### SCR-001 — Screenshot đúng màn hình (T0)

- **Chạy**: `pnpm rn-observe screenshot`
- **PASS**: artifact `.png` tồn tại; `screen.width×height` = resolution device (captcha pixel: mở PNG kiểm tra không trắng toàn màn trừ màn thật trắng); `orientation` đúng.

#### SCR-002 — Artifact + SQLite reference (T1)

- **PASS**: response `artifactId`; `session get` (nếu có session) liệt kê artifact cùng id, `path` tồn tại; MIME `image/png`.

#### SCR-003 — UI tree schema (T0)

- **Chạy**: `pnpm rn-observe ui-tree`
- **PASS**: `roots` mảng; `source: 'android-uiautomator'`; `timestamp` ISO; file JSON tại `artifactPath` parse được và khớp response.

#### SCR-004 — testID phủ semantics (T0)

- **Chạy**: `ui-tree` ở màn có nút known-testID
- **PASS**: flatten tree có node `id` = testID (resource-id dạng `pkg:id/testID` được chuẩn hóa thành `testID`), có `bounds`.

#### SCR-005 — Bounds trong màn hình (T1)

- **PASS**: với mọi node có bounds: `x ≥ 0`, `y ≥ 0`, `x+width ≤ screenW+1`, `y+height ≤ screenH+1`.

#### SCR-006 — Landscape (T1)

- **Chạy**: xoay ngang → `screenshot` + `ui-tree`
- **PASS**: screenshot `orientation: landscape` (width > height); ui-tree bounds tỷ lệ theo trục mới.

#### SCR-007 — Cây lớn không treo (T2/T3)

- **Fixture**: PerformanceLab (500-row FlatList) hoặc màn ≥1000 node
- **PASS**: `ui-tree` hoàn thành, elementCount > 500; response không nhét binary; observer không OOM.

#### SCR-008 — File artifact tái sử dụng cho compare (T1)

- **PASS**: đường dẫn ở `artifactPath` dùng trực tiếp được cho `compare` (VIS-002).

### 6.5 INT — Tương tác

> Nguyên tắc: semantic trước, tọa độ sau. Chỉ dùng tọa độ lấy từ `ui-tree` bounds của chính lần chạy đó.

#### INT-001 — Tap testID điều hướng (T0)

- **Chạy**: `pnpm rn-observe tap --test-id open-PerformanceLab` → `observe`
- **PASS**: `performed: true`; route mới = PerformanceLab (qua route event nếu có instrumentation, không thì qua ui-tree thấy `trigger-js-block`).

#### INT-002 — Tap theo accessibilityLabel (T1)

- **PASS**: tap với label của Pressable (VD `Back`) điều hướng đúng; observer match qua `contentDescription`.

#### INT-003 — Tap theo text (T1)

- **PASS**: tap theo text hiển thị (VD `Home`) hoạt động khi không có testID/label.

#### INT-004 — Tap tọa độ (T0)

- **Chạy**: lấy bounds node từ `ui-tree`, tính center → `tap --x --y`
- **PASS**: hiệu ứng như INT-001 (cùng node).

#### INT-005 — testID không tồn tại

- **Chạy**: `tap --test-id khong-ton-tai`
- **PASS**: lỗi `UI_ELEMENT_NOT_FOUND`, recoverable, suggestion chỉ cách inspect ui-tree.

#### INT-006 — Element không bounds/invisible (T3)

- **Fixture**: node `displayed="false"` hoặc ngoài viewport
- **PASS**: không tìm thấy bounded element → `UI_ELEMENT_NOT_FOUND`; không tap vào (0,0).

#### INT-007 — Thiếu tọa độ hợp lệ

- **Chạy**: `tap --x abc` hoặc chỉ `--x`
- **PASS**: `INVALID_ARGUMENT`; **tuyệt đối không** gửi `NaN` cho adb (kiểm tra không có chuỗi `NaN` trong stderr/lệnh).

#### INT-008 — Swipe scroll (T1)

- **Chạy**: `swipe --from 540,1800 --to 540,500 --duration 500` trong list dài
- **PASS**: `ui-tree` sau đó lộ item index cao hơn (VD `Performance row 50` xuất hiện).

#### INT-009 — Swipe duration tùy chỉnh (T1)

- **PASS**: duration ngắn (200ms) vẫn scroll; duration ≤ 0 → `INVALID_ARGUMENT`.

#### INT-010 — Swipe tọa độ rác (T1)

- **Chạy**: `swipe --from a,b --to c,d`
- **PASS**: `INVALID_ARGUMENT` trước khi gọi adb.

#### INT-011 — Type text có khoảng trắng (T1)

- **Fixture**: màn có TextInput focus
- **Chạy**: `type-text --text 'hello world'`
- **PASS**: field nhận đủ 11 ký tự (khoảng trắng encode `%s` cho `adb input text`).

#### INT-012 — Back (T0)

- **Chạy**: vào Lab → `pnpm rn-observe back`
- **PASS**: về Home (ui-tree thấy `open-PerformanceLab`).

#### INT-013 — Chuỗi 20 bước không trôi trạng thái (T3)

- **Kịch bản**: Home→Lab→Back→Lab khác→scroll→back… 20 lệnh
- **PASS**: mọi lệnh exit 0; trạng thái cuối khớp kịch bản; không có bước nào treo > 30s.

#### INT-014 — Double-tap nhanh (T3)

- **PASS**: 2 tap liên tiếp cùng node trong < 1s: app xử lý theo semantics của nó; observer không lỗi; mỗi tap được record đúng thứ tự trong session timeline.

#### INT-015 — Ký tự đặc biệt trong text (T3)

- **Chạy**: `type-text --text 'a&b"c'`
- **PASS**: không injection lệnh adb (argument array); ký tự adb không hỗ trợ có thể thiếu trên device — ghi nhận thực tế, observer không crash.

### 6.6 LOG — Logcat

#### LOG-001 — Schema LogEntry (T0)

- **Chạy**: `pnpm rn-observe logs --limit 100`
- **PASS**: mảng `{level, message, source, timestamp}` hợp lệ; level ∈ enum 6 giá trị; timestamp ISO từ epoch logcat.

#### LOG-002 — Filter level (T0)

- **Chạy**: `logs --level error`
- **PASS**: 100% phần tử `level: 'error'`.

#### LOG-003 — Filter keyword (T1)

- **Chạy**: trigger console-error ở ErrorLab → `logs --keyword 'Demo handled'`
- **PASS**: mọi message chứa keyword (case-insensitive); có entry từ source `ReactNativeJS`.

#### LOG-004 — Limit (T1)

- **Chạy**: `logs --limit 10` so `--limit 500`
- **PASS**: số dòng ≤ limit; limit lớn hơn buffer logcat không gây lỗi.

#### LOG-005 — console.error từ app (T1)

- **PASS**: entry error với message khớp chuỗi fixture xuất hiện trong 30s sau khi tap `console-error`.

#### LOG-006 — Unhandled exception (T1)

- **PASS**: tap `unhandled-error` → exception vào logcat với stack; quan sát thấy các dòng `at ...` — chúng **phải bị loại** khỏi error summary của `observe`/`diagnose` (chỉ message chính giữ lại).

#### LOG-007 — Volume lớn (T2/T3)

- **Chạy**: `logs --limit 5000` (MCP) / 2000 (internal window)
- **PASS**: parse không treo; số entry ≤ limit; memory observer ổn.

#### LOG-008 — Event instrumentation trong log (T1)

- **Chạy**: `logs --keyword RN_AGENT_OBSERVER --limit 2000` sau khi tap fixture
- **PASS**: thấy dòng prefix `RN_AGENT_OBSERVER_NETWORK/RENDER/ROUTE/JS_TASK` + JSON payload — đầu vào cho NET/REN/OBS.

### 6.7 PERF — Performance

#### PERF-001 — Envelope chuẩn (T0)

- **Chạy**: `pnpm rn-observe performance`
- **PASS**: 10 metric tên đúng bộ: `ui_fps, frame_time_ms, worst_frame_ms, dropped_frames, frame_sample_count, display_refresh_hz, memory_mb, cpu_percent, js_fps, js_blocking_ms`; mỗi metric đủ 5 trường chương 2.3; `available` nhất quán với `value` (null ⇔ false, trừ khi có override instrumentation).

#### PERF-002 — ui_fps hợp lệ (T0)

- **PASS**: khi có frame data: `0 < ui_fps ≤ display_refresh_hz`; `frame_sample_count ≤ 240`.

#### PERF-003 — js_fps trung thực (T0)

- **PASS**: luôn `value: null, available: false`, reason nêu rõ ADB không có tín hiệu đáng tin — **kể cả khi app đang animation**.

#### PERF-004 — js_blocking khi không có instrumentation (T0)

- **PASS**: `available: false`, reason chỉ rõ cần runtime instrumentation.

#### PERF-005 — js_blocking phản ánh fixture 100ms (T0)

- **Chạy**: `tap --test-id trigger-js-block` → `performance` (trong 5 phút)
- **PASS**: `js_blocking_ms available: true`, value ∈ [80, 120]ms, source = instrumentation, confidence 0.99. Sau 5 phút không trigger lại → metric trở lại unavailable.

#### PERF-006 — Sustained FPS ≠ worst frame (T1)

- **Kỳ vọng**: một block 100ms đơn lẻ có thể không kéo `ui_fps` (trung bình cửa sổ) — nhưng `worst_frame_ms` phản ánh cú giật. **PASS** khi báo cáo không tuyên bố sai logic này.

#### PERF-007 — dropped_frames nhất quán (T1)

- **PASS**: `dropped_frames` = số frame có frame_time > `1000/display_refresh_hz` trong sample; kiểm chứng bằng cách recompute từ artifact trace/log nếu cần.

#### PERF-008 — memory_mb (T1)

- **Chạy**: `performance` 2 lần cách 10s
- **PASS**: > 0; dao động giữa 2 lần < 30% khi app idle; nguồn `adb-dumpsys-meminfo` (TOTAL PSS).

#### PERF-009 — cpu_percent (T1)

- **PASS**: ≥ 0; cho phép > 100 (multi-core, ghi rõ trong docs); là snapshot một lần `top -n 1`.

#### PERF-010 — display_refresh_hz (T1)

- **PASS**: khớp.device thật (VD 120 trên 45218ba); fallback 60 chỉ khi dumpsys không có renderFrameRate.

#### PERF-011 — Animation không chặn JS (T1)

- **Chạy**: vào AnimationLab 30s → `performance`
- **PASS**: `js_blocking_ms` không tăng (native driver); frame metrics có sample.

#### PERF-012 — App background/không chạy (T3)

- **Chạy**: force-stop app → `performance`
- **PASS**: metrics app-specific unavailable có reason; process metrics null/available:false; không crash; error recoverable.

#### PERF-013 — Không tái dùng gfx frame window cũ (T1)

- **Chạy**: gọi `performance` hai lần liên tiếp mà không tạo frame mới.
- **PASS**: lần sau cùng signature trả 5 frame metrics `available: false`, `value: null`, reason bắt đầu `No new gfx frame samples since`; memory/CPU/refresh rate không bị vô hiệu.

### 6.8 NET — Network

#### NET-001 — Không instrumentation = rỗng trung thực (T0)

- **AUT**: app không cài instrumentation (VD Vshop)
- **Chạy**: `pnpm rn-observe network summary`
- **PASS**: `requestCount: 0`, percentiles null — **không phải lỗi**, không bịa số.

#### NET-002 — Fixture fast (T0)

- **Chạy**: tap `network-fast` → `network requests`
- **PASS**: 1 request mới, status 200, durationMs < 100ms (fixture ~0ms).

#### NET-003 — Fixture 500ms (T0)

- **PASS**: durationMs ∈ [450, 600].

#### NET-004 — Fixture 2000ms (T1)

- **PASS**: durationMs ∈ [1900, 2150]; xuất hiện trong `slowestEndpoints` (top 5 theo duration giảm dần).

#### NET-005 — Fixture lỗi 503 (T1)

- **PASS**: `failedRequests` đếm request có error hoặc status ≥ 400; request 503 có `error: 'HTTP 503'`.

#### NET-006 — Percentile đúng toán (T1)

- **Fixture**: bấm fast ×5, 500 ×3, 2000 ×1 → `network summary`
- **PASS**: 9 request; p50 = 500-nhóm; p95/p99 = 2000; averageLatency = (0×5 + 500×3 + 2000×1)/9 ≈ 389ms (±dung sai fixture).

#### NET-007 — Redact access_token (T0)

- **Chạy**: bấm bất kỳ nút NetworkLab (URL fixture chứa `access_token=demo-secret`) → `network requests` + grep toàn bộ `.artifacts`
- **PASS**: không xuất hiện `demo-secret`; query param thành `[REDACTED]`; tham số vô hại (`delay`) giữ nguyên.

#### NET-008 — Redact PII (T1)

- **PASS**: `email/phone/ssn` trong URL/body preview đều `[REDACTED]`.

#### NET-009 — Body capture mặc định OFF (T0)

- **PASS**: response không có `requestBodyPreview`/`responseBodyPreview` ở cấu hình mặc định.

#### NET-010 — Body capture opt-in dev-only (T2)

- **Chạy**: cài `installNetworkObserver(createInstrumentationConfig(true, true))` trong dev build → thực hiện request → `network requests`
- **PASS**: preview xuất hiện, ≤ 4096 ký tự; console in cảnh báo lộ dữ liệu; cảm biến nhạy cảm trong body bị redact.

#### NET-011 — totalBytes chỉ cộng có sẵn (T1)

- **PASS**: `totalBytes` = Σ requestBytes + responseBytes của những request có field; request thiếu byte không được suy bù.

#### NET-012 — Fetch thật (không phải report tay) (T2)

- **Fixture**: AUT gọi `fetch` thật (VD tới Metro/local server) với observer đã cài
- **PASS**: event phát ra với method đúng (GET/POST), status, duration; responseBytes từ content-length khi có.

#### NET-013 — Network error/abort (T3)

- **Fixture**: fetch tới host không tồn tại/tự abort
- **PASS**: event có `error` message, durationMs đo được, không crash app; rethrow giữ nguyên behavior cho app.

#### NET-014 — reportNetworkRequest thủ công (T1)

- **PASS**: API tay phát event đầy đủ field; id monotonic `${timestamp}-${seq}` không trùng trong session.

### 6.9 REN — React render

#### REN-001 — render-stats schema (T0)

- **Chạy**: `pnpm rn-observe render-stats`
- **PASS**: mảng `{componentName, renderCount, renderDurationMs, commitCount, changedProps, timestamp, source}`; source `react-profiler`.

#### REN-002 — RenderLab tăng count (T0)

- **Chạy**: đọc count ban đầu → tap `rerender-list` ×3 → đọc lại
- **PASS**: renderCount của tracker tăng đúng số lần bấm (mỗi lần +1 event, count cumulative).

#### REN-003 — componentName đúng (T1)

- **PASS**: tracker demo báo `DemoApp`; tracker đặt tên khác báo đúng tên đặt.

#### REN-004 — Duration/commit (T1)

- **PASS**: `renderDurationMs ≥ 0`; `commitCount` không nhỏ hơn `renderCount` trong tracker demo.

#### REN-005 — Component tĩnh không lên finding (T2)

- **PASS**: component render < 10 lần không xuất hiện trong finding DIA-007.

#### REN-006 — DIA gom theo component (T1)

- **Fixture**: nhiều event cùng component trong window log
- **PASS**: diagnosis dùng renderCount **lớn nhất** mỗi component, không liệt kê từng event lặp.

### 6.10 ANI — Animation

#### ANI-001 — Fixture hiển thị (T0)

- **PASS**: `animated-box` có trong ui-tree với bounds hợp lệ khi ở AnimationLab.

#### ANI-002 — Native driver không chặn JS (T1)

- **PASS**: trong 30s animation, không có JS_TASK event mới > 40ms (log filter `RN_AGENT_OBSERVER_JS_TASK`).

#### ANI-003 — Reduce Motion (T2)

- **Chạy**: bật Reduce Motion trong Accessibility → vào AnimationLab
- **PASS**: animation không chạy (fixture kiểm tra `AccessibilityInfo.isReduceMotionEnabled`); observer vẫn quan sát được màn hình tĩnh.

#### ANI-004 — Frame metrics khi animation (T1)

- **PASS**: `frame_sample_count` > 0 và `worst_frame_ms` có giá trị trong lúc animation chạy.

### 6.11 VIS — Visual comparison

#### VIS-001 — Cùng ảnh (T0)

- **Chạy**: `pnpm rn-observe compare <a.png> <a.png>`
- **PASS**: `similarity: 1`, `changedPixels: 0`, `changedRegions: []`, có `diffArtifact`.

#### VIS-002 — VisualLab toggle (T0)

- **Chạy**: chụp trước (BASELINE) → tap `toggle-regression` → chụp sau → `compare` kèm `--before-ui/--after-ui`
- **PASS**: similarity < 1; `changedRegions[0]` bounding box nằm trong/bao vùng fixture (không phủ cả màn); `changedPixels` > 0.

#### VIS-003 — Structural diff (T1)

- **PASS**: `uiStructure.added`/`removed`/`changed` phản ánh đúng: text node đổi `BASELINE`↔`REGRESSED` nằm ở `changed`; không có false added trên node đồng định.

#### VIS-004 — Semantic key ưu tiên (T1)

- **PASS**: node đổi bounds/text nhưng giữ resource-id → vào `changed` (không phải removed+added).

#### VIS-005 — Khác kích thước (T1/T3)

- **Chạy**: compare ảnh portrait với ảnh landscape
- **PASS**: lỗi `DIMENSION_MISMATCH`, recoverable, suggestion chụp cùng device + orientation.

#### VIS-006 — Flag đơn lẻ (T1)

- **Chạy**: `compare a.png b.png --before-ui t.json`
- **PASS**: từ chối — phải cung cấp cả hai UI tree hoặc không flag nào.

#### VIS-007 — Diff artifact (T1)

- **PASS**: file diff PNG tồn tại, kích thước = ảnh gốc; vùng khác nhau tô đỏ (pixel đỏ thuần).

#### VIS-008 — Công thức similarity (T2)

- **PASS**: `similarity = 1 - changedPixels / (width×height)` — kiểm chứng bằng số tay trên cặp ảnh nhỏ.

### 6.12 SES — Session & artifact

#### SES-001 — start (T0)

- **Chạy**: `pnpm rn-observe session start`
- **PASS**: trả `id` UUID, `status: 'active'`, `startedAt` ISO; thư mục `.artifacts/sessions/<id>/` được tạo.

#### SES-002 — Timeline đúng thứ tự (T1)

- **Chạy**: start (set env `RN_OBSERVER_SESSION_ID`) → tap → screenshot → `session get`
- **PASS**: timeline có event `tap` rồi `screenshot` đúng thứ tự thời gian; data event khớp (target tap, artifactId).

#### SES-003 — Artifact reference (T1)

- **PASS**: `artifacts[]` mỗi phần tử có path tồn tại + kind đúng (`screenshot`, `ui-tree`, `trace`, `summary`…).

#### SES-004 — Bền qua nhiều process (T0)

- **Chạy**: mỗi lệnh CLI là một process riêng (đúng hiện trạng) với cùng `RN_OBSERVER_SESSION_ID`
- **PASS**: mọi event/artifact ghi vào cùng session; timeline order ổn định theo autoincrement id.

#### SES-005 — stop tạo summary (T1)

- **PASS**: `summary.json` tại `.artifacts/sessions/<id>/summaries/`; nội dung có `eventCount`, `artifactCount`, `eventTypes` (unique) khớp `session get`; status → `complete`, có `stoppedAt`.

#### SES-006 — get đầy đủ, không binary (T1)

- **PASS**: `get` trả toàn bộ timeline + metadata artifact; **không** chứa base64/blob.

#### SES-007 — stop hai lần (T1)

- **PASS**: lần 2 lỗi `SESSION_NOT_ACTIVE`, recoverable.

#### SES-008 — start khi đã active (T3)

- **Chuẩn bị**: process giữ session active (MCP server dài hạn) → start lần 2
- **PASS**: lỗi `SESSION_ALREADY_ACTIVE`; không corrupt SQLite.

#### SES-009 — Standalone khi không session (T1)

- **PASS**: screenshot không session → artifact dưới `sessions/standalone/screenshots/`.

#### SES-010 — SQLite chỉ metadata (T2)

- **PASS**: kích thước `observer.sqlite` ≪ tổng dung lượng artifact của session (chỉ chứa JSON metadata/path).

#### SES-011 — WAL an toàn đồng thời (T2)

- **Chạy**: 2 terminal chạy lệnh observer cùng lúc trên cùng project root
- **PASS**: không lỗi database locked nghiêm trọng; event cả hai tiến trình đều được ghi (journal_mode WAL).

#### SES-012 — Retention cleanup (T1/T3)

- **Chạy**: tạo completed session cũ + active session cũ; chạy dry-run rồi cleanup thật trên fixture tạm.
- **PASS**: dry-run không xóa; cleanup thật chỉ xóa completed session, đếm file/bytes và xóa SQLite trong transaction; active session luôn còn.

#### SES-013 — Cảnh báo thiếu session (T0)

- **Chạy**: bỏ `RN_OBSERVER_SESSION_ID`, gọi `app-state`.
- **PASS**: data vẫn trả; stderr có `EVIDENCE_NOT_RECORDED` + hướng dẫn session; một core instance chỉ cảnh báo một lần.

### 6.13 TRC — Perfetto trace

#### TRC-001 — start (T0)

- **Chạy**: `pnpm rn-observe trace start --duration 10000`
- **PASS**: trả `id`, `source: 'android-perfetto'`, `startedAt`; state file `.artifacts/active-traces/<id>.json` tồn tại.

#### TRC-002 — stop ở process khác (T0)

- **Chạy**: `trace stop <id>` từ terminal mới
- **PASS**: artifact `.perfetto-trace` kéo về, kích thước > 0 (thường ≥ 100KB với 10s); state file bị xóa; remote path trên device bị dọn (`adb shell ls /data/misc/perfetto-traces/` sạch với id đó).

#### TRC-003 — Duration clamp (T1)

- **Chạy**: `trace start --duration 999999`
- **PASS**: clamp còn 300s; `--duration 1` vẫn chạy (tối thiểu 1s).

#### TRC-004 — Trace không tồn tại (T1/T3)

- **Chạy**: `trace stop id-rác`
- **PASS**: lỗi `TRACE_NOT_ACTIVE`, recoverable; không tạo artifact rỗng.

#### TRC-005 — Trace trong session (T1)

- **PASS**: start khi có session → artifact gắn sessionId; `session get` liệt kê trace artifact.

#### TRC-006 — File hợp lệ (T2)

- **PASS**: mở bằng Perfetto UI (ui.perfetto.dev) thấy được track sched/gfx; không phải file 0 byte (TRC-002 đã đảm bảo > 0).

#### TRC-007 — Stop sau khi duration hết (T3)

- **Chạy**: start 5s → đợi 8s → stop
- **PASS**: perfetto tự kết thúc; stop vẫn pull được file; kill -INT pid cũ không gây lỗi (catch).

### 6.14 DIA — Diagnosis rules

> Mỗi rule: trigger bằng fixture tương ứng, đọc `findings[]`.

#### DIA-001 — Long JS task, FPS thường (T0)

- **Fixture**: `trigger-js-block` (FPS demo thường ≥ 45)
- **PASS**: finding `'Long JS task observed'`; severity theo configured threshold; evidence có duration + threshold; `confidenceBasis` ghi signal/source strength và không phải xác suất.

#### DIA-002 — FPS thấp + JS block (T1)

- **Fixture**: cần AUT gây FPS < 45 bền (list nặng + animation tốn CPU); nếu demo không tạo được → `N/A — thiếu fixture`
- **PASS**: finding `'JS thread blocking likely contributes to frame drops'` khi vượt configured thresholds; confidence tăng theo deficit/sample strength và bị gate thấp khi chỉ có 1 frame.

#### DIA-003 — FPS thấp không có JS data (T1)

- **PASS**: finding `'Low UI frame rate observed'`; recommendation hướng dẫn capture trace; severity high khi < 30.

#### DIA-004 — Request chậm (T1)

- **Fixture**: `network-2000`
- **PASS**: finding `'Slow network requests observed'`; severity high khi có request > 2000ms; evidence format `GET <url>: <ms>ms` (max 5).

#### DIA-005 — Rerender (T1)

- **Fixture**: `rerender-list` ×≥10
- **PASS**: finding `'Potential unnecessary React re-renders'`; evidence `DemoApp: <n> renders`; confidence tăng theo render excess + số observation, không phải hằng số.

#### DIA-006 — Runtime errors (T1)

- **Fixture**: `console-error` / `unhandled-error`
- **PASS**: finding `'Runtime errors captured'`; severity high (critical khi fatal); evidence chứa đúng message fixture; các dòng `at ...` bị loại.

#### DIA-007 — Bỏ source hệ thống (T2)

- **PASS**: log error từ source `FramePredict` không sinh finding.

#### DIA-008 — Stack frame bị loại (T1)

- **PASS**: message khớp regex `^\s*at\s` không nằm trong evidence.

#### DIA-009 — Không evidence → rỗng (T0)

- **Fixture**: màn Home sạch, không fixture nào bấm
- **PASS**: `findings: []` — không bịa finding.

#### DIA-010 — Evidence chứa số đo (T1)

- **PASS**: mọi finding có ≥1 evidence string chứa số liệu định lượng (ms/fps/count).

#### DIA-011 — Deterministic (T2)

- **Chạy**: cùng input → diagnose 5 lần
- **PASS**: 5 output JSON giống hệt nhau (trừ timestamp).

#### DIA-012 — Nhiều finding cùng lúc (T2)

- **Fixture**: bấm JS block + network 2000 + console-error rồi `diagnose`
- **PASS**: ≥3 findings, mỗi cái đúng rule tương ứng, không triệt tiêu lẫn nhau.

#### DIA-013 — Threshold config + confidence data-derived (T0/T1)

- **Unit**: cùng violation, 1 sample cho confidence thấp hơn 120 sample; violation nặng hơn không cho confidence thấp hơn violation nhẹ cùng evidence strength.
- **CLI/MCP**: override đủ 7 threshold; evidence in threshold thực dùng. Quan hệ sai hoặc giá trị NaN/≤0 trả lỗi recoverable trước khi đo.
- **Contract**: mọi finding có `confidenceBasis`, score ≤0.99 và dòng `Score is not a statistical probability`.

### 6.15 OBS — observe tổng hợp

#### OBS-001 — Default đủ 6 mục (T0)

- **Chạy**: `pnpm rn-observe observe`
- **PASS**: có `screen`, `uiTree.elementCount`, `route` (null OK khi không instrumentation), `performance`, `network`, `logs` (count + errors ≤ 20).

#### OBS-002 — include subset (T1)

- **Chạy**: MCP `observe_screen` với `include: ['performance']`
- **PASS**: response chỉ có performance (+ timestamp/route null); không screenshot artifact sinh ra.

#### OBS-003 — Compact (T1)

- **PASS**: response không chứa cây UI đầy đủ, không chứa log thô — chỉ count + errors 20 mục cuối.

#### OBS-004 — Route từ instrumentation (T1)

- **Chạy**: điều hướng qua các Lab → `observe`
- **PASS**: `route` = Lab cuối cùng (event ROUTE gần nhất).

#### OBS-005 — SLA (T2/T3)

- **PASS**: observe full trên device thật hoàn thành ≤ 60s (mục tiêu mềm ≤ 30s); không request nào con treo vĩnh viễn (timeout mặc định 30s/lệnh adb).

### 6.16 INS — Instrumentation (chạy trong AUT dev build)

#### INS-001 — Patch + restore fetch (T1)

- **PASS**: `installNetworkObserver()` trả hủy cài; gọi hủy → `globalThis.fetch` về bản gốc (`fetch === original`).

#### INS-002 — Config mặc định (T1)

- **PASS**: `createInstrumentationConfig(true)` = `{ enabled: true, captureNetworkBodies: false, maxBodyPreviewCharacters: 4096 }`.

#### INS-003 — Route event (T1)

- **PASS**: `reportRoute('X')` phát dòng `RN_AGENT_OBSERVER_ROUTE {"route":"X",...}` vào console; observer parse được (LOG-008).

#### INS-004 — JS task event (T1)

- **PASS**: `reportJsTask(123, 'label')` phát event đúng field; **chỉ dùng cho task có thật** — không gọi định kỳ (overhead).

#### INS-005 — Render tracker (T1)

- **PASS**: mỗi lần React commit, count tăng 1 và event phát 1 lần (không nhân theo node con).

#### INS-006 — redactUrl chọn lọc (T1)

- **PASS**: `?q=safe` giữ nguyên; các key nhạy cảm (token/email/…) `[REDACTED]`; URL không parse được vẫn được redact bằng regex fallback.

#### INS-007 — redactSensitiveText (T1)

- **PASS**: các cặp `authorization/cookie/x-api-key/...: value` thành `[REDACTED]`; cắt 4096 ký tự.

#### INS-008 — Không chạy production (T2)

- **PASS**: code review + build flag — instrumentation chỉ import trong dev build; bản release không phát event nào (grep log).

### 6.17 MCP — Protocol

**Map CLI ↔ MCP** (dùng cho mirror T1):

| CLI                        | MCP tool                                   |
| -------------------------- | ------------------------------------------ |
| `status`                   | `observer_status`                          |
| `devices`                  | `device_list`                              |
| `device-info`              | `device_info`                              |
| `launch`                   | `app_launch`                               |
| `reload`                   | `app_reload`                               |
| `screenshot`               | `screenshot`                               |
| `ui-tree`                  | `get_ui_tree`                              |
| `tap`                      | `tap`                                      |
| `swipe`                    | `swipe`                                    |
| `type-text`                | `type_text`                                |
| `back`                     | `back`                                     |
| `logs`                     | `get_logs`                                 |
| `performance`              | `performance_snapshot`                     |
| `trace start/stop`         | `start_trace/stop_trace`                   |
| `render-stats`             | `get_react_render_stats`                   |
| `network requests/summary` | `get_network_requests/get_network_summary` |
| `observe`                  | `observe_screen`                           |
| `session start/stop/get`   | `start_session/stop_session/get_session`   |
| `diagnose`                 | `diagnose`                                 |
| `compare`                  | `compare_screens`                          |
| `app-state`                | `app_state`                                |
| `device-network`           | `get_device_network`                       |
| `devtools-export`          | `devtools_export`                          |
| `metro-network`            | `get_metro_network`                        |
| `devtools-profile`         | `devtools_profile`                         |
| `record start/stop`        | `start_recording/stop_recording`           |
| `reload --fast`            | `app_reload` mode=metro                    |

#### MCP-001 — Handshake + đủ tools (T0)

- **Chạy**: `pnpm mcp:check`; test in-memory (`server.test.ts`) hoặc client thật
- **PASS**: khởi tạo OK; `listTools` trả đủ 31 tools (2.2.0), tên `verb_noun` chuẩn.

#### MCP-002 — Input schema Zod (T1)

- **PASS**: mọi tool có inputSchema; sai type input → lỗi schema rõ ràng (không crash server).

#### MCP-003 — observer_status (T1)

- **PASS**: `phase: 'android-v1'`, version khớp CLI `--version`.

#### MCP-004 — tap refine (T1)

- **Chạy**: gọi `tap` không testID và không đủ x/y
- **PASS**: refine error `'Provide testID or x and y'`.

#### MCP-005 — compare cặp UI tree (T1)

- **PASS**: truyền 1 trong 2 `before_ui_tree/after_ui_tree` → lỗi `'Provide both UI tree paths or neither'`.

#### MCP-006 — Error contract (T1)

- **Fixture**: gây `DEVICE_NOT_FOUND`
- **PASS**: response `isError: true`, structuredContent = `{error: {code, message, recoverable, suggestion}}`; **không có stack trace**.

#### MCP-007 — Env truyền qua config client (T1)

- **Chạy**: config client kèm `env` chương 2.4
- **PASS**: observer dùng đúng app/device (kiểm tra qua `observer_status` projectRoot).

#### MCP-008 — Hai client song song (T3)

- **Chạy**: 2 client stdio cùng lúc
- **PASS**: mỗi server instance độc lập; không tranh chấp `.artifacts/active-traces`; session tách riêng (id khác nhau).

### 6.18 CLI — Contract

#### CLI-001 — help (T0)

- **PASS**: `rn-observe --help` exit 0; text liệt kê đủ nhóm lệnh + env.

#### CLI-002 — version (T0)

- **PASS**: `--version` khớp `packages/core/package.json` — package metadata là nguồn duy nhất, không có version constant viết tay thứ hai.

#### CLI-003 — Unknown command (T0)

- **PASS**: exit code 2; stderr là JSON `{error: {code: 'INTERNAL_ERROR', ...}}`; stdout rỗng.

#### CLI-004 — Stdout luôn JSON (T1)

- **PASS**: mọi lệnh thành công in đúng 1 JSON document parse được (không lẫn log người).

#### CLI-005 — Không stack trace (T1)

- **PASS**: lỗi in qua `ObserverError.toJSON()` — không chứa `stack`.

#### CLI-006 — Flag bắt buộc (T1)

- **Chạy**: `type-text` thiếu `--text`
- **PASS**: exit 2, message rõ `'--text is required'`.

### 6.19 SEC — Bảo mật & privacy

#### SEC-001 — Không secret trong artifact mặc định (T0)

- **Chạy**: chạy trọn T0 với demo (có token trong URL fixture) → quét toàn bộ `.artifacts`
- **PASS**: `demo-secret` không xuất hiện ở bất kỳ file nào (sqlite/png/json/trace tên không chứa).

#### SEC-002 — Redact trước khi persist (T1)

- **PASS**: redact xảy ra ở tầng instrumentation **trước khi** emit log → mọi artifact hạ nguồn đã sạch.

#### SEC-003 — Warning body capture (T1)

- **PASS**: bật `captureNetworkBodies` in cảnh cáo rõ ràng một lần.

#### SEC-004 — MCP không binary (T1)

- **PASS**: không có base64/blob trong bất kỳ MCP response nào (screenshot trả artifactId/path).

#### SEC-005 — Observer không tự thao tác nhạy cảm (T0)

- **PASS**: suốt battery, mọi thao tác đều do case chỉ định; không có lệnh nào tự ý mua/đăng nhập/đổi cài đặt app.

#### SEC-006 — App ngoài repo read-only (T0/T1)

- **AUT**: Vshop
- **PASS**: chỉ dùng lệnh quan sát (devices/device-info/screenshot/ui-tree/logs/performance/observe/session/trace/compare); **cấm**: tap vào nút mua/queue/lock-agent/party/loadout, type-text credentials, mọi state-mutating action ngoài phạm vi được người dùng cho phép từng trường hợp.

#### SEC-007 — Redaction allowlist fail-closed (T0)

- **PASS**: URL giữ key an toàn (`q/page/limit/...`) nhưng redact `sid`, `jwt` và mọi key lạ; header chỉ giữ allowlist; JSON body chỉ giữ field an toàn; body text không cấu trúc trả `[REDACTED]`.

### 6.20 STR — Stress & ổn định

#### STR-001 — Session 100 events (T2)

- **Chạy**: vòng lặp 50 × (tap + observe include performance)
- **PASS**: session get trả ≥ 100 events; SQLite không phình bất thường; observer process ổn.

#### STR-002 — 50 screenshots liên tiếp (T2)

- **PASS**: 50 artifact PNG distinct; dung lượng mỗi file > 0; tổng thời gian bình thường (không degraded rõ rệt ở cuối).

#### STR-003 — UI tree 1000+ node (T2)

- **PASS**: elementCount ≥ 1000; thời gian ui-tree ≤ 3× trung bình SCR-003.

#### STR-004 — Log 5000 dòng (T2)

- **PASS**: parse hoàn thành; không OOM; filter vẫn chính xác.

#### STR-005 — adb chậm (T3)

- **Fixture**:.fake froze screen hoặc dumpsys nặng (`dumpsys activity` đầy đủ) song song
- **PASS**: lệnh vượt timeout 30s bị kill + lỗi timeout rõ ràng; observer không treo vĩnh viễn.

#### STR-006 — Observe song song trace (T3)

- **Chạy**: trace start 30s → trong lúc đó observe 5 lần
- **PASS**: cả hai luồng evidence đầy đủ; trace pull thành công; artifact không lẫn session.

#### STR-007 — Rút device giữa phiên (T3)

- **Chạy**: bắt đầu session, vài lệnh, rút cable/kill adb server giữa chừng
- **PASS**: lỗi recoverable (ADB_COMMAND_FAILED / timeout) với code nhất quán; observer exit sạch; SQLite không corrupt; cắm lại → session tiếp tục ghi được.

### 6.21 E2E — Workflow before/after

> Đây là các case "definition of done" — mỗi case là một vòng `observe → reproduce → diagnose → edit → reload → reproduce → compare → report` trọn vẹn. Kết thúc luôn **khôi phục fixture gốc**.

#### E2E-001 — Giảm JS block (T1/T2)

```text
1. session start; RN_OBSERVER_SESSION_ID=<id>
2. launch → observe (baseline) → tap open-PerformanceLab
3. tap trigger-js-block → performance → diagnose
   PASS-vòng-1: js_blocking_ms ≈100ms + finding 'Long JS task observed'
4. Sửa App.tsx: block 100 → 5ms (tạm thời)
5. reload → tap trigger-js-block → performance → diagnose
   PASS-vòng-2: js_blocking_ms ≈5ms; finding biến mất
6. compare screenshot trước/sau (nếu visual đổi)
7. KHÔI PHỤC fixture 100ms; reload; session stop
8. Báo cáo: before/after metric + artifact paths
```

- **PASS toàn cục**: cả hai vòng có evidence số; fixture đã restore (`performance` cuối cho lại ~100ms hoặc tối thiểu source đã về gốc).

#### E2E-002 — Xác nhận network fixture (T2)

- Vòng: bấm cả 4 nút NetworkLab → summary đúng kỳ vọng (NET-002..006) → không sửa gì → chốt số liệu làm baseline tham chiếu cho app này.

#### E2E-003 — Visual regression phát hiện + revert (T2)

- Chụp baseline VisualLab → toggle → compare phát hiện vùng + structural change → toggle lại → compare similarity quay về ~1 (≤ sai số pixel nhỏ do animation/statusbar — ghi nhận ngưỡng thực đo).

#### E2E-004 — Hạ rerender (T2)

- Diagnose bắt finding rerender (bấm ≥10) → sửa fixture (memo row / ngắt dependency tick) → reload → tái hiện cùng số lần bấm → renderCount/componentCount finding giảm hoặc mất → **khôi phục fixture**.

#### E2E-005 — Sạch lỗi runtime (T2)

- ErrorLab sinh 3 loại lỗi → diagnose finding `'Runtime errors captured'` → (fixture demo cố ý không sửa) → xác nhận evidence đúng message từng loại; không yêu cầu sửa vì fixture chính là regression target.

#### E2E-006 — Bring-up app ngoài repo (Vshop, read-only) (T2)

- BU-1..BU-7 với khóa read-only SEC-006; chạy T0 con: DEV-001/002, APP-004, SCR-001/003, OBS-001, PERF-001/002/003 (chấp nhận js_blocking unavailable), NET-001, DIA-009, SES-001..005, TRC-001/002, VIS-001 (compare cùng ảnh).
- **PASS**: smoke đủ; mọi metric thiếu đều `available: false` trung thực; không thao tác mutating nào thực hiện.

---

### 6.22 DTL — DevTools export qua Metro CDP (mới 2.1.0)

> Tiền điều kiện chung: Metro chạy cho đúng AUT, app load JS từ Metro, không mở React Native DevTools song song. Mặc định metro `http://127.0.0.1:8081` hoặc `--metro`.

#### DTL-001 — Target discovery (T1)

- **Chạy**: `pnpm rn-observe devtools-export --duration 2000`
- **PASS**: response `target.title` chứa appId AUT; `metroUrl` đúng; `durationMs` = giá trị clamp trong [1000, 60000].

#### DTL-002 — Console entries thật (T1)

- **Chạy**: start export 8s ở background → tap `open-ErrorLab` → tap `console-error` → đợi xong
- **PASS**: `consoleEntries` có entry `level: 'error'`, text chứa `RN Agent Observer demo console error`; các entry instrumentation (ROUTE/RENDER) cũng xuất hiện; `timestamp` là ISO thời điểm thu.

#### DTL-003 — Exceptions (T2)

- **Chạy**: như DTL-002 nhưng tap `unhandled-error`
- **PASS**: `exceptions` có ít nhất 1 phần tử với text dòng đầu chứa `Demo unhandled exception`, không chứa dòng `at ...`.

#### DTL-004 — Heap usage (T2)

- **PASS**: `heap.available: true`, `usedMb > 0`, `totalMb ≥ usedMb`, source `cdp-Runtime.getHeapUsage`. Nếu runtime không trả: `available: false` + reason — trung thực, không FAIL.

#### DTL-005 — Artifact + record (T1)

- **PASS**: `artifactId` trả về; file `.artifacts/.../devtools-exports/devtools-export.json` tồn tại và parse khớp response; (nếu có session) timeline có event `devtools_export`.

#### DTL-006 — Lỗi tường minh (T1)

- **Chạy**: (a) `--metro http://127.0.0.1:9` khi không có gì ở đó; (b) Metro chạy nhưng app không kết nối
- **PASS**: (a) `METRO_UNREACHABLE`; (b) `DEVTOOLS_TARGET_NOT_FOUND` — cả hai recoverable kèm suggestion đúng.

#### DTL-007 — Song song chiếm inspector (T3)

- **Chuẩn bị**: mở một kết nối inspector khác giữ target
- **PASS**: lỗi `DEVTOOLS_CONNECT_FAILED` recoverable; observer không treo (timeout 10s).

### 6.23 Fallback & body capture (mới 2.1.0)

#### APP-008 — app-state (T1)

- **Chạy**: `pnpm rn-observe app-state` khi app foreground; lặp lại sau `am force-stop`
- **PASS**: foreground = `appId/.MainActivity`, `appInForeground: true`, pid > 0; sau force-stop: `processRunning: false`, pid null, foreground là launcher khác app.

#### NET-015 — device-network delta (T1)

- **Chạy**: `pnpm rn-observe device-network --window 2000` trong lúc tải gì đó trên device
- **PASS**: `deltas` = hiệu hai sample theo interface (kiểm chứng tay ít nhất 1 interface); `windowMs` clamp [500, 30000]; không interface `lo`; response ghi rõ đây là device-level.

#### NET-016 — Body preview redact (T1)

- **Chạy**: vào NetworkLab → tap `network-body` → `network requests`
- **PASS**: request mới method POST có `requestBodyPreview`/`responseBodyPreview`; `demo-secret` và `user@example.test` bị `[REDACTED]`; phần vô hại (`item`, `quantity`) giữ nguyên.

#### OBS-006 — observe gồm app_state (T1)

- **Chạy**: `pnpm rn-observe observe`
- **PASS**: response có `appState` (mặc định từ 2.1.0); `include: ['performance']` (MCP) thì **không** có appState.

### 6.24 Tính năng 2.2.0 — metro-network, fast reload, recording, profile

#### NET-017 — metro-network thu fetch thật (T1)

- **Tiền điều kiện**: Metro chạy cho AUT (RN 0.83+), app load từ Metro; fixture `network-real` (fetch tới Metro `/status`).
- **Chạy**: `metro-network --duration 10000` nền → tap `network-real` ×2 → đợi xong
- **PASS**: `requests[]` có ≥2 request tới `/status`, status 200, durationMs ≥ 0, source `metro-cdp-network`; URL không chứa giá trị param nhạy cảm (nếu fixture có).

#### NET-018 — metro-network với app không instrumentation (T2)

- **AUT**: app ngoài repo chạy qua Metro (nếu có); nếu không → `N/A`
- **PASS**: vẫn thu được fetch/XHR từ JS — đây là điểm khác biệt với NET-001 (log-based rỗng).

#### NET-019 — runtime không hỗ trợ Network domain (T2/T3)

- **PASS**: lỗi `METRO_NETWORK_UNSUPPORTED` recoverable với suggestion đúng; không crash, không trả dữ liệu giả.

#### APP-009 — reload --fast (T1)

- **Chạy**: vào Lab bất kỳ (renderCount > 1) → `reload --fast` → đọc logs
- **PASS**: response `mode: 'metro'`; renderCount reset về 1 (JS reload, không cold start); PID app **không đổi** (giữ native state). Khi Metro off: `mode: 'app-fallback'` + `fallbackReason` + PID đổi.

#### REC-001 — record start/stop (T1)

- **Chạy**: `record start --duration 8000` → tap vài nút → `record stop <id>`
- **PASS**: artifact `.mp4` tồn tại, kích thước > 0 (thường ≥ 50KB với 8s có activity); state file bị xóa; remote path dọn.

#### REC-002 — start/stop hai process (T1)

- **PASS**: start và stop từ hai terminal khác nhau vẫn hoạt động (state `.artifacts/active-recordings/`).

#### REC-003 — Clamp duration (T1)

- **PASS**: `--duration 999999` bị clamp còn 180000 (giới hạn Android); `--duration 1` tối thiểu 1000.

#### REC-004 — stop ID không tồn tại (T1)

- **PASS**: lỗi `RECORDING_NOT_ACTIVE` recoverable; không tạo artifact rỗng.

#### REC-005 — Recording trong session (T2)

- **PASS**: start khi có session → artifact gắn sessionId; `session get` liệt kê mp4 với kind `recording`.

#### DTL-008 — devtools-profile (T1/T2)

- **Chạy**: `devtools-profile --duration 8000` trong lúc thao tác app
- **PASS**: response `nodeCount > 0`, `sampleCount > 0`, artifact `.cpuprofile` parse được JSON và mở bằng Chrome DevTools. Nếu Hermes không hỗ trợ: lỗi `DEVTOOLS_PROFILE_FAILED` recoverable — trung thực, không FAIL.

#### DTL-009 — Song song metro-network + devtools-export (T3)

- **Chạy**: hai lệnh CDP cùng lúc trên cùng target
- **PASS**: cả hai hoàn thành hoặc cái sau lỗi `DEVTOOLS_CONNECT_FAILED` recoverable rõ ràng; không treo vô hạn.

### 6.25 Tính năng 2.3.0 — snapshot/press, replay, assert, device state

#### SNP-001 — snapshot gán ref (T1)

- **Chạy**: `snapshot --interactive` ở Home
- **PASS**: ref `e1..eN` liên tục; mỗi phần tử có kind/label/interactive; count bằng số node clickable/focusable visible trong ui-tree.

#### SNP-002 — press + settle diff (T1)

- **Chạy**: `snapshot` → `tap --ref <ref open-PerformanceLab> --settle 1500`
- **PASS**: `performed: true`; diff có dòng `+` cho `trigger-js-block`; ref sau diff là của snapshot mới.

#### SNP-003 — Text đổi giá trị = changed (T2)

- **Fixture**: NetworkLab, text `network-result` đổi `idle` → trạng thái sau request
- **PASS**: diff có dòng `= ... from -> to` cho text node đó, không phải removed+added.

#### SNP-004 — Ref cũ/stale (T3)

- **Chạy**: dùng ref từ snapshot đã bị ghi đè mà phần tử không còn tồn tại
- **PASS**: lỗi `REF_NOT_FOUND` recoverable; không tap nhầm phần tử khác.

#### RPL-001 — Chạy script pass (T1)

- **Script**: tap open-NetworkLab → tap network-500 → assert network-result → screenshot
- **PASS**: report `{ passed: 4, failed: 0, stoppedEarly: false }`; mỗi step có summary; screenshot artifact tồn tại.

#### RPL-002 — Fail dừng sớm + continueOnError (T1)

- **Script**: tap → assert testId không tồn tại → tap
- **PASS**: mặc định dừng sau step 2 (`stoppedEarly: true`); `continueOnError: true` → chạy hết, failed=1.

#### RPL-003 — Step lỗi throw (T2/T3)

- **Script**: deep-link URI không có activity nhận
- **PASS**: step ok=false với message lỗi; process không crash.

#### RPL-004 — Auto-record replay khi stop session (T0/T1)

- **Chạy**: trong session thực hiện tap testID/ref, swipe, screenshot và type-text fixture; `session stop`; chạy artifact replay vừa sinh.
- **PASS**: interaction có cấu trúc giữ đúng thứ tự; ref tap export thành testID/tọa độ; `type_text(length-only)` bị bỏ để không persist secret; JSON parse được và replay pass cùng kịch bản read-only.

#### ASM-001 — assert tồn tại/visible (T1)

- **PASS**: `assert --test-id open-VisualLab --visible true` → passed=true, evidence có matchCount/label; testId rác → passed=false (không throw).

#### ASM-002 — a11y-audit (T2)

- **PASS**: đếm unlabeled khớp tay trên ui-tree; demo app (toàn bộ nút có label) → unlabeledCount=0.

#### ASM-003 — app-data latest-wins (T1)

- **Chạy**: vào RenderLab → tap `rerender-list` ×2 → tap `dump-state` → `app-data --namespace render-lab`
- **PASS**: event duy nhất với `tick` = giá trị lúc bấm dump (snapshot mới nhất).

#### ASM-004 — routes (T2)

- **AUT**: app expo-router có `app/`; nếu không → `N/A`
- **PASS**: sitemap khớp cấu trúc thư mục (loại `_layout`, gộp `(group)`); app không có `app/` → `appDirExists: false`, routes `[]`.

#### ASM-005 — deep-link + permissions (T2)

- **PASS**: `deep-link --uri` mở đúng màn (verify snapshot); `permissions` list khớp Settings; `grant/revoke --perm` đổi trạng thái (list lại để verify); perm không runtime → lỗi recoverable.

#### ASM-006 — Touch target size (T1/T2)

- **PASS**: bounds px đổi sang dp theo density; element clickable có label nhưng width/height <48dp sinh `small-touch-target`; unlabeled và small target có counter riêng.

## 7. Ma trận traceability Lab ↔ Case

| Lab / nguồn    | Case tiêu biểu                                                          |
| -------------- | ----------------------------------------------------------------------- |
| Home           | INT-001, OBS-004, DIA-009                                               |
| PerformanceLab | PERF-005/006, SCR-007, INT-008, E2E-001                                 |
| NetworkLab     | NET-002..011, SEC-001, E2E-002                                          |
| RenderLab      | REN-002, DIA-005, E2E-004                                               |
| AnimationLab   | ANI-001..004, PERF-011                                                  |
| ErrorLab       | LOG-005/006, DIA-006/008, E2E-005                                       |
| VisualLab      | VIS-002..004, E2E-003                                                   |
| Unit test repo | parsers, session, compare, network/diagnosis, cli, mcp, schemas, redact |
| Vshop          | NET-001, NET-015, APP-008, SEC-006, E2E-006                             |
| Metro/CDP      | DTL-001..009, NET-016..019, APP-009                                     |
| Recording      | REC-001..005                                                            |
| Snapshot/refs  | SNP-001..004                                                            |
| Replay/assert  | RPL-001..003, ASM-001..005                                              |

## 8. Bộ chạy nhanh

### T0 — Smoke (~10 phút, theo thứ tự)

```powershell
pnpm build
pnpm rn-observe devices                       # ENV-004, DEV-001
pnpm rn-observe device-info                   # DEV-002
pnpm rn-observe launch                        # APP-001/004
pnpm rn-observe screenshot                    # SCR-001
pnpm rn-observe ui-tree                       # SCR-003/004
pnpm rn-observe tap --test-id open-PerformanceLab   # INT-001
pnpm rn-observe tap --test-id trigger-js-block      # (fixture)
pnpm rn-observe performance                   # PERF-001..005
pnpm rn-observe tap --test-id back-button; pnpm rn-observe back   # INT-012
pnpm rn-observe tap --test-id open-NetworkLab
pnpm rn-observe tap --test-id network-fast
pnpm rn-observe network requests              # NET-002, NET-007
pnpm rn-observe session start                 # SES-001 (set env)
pnpm rn-observe observe                       # OBS-001
pnpm rn-observe diagnose                      # DIA-001, DIA-009 (tùy fixture đã bấm)
pnpm rn-observe session stop <id>             # SES-005
# So sánh ảnh: lấy 2 artifact screenshot gần nhất
pnpm rn-observe compare <a>.png <a>.png       # VIS-001
pnpm mcp:check                                # MCP-001
Get-ChildItem -Recurse .artifacts | Select-String 'demo-secret'   # SEC-001 (rỗng = PASS)
```

### T1 — Thêm vào T0

- Toàn bộ INT, LOG, NET (gồm percentile NET-006), REN, ANI, VIS-002..007, SES-002..010, TRC-001..005, DIA-002..010, OBS-002..004, INS (trong AUT), MCP mirror các case T0, CLI-004..006, SEC-002..004.

### T2 — Thêm vào T1

- STR-001..004, E2E-001..006, NET-010/012, VIS-008, DIA-011/012, PERF đủ, TRC-006, SES-011, INS-008, bring-up đầy đủ nếu app mới.

### T3 — Chọn lọc theo nghi ngờ

- ENV-006/007, DEV-006, APP-006, SCR-007, INT-006/007/013..015, LOG-007, PERF-012, NET-013, VIS-005, SES-008, TRC-004/007, OBS-005, MCP-008, STR-005..007.

## 9. Template báo cáo

```text
## Báo cáo test — <AUT> @ <device> — <ngày>

### Phạm vi
- Tier: <T0/T1/T2/T3>; Bring-up: <BU-x hoàn tất / N/A>
- Fixture đáp ứng: F-01..F-10 (liệt kê thiếu → case N/A)

### Kết quả
| Case    | Kết quả | Evidence (artifact path / metric) |
| ------- | ------- | --------------------------------- |
| PERF-005| PASS    | .artifacts/.../summary.json, js_blocking_ms=100.4ms |

- Tổng: <n> PASS / <n> FAIL / <n> N/A / <n> NOT VERIFIED

### Chênh lệch so với kỳ vọng
- <mô tả các FAIL/sai số và giả thuyết nguyên nhân>

### Uncertainty & limitation
- <điều chưa xác minh được và lý do>

###Khuyến nghị
- <bước tiếp theo>
```

Quy tắc: mỗi dòng FAIL phải kèm hypothesis nguyên nhân và case tái hiện; `NOT VERIFIED` chỉ dùng khi thiếu điều kiện (device, fixture) — không dùng để che FAIL.

## 10. An toàn khi test app thật (bắt buộc)

1. **Read-only mặc định** với app ngoài repo: không mua hàng, không đăng nhập, không đổi tài khoản/cài đặt, không thao tác gì ngoài phạm vi người dùng duyệt từng trường hợp.
2. Không bật body capture ngoài development build; không bật trên tài khoản/dữ liệu thật.
3. Không commit `.artifacts` chứa UI/dữ liệu runtime nhạy cảm (`.gitignore` đã chặn, kiểm tra lại trước khi share).
4. Trace Perfetto chứa trạng thái hệ thống — chia sẻ có chọn lọc.
5. Sau mỗi E2E: xác nhận fixture đã khôi phục và session đã stop.

## 11. Bảo trì blueprint

- Thêm case: ID mới ở cuối domain (không tái sử dụng ID đã xóa); cập nhật chương 5; note trong mục "Lịch sử" dưới đây.
- Sửa ngưỡng: chỉ khi có bằng chứng đo lặp lại trên ≥2 device; ghi device vào PR.
- Khi observer thêm tool/feature mới (VD devtools-export, device-level network): thêm domain mới hoặc case mới + map CLI↔MCP + cập nhật số lượng tools ở MCP-001.

### Lịch sử

| Phiên bản | Ngày       | Thay đổi                                                                                                                                                                                                                                 |
| --------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0.0     | 2026-08-21 | Bản đầu (observer 2.0.0)                                                                                                                                                                                                                 |
| 1.1.0     | 2026-08-21 | Observer 2.1.0: domain DTL (7 case), APP-008/NET-015/NET-016/OBS-006, MCP 27 tools, map CLI↔MCP thêm 3 hàng, fixture `network-body`                                                                                                      |
| 1.2.0     | 2026-08-22 | Observer 2.2.0: NET-017..019 (metro-network), APP-009 (reload --fast), REC-001..005 (screenrecord), DTL-008/009 (profile/song song), MCP 31 tools, fixture `network-real`                                                                |
| 1.3.0     | 2026-08-22 | Observer 2.3.0: domain SNP (4), RPL (3), ASM (5) — tổng hợp từ agent-device/Expo MCP/agent-devtools; MCP 41 tools; fixture `dump-state`                                                                                                  |
| 1.4.0     | 2026-08-22 | Observer 2.4.0: DIA-013 (confidence + thresholds), ENV-008 (CDP queue), PERF-013 (freshness), RPL-004 (auto replay), SES-012/013 (cleanup/warning), SEC-007 (allowlist), ASM-006 (touch-target); known limitations RN 0.86; MCP 43 tools |

# Android emulator verification matrix

Snapshot: **2026-08-24**, RN Agent Observer **2.4.0**.

Tài liệu này ghi lại ma trận AVD tạm đã chạy thật trên host Windows. Mục tiêu là
chứng minh đường chạy built-in Android ở ba tier API, đồng thời giữ ranh giới rõ:
đây là fixture evidence trên Google x86_64 emulator, không phải lời hứa hỗ trợ mọi
OEM, ABI hay thiết bị production.

## Môi trường đã dùng

| Thành phần         | Fixture đã xác minh                                                |
| ------------------ | ------------------------------------------------------------------ |
| Host               | Windows, WHPX usable                                               |
| Node / pnpm        | Node.js 22.19 / pnpm 9.6.0                                         |
| ADB                | Android Debug Bridge 37.0.0                                        |
| Android Emulator   | 36.5.10, build 15081367                                            |
| Demo               | `dev.rnagentobserver.demo`, version 2.4.0                          |
| APK                | Debug, minSdk 24, targetSdk 36, x86/x86_64 ABI available           |
| APK SHA-256        | `1A87F4136A3030654C4B25271B4D6FF2263F3D2315E9CCA85FD259288B5A0735` |
| Observer transport | Metro 8081 qua exact `adb -s emulator-5554 reverse`                |

## Kết quả theo API

Mỗi hàng dùng một AVD mới, một session riêng và cùng fixture. Mọi lệnh đều pin
exact serial đang hiện trong ADB; local session ID và raw artifacts không được đưa
vào Git.

| Tier                | System image / màn hình                   | Kết quả E2E                                                                                                          | Evidence đáng chú ý                                                                                                                                           | Trạng thái         |
| ------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| API 24 / Android 7  | `google_apis;x86_64`, 480×800             | install/launch/observe, Home và NetworkLab, semantic tap, performance/network/diagnose, final UI model, session stop | JS task `100.0103ms`; network 2 request/1 failure; CPU và gfx frame rows trung thực `available: false`; 7 visible/pressable action, 0 interaction error       | `FIXTURE_VERIFIED` |
| API 30 / Android 11 | `google_apis;x86_64`, 480×800             | cùng kịch bản                                                                                                        | JS task `100.0002ms`; network 2/1, query token redacted; 7 visible/pressable action, 0 interaction error                                                      | `FIXTURE_VERIFIED` |
| API 36 / Android 16 | `google_apis_playstore;x86_64`, 1080×2400 | cùng kịch bản                                                                                                        | JS task `100.0003ms`; gfx sample có 39 frame nhưng chỉ là dev-emulator evidence; network 2/1, token redacted; 7 visible/pressable action, 0 interaction error | `FIXTURE_VERIFIED` |

Cả ba session đều kết thúc `complete` và replay export có 21 bước. Trên API 24/30,
thiếu gfx frame rows không bị chuyển thành FPS 0; trên API 24, CPU process không
đọc được cũng được giữ `available: false`. Hai request network ở mỗi tier là mẫu
quá nhỏ nên percentile vẫn `percentileLowConfidence: true`.

## Kịch bản acceptance chung

1. Xác minh exact SDK bằng `getprop`, không tiếp tục nếu khác tier dự kiến.
2. Cài đúng APK và kiểm `versionName`, `minSdk`, `targetSdk`.
3. Pin exact serial, app ID, project root và active trust cho owned demo fixture.
4. `session start` → `launch` → `observe` → `understand-screen` + `ui-model`.
5. Semantic tap `open-PerformanceLab` → `trigger-js-block` → `performance` →
   `diagnose`.
6. Semantic tap `back-button` → `open-NetworkLab` → `network-fast` →
   `network-fail` → `network`.
7. Chụp lại `understand-screen` + `ui-model`, mở screenshot để review, rồi
   `session stop`.
8. Xóa exact AVD tạm và ảnh hệ thống chỉ vừa cài; xác nhận AVD có sẵn không đổi.

## Tạo AVD tạm có thể tái lập

Android SDK Command-line Tools phải được cài trước. Liệt kê inventory và chọn một
ổ có đủ dung lượng; AVD hiện đại có thể cần hơn 7 GiB dù cấu hình data partition
nhỏ hơn.

```powershell
$sdk = $env:ANDROID_HOME
$sdkManager = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
$avdManager = Join-Path $sdk 'cmdline-tools\latest\bin\avdmanager.bat'
$emulator = Join-Path $sdk 'emulator\emulator.exe'

adb devices -l
& $emulator -list-avds
& $sdkManager --list

# Ví dụ API 24. Đổi package/tên cho API 30 hoặc 36.1.
& $sdkManager 'system-images;android-24;google_apis;x86_64'
$avdRoot = 'D:\rnobs-avd-test'
$avdName = 'rnobs_tmp_api24'
$avdPath = Join-Path $avdRoot "$avdName.avd"
& $avdManager create avd -n $avdName -p $avdPath `
  -k 'system-images;android-24;google_apis;x86_64' --device 'Nexus S' --force

$process = Start-Process -FilePath $emulator -PassThru -WindowStyle Hidden `
  -ArgumentList @(
    '-avd', $avdName,
    '-port', '5554',
    '-no-window', '-no-audio', '-no-boot-anim',
    '-no-snapshot', '-no-cache', '-wipe-data',
    '-gpu', 'swiftshader_indirect', '-memory', '2048'
  )
```

Không dùng `emulator-5554` chỉ vì ví dụ ghi vậy. Sau khi boot, lấy serial hiện tại
từ `adb devices -l`, pin mọi lệnh bằng `-s`, rồi xác minh identity:

```powershell
$serial = 'emulator-5554'
adb -s $serial get-state
adb -s $serial shell getprop sys.boot_completed
adb -s $serial shell getprop ro.build.version.sdk
adb -s $serial shell getprop ro.product.model
adb -s $serial shell getprop ro.product.cpu.abi
```

Nếu ổ chứa profile Windows `.android\avd` thiếu dung lượng, dùng `avdmanager -p`
để đặt toàn bộ AVD tạm trên ổ khác như ví dụ. Chỉ đổi `-datadir` lúc launch không
đủ, vì emulator vẫn có thể kiểm dung lượng tại AVD content path.

## Chạy demo với Observer

Build `dist`, chạy Metro của đúng demo và reverse port trên exact target:

```powershell
pnpm build
pnpm --filter @rn-agent-observer/demo-expo start -- --clear --port 8081

$serial = '<serial-tu-adb-devices>'
adb -s $serial install -r -t `
  .\.artifacts\device-ready\rn-agent-observer-demo-2.4.0-debug.apk
adb -s $serial reverse tcp:8081 tcp:8081

$env:RN_OBSERVER_PROJECT_ROOT = (Resolve-Path .\apps\demo-expo).Path
$env:RN_OBSERVER_DEVICE_ID = $serial
$env:RN_OBSERVER_APP_ID = 'dev.rnagentobserver.demo'
$env:RN_OBSERVER_TRUST_ACTIVE_CONFIG = '1'
```

Copy `.rn-observer.active-security.example.json` thành `.rn-observer.json`, review
và pin `target.deviceId` đúng serial. File thật đã được ignore và phải xóa sau run;
repository config không tự cấp quyền nếu thiếu process trust.

```powershell
pnpm rn-observe session start
$env:RN_OBSERVER_SESSION_ID = '<id-vua-tao>'
pnpm rn-observe launch
pnpm rn-observe observe
pnpm rn-observe understand-screen
pnpm rn-observe ui-model
pnpm rn-observe tap --test-id open-PerformanceLab
pnpm rn-observe tap --test-id trigger-js-block
pnpm rn-observe performance
pnpm rn-observe diagnose
pnpm rn-observe tap --test-id back-button
pnpm rn-observe tap --test-id open-NetworkLab
pnpm rn-observe tap --test-id network-fast
pnpm rn-observe tap --test-id network-fail
pnpm rn-observe network
pnpm rn-observe understand-screen
pnpm rn-observe ui-model
pnpm rn-observe session stop
```

## Cleanup bắt buộc

Chụp inventory trước khi tạo AVD. Chỉ xóa tên tạm do run hiện tại tạo; không dùng
glob và không xóa AVD không có trong danh sách owned của run.

```powershell
$sdk = $env:ANDROID_HOME
$avdManager = Join-Path $sdk 'cmdline-tools\latest\bin\avdmanager.bat'
$sdkManager = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
$emulator = Join-Path $sdk 'emulator\emulator.exe'
$serial = '<exact-emulator-serial>'
$avdName = 'rnobs_tmp_api24'

adb -s $serial reverse --remove tcp:8081
adb -s $serial emu kill
& $avdManager delete avd -n $avdName

# Chỉ uninstall nếu inventory trước run xác nhận image này do run hiện tại cài.
& $sdkManager --uninstall 'system-images;android-24;google_apis;x86_64'

adb devices -l
& $emulator -list-avds
```

Trong run 2026-08-24, ba AVD tạm đã bị xóa, ảnh API 24/30 cài riêng cho run đã bị
gỡ, thư mục data tạm trên ổ D đã bị xóa, Metro đã dừng và inventory cuối chỉ còn
AVD `Medium_Phone_API_36.1` tồn tại trước run. Ảnh API 36.1 có sẵn được giữ nguyên.

## Giới hạn và bước tiếp theo

- Ma trận này có ba API tier nhưng chỉ một host, một emulator engine và x86_64.
- Physical acceptance hiện có thêm một Xiaomi Android 15/arm64; chưa có 2 OEM cho
  mỗi tier, chưa phải device-farm conformance.
- Số performance/network chỉ xác minh pipeline và fixture, không dùng làm benchmark.
- Mở rộng đáng tin cậy tiếp theo là chạy cùng scenario trên ít nhất hai OEM mỗi
  tier, công khai aggregate đã redacted và giữ raw artifact cục bộ.

Tài liệu Android chính thức: [sdkmanager](https://developer.android.com/tools/sdkmanager),
[avdmanager](https://developer.android.com/tools/avdmanager) và
[Android Emulator command line](https://developer.android.com/studio/run/emulator-commandline).

Tham khảo [compatibility matrix](compatibility.md), [testing record](testing.md),
[installation](installation.md) và [test blueprint](test-blueprint.md).

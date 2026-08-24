# Cài đặt RN Agent Observer

Tài liệu này là luồng cài đặt chuẩn cho người dùng CLI, MCP client và contributor.
Sau khi cài xong, tiếp tục với [hướng dẫn sử dụng](usage.md). Maintainer chuẩn bị
package/tag dùng [release installation](release-installation.md), còn thay đổi phiên
bản đã cài dùng [hướng dẫn cập nhật](upgrading.md).

## 1. Chọn cách cài

| Nhu cầu                                | Cách dùng                                            | Trạng thái hiện tại                  |
| -------------------------------------- | ---------------------------------------------------- | ------------------------------------ |
| Thử hoặc phát triển Observer           | Clone source và chạy script ở root                   | Dùng được ngay                       |
| Kết nối AI agent qua MCP               | Clone source, build, trỏ client vào `dist/server.js` | Dùng được ngay                       |
| Cài CLI/MCP từ npm                     | Cài package scoped sau khi release được publish      | Chưa dùng được trước lần publish đầu |
| Thu route/fetch/render/JS-task của app | Thêm `rn-instrumentation` vào development build      | Không dùng trong production          |

Tại snapshot 2026-08-24, registry npm chưa có các package
`@rn-agent-observer/*`; lệnh npm sẽ trả `404` cho tới khi maintainer hoàn tất lần
publish đầu. Source workspace là đường cài có thể kiểm chứng hiện tại.

## 2. Yêu cầu hệ thống

- Node.js `>=22.12.0`;
- pnpm `9.6.0`, được pin bởi `packageManager` ở root;
- Git;
- Android Platform Tools (`adb`) cho lệnh liên quan thiết bị;
- Android emulator hoặc thiết bị vật lý đã bật USB debugging;
- Expo development build nếu cần telemetry do app sở hữu.

Kiểm tra trên PowerShell:

```powershell
node --version
corepack --version
adb version
adb devices -l
```

`adb devices -l` phải hiện state `device`. `unauthorized` nghĩa là chưa chấp nhận
USB debugging trên điện thoại; `offline` chưa đủ điều kiện quan sát. Khi có nhiều
target, luôn ghi lại serial chính xác và pin mọi lệnh bằng
`RN_OBSERVER_DEVICE_ID`.

## 3. Cài từ source trên Windows

```powershell
git clone https://github.com/GinzaTech/rn-agent-observer.git
Set-Location .\rn-agent-observer

corepack enable
corepack prepare pnpm@9.6.0 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm mcp:check
pnpm rn-observe --version
```

Không chạy `npm install`, Yarn hoặc Bun trong workspace. Root dùng
`pnpm-lock.yaml`, `.npmrc` và `.pnpmfile.cjs` để giữ dependency graph có thể tái
lập và pin các transitive security patch đã review.

CLI/MCP chạy từ `packages/*/dist`; vì vậy phải chạy `pnpm build` sau khi sửa source
trước khi dùng `pnpm rn-observe`, `pnpm mcp:check` hoặc `pnpm mcp:start`.

Trên bash/zsh, các lệnh tương đương; thay `Set-Location` bằng `cd` và cách đặt biến
môi trường PowerShell bằng `export NAME=value`.

## 4. Chuẩn bị app và thiết bị Android

1. Cài/mở đúng development build của app cần quan sát.
2. Chạy `adb devices -l` và xác nhận model/codename đúng target.
3. Xác định application ID. Expo đọc từ `expo.android.package` trong `app.json`;
   app khác có thể lấy bằng `adb shell pm list packages` hoặc cấu hình thủ công.
4. Chỉ với Metro/CDP, chạy Metro của đúng app và reverse đúng cổng.

```powershell
$env:RN_OBSERVER_PROJECT_ROOT = 'C:\src\my-expo-app'
$env:RN_OBSERVER_DEVICE_ID = '<serial-tu-adb-devices>'
$env:RN_OBSERVER_APP_ID = 'com.example.myapp' # bỏ nếu app.json đã có package

adb -s $env:RN_OBSERVER_DEVICE_ID get-state
adb -s $env:RN_OBSERVER_DEVICE_ID shell pm path $env:RN_OBSERVER_APP_ID

# Chỉ cần cho Metro/CDP ở cổng mặc định:
adb -s $env:RN_OBSERVER_DEVICE_ID reverse tcp:8081 tcp:8081
```

Không dùng một serial mẫu trong tài liệu cho active action. Nếu model/codename trả
về khác thiết bị dự kiến, dừng workflow và chọn lại target.

Nếu chưa có target, có thể tạo AVD tạm và chạy ma trận owned demo. Quy trình phải
inventory AVD trước, đặt AVD trên ổ đủ dung lượng, pin exact serial/API, rồi xóa đúng
AVD và system image cài riêng cho run. Xem
[Android emulator verification matrix](android-device-matrix.md) để có lệnh
PowerShell đầy đủ, acceptance scenario và cleanup đã được kiểm chứng trên API
24/30/36.

## 5. Khởi tạo cấu hình read-only

Từ root Observer đã clone:

```powershell
pnpm rn-observe doctor
pnpm rn-observe init --dry-run
pnpm rn-observe init
pnpm rn-observe status
pnpm rn-observe observe
```

`init --dry-run` cho phép review trước khi ghi. Config mặc định tạo ở
`<target-project>/.rn-observer.json`, có `security.mode: read-only`, chỉ cho phép
`read`, lưu artifact trong `.artifacts` và không cho share. File config thật chứa
target/policy cục bộ nên đã được root `.gitignore` loại khỏi commit; chỉ commit file
`.example.json` đã làm sạch.

Các lệnh `launch`, `tap`, `swipe`, `type-text`, replay, deep link, permission,
trace và recording là active action. Chúng không chạy chỉ vì repo có config:
owner phải dùng đúng development fixture, pin exact app/device/risk allowlist và
đặt process opt-in `RN_OBSERVER_TRUST_ACTIVE_CONFIG=1`. Xem
[security testing](security-testing.md) trước khi đổi khỏi read-only.

## 6. Kết nối MCP từ source

Build workspace trước, sau đó trỏ MCP client vào entrypoint tuyệt đối:

```json
{
  "mcpServers": {
    "rn-agent-observer": {
      "command": "node",
      "args": [
        "C:\\src\\rn-agent-observer\\packages\\mcp-server\\dist\\server.js"
      ],
      "env": {
        "RN_OBSERVER_PROJECT_ROOT": "C:\\src\\my-expo-app",
        "RN_OBSERVER_DEVICE_ID": "<device-serial>",
        "RN_OBSERVER_APP_ID": "com.example.myapp"
      }
    }
  }
}
```

Kiểm tra hữu hạn bằng `pnpm mcp:check`. `pnpm mcp:start` là stdio server nên việc
nó đứng chờ client là hành vi bình thường, không phải treo.

## 7. Thêm instrumentation vào app

Instrumentation chỉ dành cho development build. Cài release public từ npm bằng:

```powershell
pnpm add --save-dev @rn-agent-observer/rn-instrumentation
```

Chỉ bật Babel plugin ở development/test:

```js
/* global module, require, __dirname */
module.exports = function config(api) {
  const enabled = ['development', 'test'].includes(api.env());
  return {
    presets: ['babel-preset-expo'],
    plugins: enabled
      ? [
          [
            require.resolve('@rn-agent-observer/rn-instrumentation/babel-plugin'),
            { projectRoot: __dirname },
          ],
        ]
      : [],
  };
};
```

Trong app, cài observer fetch ở lifecycle cấp cao và cleanup khi unmount:

```tsx
useEffect(() => installNetworkObserver(), []);
useEffect(() => reportRoute(currentRoute), [currentRoute]);
```

Route, render, JS-task, app-data và UI interaction chỉ available khi app thực sự
phát telemetry. Thiếu instrumentation phải được báo unavailable, không được đổi
thành số 0. Network body capture mặc định tắt; không bật cho dữ liệu/tài khoản thật.
Thay đổi Babel plugin hoặc native dependency cần development build mới, không chỉ
OTA/fast reload.

## 8. Cài package npm

Xác minh registry trả cùng version lockstep trước khi cài:

```powershell
pnpm add --save-dev @rn-agent-observer/cli @rn-agent-observer/mcp-server
pnpm exec rn-observe --version
pnpm exec rn-observer-mcp --check
```

Integration trực tiếp:

```powershell
pnpm add @rn-agent-observer/core @rn-agent-observer/schemas
pnpm add --save-dev @rn-agent-observer/rn-instrumentation
```

Năm package public dùng cùng version. Không trộn version CLI/Core/Schemas/MCP /
instrumentation nếu một project cài trực tiếp nhiều package.

## 9. Definition of done sau cài đặt

- `node --version` thỏa engine và `pnpm --version` là 9.6.0;
- frozen install/build/check pass với source checkout;
- `adb devices -l` thấy đúng exact target;
- app ID resolve được và app đã cài;
- `doctor` không có blocker ngoài capability bạn chủ động không dùng;
- `observe` trả artifact path dưới target `.artifacts`;
- MCP `--check` pass nếu dùng MCP;
- mọi runtime claim ghi device/app/build/scenario và limitation cụ thể.

Nếu không đạt, xem [xử lý sự cố](troubleshooting.md) thay vì xóa lockfile hoặc
chuyển package manager.

# RN Agent Observer instructions

Observer runtime cục bộ cho React Native/Expo, target Android + Windows. Yêu cầu Node >= 22.12, pnpm 9.6, `adb` khả dụng.

## Lệnh chính

- `pnpm check` = `lint -> format:check -> build -> test`; chạy sau mọi thay đổi.
- Một package: `pnpm --filter @rn-agent-observer/core test` (tương tự với `build`).
- Một file test: `pnpm --filter @rn-agent-observer/core test -- <file-hoặc-pattern>` (vitest nhận positional filter).
- `pnpm rn-observe`, `pnpm mcp:check`, `pnpm mcp:start` chạy thẳng `packages/*/dist` — phải `pnpm build` trước khi dùng CLI/MCP sau khi sửa source.
- `devtools-export` cần Metro chạy cho đúng app + `adb reverse tcp:8081 tcp:8081` (hoặc `RN_OBSERVER_METRO_URL`); không mở React Native DevTools song song. Với app không instrumentation, dùng `app-state`/`device-network` làm fallback.

## Bản đồ workspace

- `packages/schemas` — Zod schemas + shared types, không chứa logic runtime.
- `packages/core` — toàn bộ device/runtime logic (ADB, parser, session, diagnosis, comparison). CLI và MCP là adapter mỏng; không đưa logic vào adapter.
- `packages/rn-instrumentation` — telemetry development-only gắn vào app được quan sát (route, fetch, render, long JS task).
- `apps/demo-expo` — fixture dogfood, app ID `dev.rnagentobserver.demo`.
- Hướng phụ thuộc: `schemas <- core <- cli/mcp-server`; demo-expo dùng `rn-instrumentation`.

## Ràng buộc code

- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` (tsconfig.base.json).
- ESLint chạy `--max-warnings=0`; `no-explicit-any` và `consistent-type-imports` là error.
- Prettier: single quote, semicolon, trailing comma `all`; format check nằm trong `pnpm check`, chạy `pnpm format` để sửa.
- Chỉ dùng `pnpm`; không tạo lockfile npm/Yarn/Bun.

## Fixture demo (đừng "sửa")

- PerformanceLab chặn JS 100ms một cách có chủ ý làm regression fixture; không tối ưu hóa.
- NetworkLab dùng fixture nội bộ (0/500/2000ms, HTTP 503), không phụ thuộc Internet.

## Quality gate

```powershell
pnpm check
pnpm --filter @rn-agent-observer/demo-expo exec expo export --platform android --output-dir <temp-directory>
```

Không tuyên bố runtime Android hoạt động nếu chưa chạy trên device/emulator. Khi thay đổi native dependency, dùng Expo development build thay vì suy luận từ web/export.

## Quy trình debug React Native bắt buộc

1. Đặt `RN_OBSERVER_PROJECT_ROOT`, `RN_OBSERVER_DEVICE_ID` và app ID nếu cần (app ID tự suy ra từ `expo.android.package` trong app.json).
2. `launch` hoặc `reload`, bắt đầu session và export `RN_OBSERVER_SESSION_ID`.
3. `observe`, rồi chạy `understand-screen` và `ui-model`; mở `screenshotPath` khi cần kiểm tra trực quan. Nếu state là `loading`, gọi lại sau ngưỡng để phân biệt loading bình thường với `loading-stuck`.
4. Chụp screenshot và UI tree trước thay đổi. Dùng `route`, `headline`, `visibleText`, `actions`, `issues` từ screen understanding; dùng `sourceElement.source`, `visibility`, `enabled`, `canPress` và interaction từ UI model để tìm đúng file/component. `unknown` hoặc `flattened-or-unobserved` không được diễn giải thành hidden/unmounted. Route `null` nghĩa là chưa có instrumentation, không được đoán. Nếu cố ý chạy standalone, phải ghi nhận warning `EVIDENCE_NOT_RECORDED`.
5. Tái hiện bằng semantic `testID`/ref; chỉ dùng tọa độ khi UI tree không có target.
6. Đọc log có filter. Kiểm tra performance cho lag/animation, network cho loading/API, render stats cho rerender.
7. Chạy `diagnose`; coi finding là hypothesis có evidence, không phải chân lý tuyệt đối.
8. Sửa nhỏ nhất có thể, reload/rebuild và tái hiện đúng cùng kịch bản.
9. Chạy lại `understand-screen` + `ui-model`; chụp lại và dùng `compare` với cả PNG và UI tree JSON khi layout/visual thay đổi.
10. Dừng session, báo before/after metrics, artifact paths, uncertainty và limitation còn lại.

```text
session start -> observe -> understand-screen + ui-model -> reproduce -> performance/network/logs
        -> diagnose -> edit -> reload -> reproduce -> understand-screen + ui-model -> compare
        -> session stop -> report evidence
```

## Giới hạn an toàn

- Artifact lớn nằm trên đĩa dưới `<projectRoot>/.artifacts/`; SQLite chỉ lưu metadata/reference; không trả binary/base64 trong MCP response.
- Không thu secrets hoặc network body mặc định; không bật body capture ngoài development build.
- Mỗi metric phải có value, unit, source, timestamp và trạng thái availability trung thực (VD: JS FPS từ ADB luôn `available: false`, không đoán số).
- Với app ngoài repo (VD Vshop): chỉ observe read-only; không tự động mua hàng, đăng nhập, thay đổi tài khoản hay thao tác nào ngoài phạm vi debug mà người dùng không cho phép.

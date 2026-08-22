# Kiến trúc

```text
CLI adapter --------\
                     > ObserverCore -> ADB / UIAutomator / Perfetto
MCP stdio adapter --/       |        -> RN development instrumentation
                            |        -> deterministic diagnosis + comparison
                            v
                    ArtifactManager + SQLite SessionStore

Shared Zod schemas validate public data contracts.
```

## Trách nhiệm package

| Package                                 | Trách nhiệm                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| `@rn-agent-observer/schemas`            | Zod schemas và shared TypeScript types                                          |
| `@rn-agent-observer/core`               | ADB process adapter, parser, observation, session, trace, diagnosis, comparison |
| `@rn-agent-observer/cli`                | Parse command/flag và in JSON có cấu trúc                                       |
| `@rn-agent-observer/mcp-server`         | Đăng ký 24 MCP tools, chuyển input/output sang core                             |
| `@rn-agent-observer/rn-instrumentation` | Opt-in dev telemetry cho route, fetch, render và long JS task                   |
| `@rn-agent-observer/demo-expo`          | Fixture integration xác định để dogfood observer                                |

## Luồng dữ liệu

1. CLI/MCP khởi tạo `ObserverCore` với project root, device serial và app ID.
2. Core chạy `adb` bằng argument array, timeout và buffer; không dùng shell interpolation.
3. Parser chuẩn hóa device, logcat, UIAutomator XML, gfx framestats, meminfo, top CPU và display refresh.
4. Instrumentation phát event có prefix vào log phát triển. Core parse JSON cho route/network/render/JS task.
5. `observe_screen` hợp nhất ảnh, số node UI, route, performance, network summary và lỗi gần đây.
6. SessionStore lưu timeline/reference trong SQLite WAL; PNG, JSON UI tree, `.perfetto-trace` và summary nằm dưới `.artifacts/sessions/<id>`.

## Provider strategy

Android v1 dùng ADB trực tiếp để có đường chạy offline, deterministic và dễ kiểm thử. Kiến trúc vẫn provider-neutral ở schema/core boundary để có thể thêm agent-device hoặc Expo MCP mà không đưa business logic vào adapter.

## Security và overhead

- Network URL được redact token/API key/password/secret.
- Body capture tắt mặc định; opt-in bị giới hạn preview và in cảnh báo.
- Screenshot/UI tree chỉ on-demand; không có polling tần suất cao.
- Logcat được giới hạn số dòng; response `observe` chỉ trả summary UI thay vì toàn cây.
- Binary lớn luôn là artifact path, không là base64 MCP payload.

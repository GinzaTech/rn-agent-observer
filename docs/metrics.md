# Metrics contract

Mọi metric dùng cùng envelope:

```json
{
  "name": "cpu_percent",
  "value": 35.7,
  "unit": "%",
  "source": "adb-top",
  "timestamp": "2026-08-21T06:01:06.294Z",
  "available": true
}
```

Không có tín hiệu thì trả rõ ràng:

```json
{
  "name": "js_fps",
  "value": null,
  "unit": "fps",
  "source": "adb-dumpsys-gfxinfo",
  "timestamp": "2026-08-21T06:01:06.294Z",
  "available": false,
  "reason": "ADB does not expose a trustworthy JS FPS signal"
}
```

## Metrics Android v1

| Tên                  | Unit   | Source                | Cách hiểu                                                               |
| -------------------- | ------ | --------------------- | ----------------------------------------------------------------------- |
| `ui_fps`             | fps    | `adb-dumpsys-gfxinfo` | `min(refreshHz, 1000 / averageFrameMs)` trong tối đa 240 frame gần nhất |
| `frame_time_ms`      | ms     | gfx framestats        | Trung bình frame hoàn tất hợp lệ                                        |
| `worst_frame_ms`     | ms     | gfx framestats        | Frame chậm nhất trong sample                                            |
| `dropped_frames`     | frames | gfx framestats        | Số frame vượt budget `1000 / refreshHz`                                 |
| `frame_sample_count` | frames | gfx framestats        | Mẫu dùng để diễn giải dropped/average                                   |
| `display_refresh_hz` | Hz     | `adb-dumpsys-display` | Refresh rate Android đang báo                                           |
| `memory_mb`          | MB     | `adb-dumpsys-meminfo` | TOTAL PSS của process app                                               |
| `cpu_percent`        | %      | `adb-top`             | Snapshot process; có thể trên 100% khi dùng nhiều CPU core              |
| `js_blocking_ms`     | ms     | RN instrumentation    | Long task gần nhất trong cửa sổ 5 phút; nếu không có thì unavailable    |
| `js_fps`             | fps    | unavailable           | Không suy diễn từ ADB                                                   |

`ui_fps` là trung bình trong cửa sổ, vì vậy một long JS task đơn lẻ có thể không kéo sustained FPS xuống. Đọc cùng `worst_frame_ms`, `dropped_frames`, `frame_sample_count` và `js_blocking_ms`.

## Network summary

`averageLatencyMs`, p50/p95/p99 được tính từ duration đã quan sát. `failedRequests` gồm network error hoặc HTTP status từ 400. `totalBytes` chỉ cộng byte count có sẵn; không suy đoán khi header/fixture không cung cấp.

## Nguyên tắc

- Không tổng hợp số giả hoặc đổi UI FPS thành JS FPS.
- Timestamp là UTC ISO 8601 của nguồn gần nhất.
- Diagnosis `confidence` là heuristic score `heuristic-v1`, không phải xác suất thống kê. `confidenceBasis` liệt kê signal strength và sample/source strength; ít mẫu sẽ gate score xuống.
- Ngưỡng diagnosis cấu hình được qua core, các flag CLI `diagnose --ui-fps-low/--ui-fps-critical/--js-blocking/--js-blocking-high/--slow-request/--very-slow-request/--render-count`, và MCP `diagnose`; mặc định nằm trong `DEFAULT_THRESHOLDS`.
- CPU là snapshot, không phải average session.
- Perfetto trace là artifact thô; snapshot metrics không giả vờ thay thế trace analysis.
- Nếu chữ ký 5 metric frame giống hệt lần đọc trước, observer trả chúng `available: false` với reason `No new gfx frame samples...`; không tái sử dụng cửa sổ gfxinfo cũ như một benchmark mới.

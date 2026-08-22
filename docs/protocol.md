# CLI và MCP protocol

## Môi trường chung

| Biến                       | Ý nghĩa                                                                         |
| -------------------------- | ------------------------------------------------------------------------------- |
| `RN_OBSERVER_PROJECT_ROOT` | App đích; mặc định là current working directory                                 |
| `RN_OBSERVER_DEVICE_ID`    | ADB serial; bắt buộc khi có nhiều device ready                                  |
| `RN_OBSERVER_APP_ID`       | Android package override; nếu bỏ trống đọc `expo.android.package` từ `app.json` |
| `RN_OBSERVER_SESSION_ID`   | Ghi event/artifact vào session đã tồn tại giữa các tiến trình CLI               |
| `RN_OBSERVER_ADB`          | Đường dẫn executable ADB tùy chọn                                               |
| `RN_OBSERVER_METRO_URL`    | Base URL Metro cho `devtools-export` (mặc định `http://127.0.0.1:8081`)         |

## CLI

```text
status
devices | device-info | launch | reload [--fast]
app-state | device-network [--window MS] | routes
metro-network [--duration MS] [--metro URL]
screenshot | ui-tree | snapshot [--interactive] | understand-screen [--stuck-after MS]
tap (--test-id ID | --ref E1 [--settle MS] | --x X --y Y)
swipe --from X,Y --to X,Y [--duration MS]
type-text --text VALUE | back | deep-link --uri URI
permissions [list] | permissions grant --perm NAME | permissions revoke --perm NAME
assert (--test-id ID | --text VALUE) [--visible true|false]
a11y-audit | app-data [--namespace NAME]
logs [--level LEVEL] [--keyword TEXT] [--limit N]
performance | render-stats
network [summary] | network requests
observe
trace start [--duration MS] | trace stop TRACE_ID
record start [--duration MS] | record stop RECORDING_ID
replay run SCRIPT.json
replay export SESSION_ID
artifacts cleanup [--days N] [--dry-run]
session start | session stop [SESSION_ID] | session get SESSION_ID
diagnose [--ui-fps-low N --ui-fps-critical N --js-blocking N --js-blocking-high N --slow-request N --very-slow-request N --render-count N]
compare BEFORE.png AFTER.png [--before-ui TREE.json --after-ui TREE.json]
devtools-export [--duration MS] [--metro URL]
devtools-profile [--duration MS] [--metro URL]
```

CLI in JSON ra stdout. Lỗi in JSON ra stderr và exit code 2.

## MCP stdio

44 tools hiện có:

| Nhóm              | Tools                                                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status/device/app | `observer_status`, `device_list`, `device_info`, `app_launch`, `app_reload`                                                                                                |
| Fallback evidence | `app_state`, `get_device_network`                                                                                                                                          |
| Screen/action     | `screenshot`, `get_ui_tree`, `snapshot`, `understand_screen`, `press`, `tap`, `swipe`, `type_text`, `back`, `open_deep_link`                                               |
| Device state      | `list_permissions`, `set_permission`, `list_routes`                                                                                                                        |
| Evidence          | `get_logs`, `performance_snapshot`, `start_trace`, `stop_trace`, `get_react_render_stats`, `get_network_requests`, `get_network_summary`, `get_app_data`, `observe_screen` |
| DevTools/CDP      | `devtools_export`, `devtools_profile`, `get_metro_network`                                                                                                                 |
| Recording         | `start_recording`, `stop_recording`                                                                                                                                        |
| Verify/repeat     | `assert_element`, `a11y_audit`, `replay_run`, `replay_export`                                                                                                              |
| Maintenance       | `cleanup_artifacts`                                                                                                                                                        |
| Session/analysis  | `start_session`, `stop_session`, `get_session`, `diagnose`, `compare_screens`                                                                                              |

Ví dụ client config sau khi build:

```json
{
  "mcpServers": {
    "rn-agent-observer": {
      "command": "node",
      "args": [
        "C:\\absolute\\rn-agent-observer\\packages\\mcp-server\\dist\\server.js"
      ],
      "env": {
        "RN_OBSERVER_PROJECT_ROOT": "C:\\absolute\\expo-app",
        "RN_OBSERVER_DEVICE_ID": "emulator-5554"
      }
    }
  }
}
```

`compare_screens` nhận `before`, `after` và cặp optional `before_ui_tree`/`after_ui_tree`. Cung cấp cả hai UI tree path để nhận `added`, `removed`, `changed` bên cạnh pixel similarity/region.

`devtools_export` nhận `duration_ms` (1000–60000, mặc định 5000) và `metro_url` tùy chọn. Kết quả gồm console entries, exceptions, heap usage và artifact JSON đầy đủ. `observe_screen` mặc định gồm `app_state` trong `include`.

`app_reload` nhận `mode` (`app` mặc định | `metro` — JS-only qua CDP, tự fallback về `app` khi Metro không khả dụng và ghi `fallbackReason`) và `metro_url` tùy chọn.

`get_metro_network` thu per-request network qua CDP Network domain trong `duration_ms` (1000–30000, mặc định 5000) — không cần app instrumentation; cần RN 0.83+.

`devtools_profile` ghi JS CPU profile trong `duration_ms` (1000–60000) thành artifact `.cpuprofile`.

`start_recording`/`stop_recording` quay màn hình mp4, tối đa 180000ms/clip.

`snapshot` trả ref cho phần tử visible (`interactive_only: true` chỉ còn phần tử tương tác). Trong session, registry identity giữ ref ổn định qua reorder/scroll và không tái sử dụng ref đã mất; state nằm trong thư mục session. `press` tap theo ref; cung cấp `settle_ms` để sau settle nhận diff `+/-/=`.

`understand_screen` hợp nhất screenshot, UIAutomator, app-state và error log gần đây thành state có cấu trúc: `content`, `loading`, `error`, `empty`, `blank`, `background` hoặc `not-running`. Response có route instrumentation (hoặc `null`), `headline`, `visibleText`, action refs, issue severity/evidence/suggestion, fingerprint và ba artifact path. Gọi lại cùng màn loading sau `stuck_after_ms` để nhận `loading-stuck`. Đây là heuristic evidence; agent phải mở `screenshotPath` và tái hiện trước khi sửa. Nội dung text-field được redact trước khi persist/return.

`replay_run` nhận path script JSON `{ steps: [{ action: "tap"|"swipe"|"type-text"|"back"|"deep-link"|"reload"|"assert"|"wait"|"screenshot", ... }] }`; dừng ở step fail đầu trừ `continueOnError: true`.

`stop_session` tự ghi replay JSON từ interaction timeline. `replay_export` export lại một session theo yêu cầu; text nhập không được lưu để tránh lộ secret.

`diagnose`/MCP `diagnose` cho phép override 7 threshold. Finding trả `confidenceBasis`; confidence là heuristic score được gate bởi sample/source strength, không phải xác suất. Input threshold sai quan hệ trả `DIAGNOSIS_THRESHOLDS_INVALID`.

`cleanup_artifacts` mặc định 14 ngày, hỗ trợ dry-run, bỏ qua active session, và xóa metadata SQLite theo transaction cùng session directory.

Khi một command tạo timeline event mà không có session, core phát `EVIDENCE_NOT_RECORDED`. CLI ghi cảnh báo ra stderr; MCP host nhận warning từ stderr server.

`assert_element` cần `test_id` hoặc `text`, tùy chọn `visible`; trả `passed` + evidence. `get_app_data` đọc snapshot state mới nhất theo namespace từ instrumentation `reportAppData`. `list_routes` suy sitemap expo-router từ thư mục `app/`.

## Error contract

```json
{
  "error": {
    "code": "DEVICE_NOT_FOUND",
    "message": "No ready Android device is available",
    "recoverable": true,
    "suggestion": "Start an emulator or connect a device"
  }
}
```

MCP đặt `isError: true`; raw stack trace không đi qua response thông thường.

# Cấu trúc dự án RN Agent Observer

Tài liệu này giúp contributor tìm đúng nơi để đọc hoặc sửa. Kiến trúc runtime và
trust boundary chi tiết nằm trong [architecture](architecture.md); contract CLI/MCP
nằm trong [protocol](protocol.md).

## Sơ đồ repository

```text
rn-agent-observer/
├── apps/
│   └── demo-expo/              # Expo/RN golden fixture, không phải app production
├── packages/
│   ├── schemas/                # Zod schemas + shared types, không có runtime logic
│   ├── core/                   # Toàn bộ collection/policy/session/analysis logic
│   ├── cli/                    # Adapter lệnh rn-observe
│   ├── mcp-server/             # Adapter MCP stdio
│   └── rn-instrumentation/     # Telemetry development-only chạy trong app
├── docs/                       # Hướng dẫn người dùng, protocol, test và security
├── examples/                   # Integration example có thể copy/review
├── schemas/                    # JSON Schema công khai cho config/contract
├── scripts/                    # Release/package/export/manifest verification
├── skills/                     # Workflow instruction cho coding agent
├── .github/                    # CI, publish, issue/PR/security community workflow
├── action.yml                  # Reusable strict evidence gate for consumer CI
├── AGENTS.md                   # Quy tắc làm việc bắt buộc trong repository
├── package.json                # Root scripts và toolchain contract
├── pnpm-workspace.yaml         # Workspace membership
├── pnpm-lock.yaml              # Dependency graph đã khóa
├── .pnpmfile.cjs               # Reviewed transitive dependency security pins
└── tsconfig.base.json          # Strict TypeScript baseline
```

`node_modules`, `.pnpm`, `dist`, native build tree và `.artifacts` là generated hoặc
runtime state; chúng không phải source và không được commit.

## Hướng phụ thuộc

```text
schemas <- core <- cli
                <- mcp-server

demo-expo -> rn-instrumentation
observed development app -> rn-instrumentation
```

- `schemas` định nghĩa contract nhưng không gọi ADB, filesystem hay session.
- `core` là implementation duy nhất của hành vi runtime.
- CLI và MCP chỉ parse/validate input, gọi Core rồi map output/progress/error.
- `rn-instrumentation` chạy trong React Native development bundle và không phụ
  thuộc Node-side Core.

Nếu cùng một rule xuất hiện ở CLI và MCP, đó thường là dấu hiệu logic cần chuyển về
Core hoặc schema.

## Bản đồ `packages/core/src`

| Thư mục         | Trách nhiệm                                                       |
| --------------- | ----------------------------------------------------------------- |
| `adb/`          | Process-safe ADB client và parser device/UI/logcat/gfx/memory/CPU |
| `artifacts/`    | Ghi artifact contained trên đĩa, hash và metadata                 |
| `config/`       | Config parser, defaults, containment và active trust gate         |
| `comparison/`   | Pixel diff và structural UI-tree comparison                       |
| `coverage/`     | Route/action inventory, checkpoint, merge/delta                   |
| `dashboard/`    | Privacy-reduced report và loopback read-only server               |
| `devtools/`     | Metro discovery, CDP queue/export/network/profile/reload          |
| `diagnosis/`    | Rule engine heuristic có evidence/confidence basis                |
| `doctor/`       | Probe readiness/capability, không giả lập runtime pass            |
| `evidence/`     | Evidence graph và correlation metadata                            |
| `integrations/` | Privacy-reduced interchange với external E2E runners              |
| `network/`      | Parse/redact/summarize telemetry và session runtime cache         |
| `performance/`  | Frame/CPU/memory/experiment/statistics/Perfetto orchestration     |
| `plugins/`      | Trusted analyzer/reporter và external process host boundary       |
| `privacy/`      | Redaction và content/path safety helper                           |
| `recording/`    | Android screenrecord lifecycle                                    |
| `refs/`         | Stable semantic refs cho snapshot/session                         |
| `replay/`       | Replay schema/export/runner và action policy                      |
| `security/`     | Passive audit, SBOM/OSV và bounded active scenarios               |
| `session/`      | SQLite WAL timeline, artifacts, share bundle                      |
| `suite/`        | Suite authoring/loader/runner/assertion/reporter/CI outcome       |
| `targets/`      | Built-in/external target provider contract                        |
| `ui/`           | Screen understanding và source/runtime UI correlation             |

`packages/core/src/index.ts` là façade `ObserverCore`. Nó wiring các module trên,
nhưng module chuyên biệt vẫn nên giữ logic và test gần nhau.

## Package public

| Package                                 | Entry point                                             | Dành cho                         |
| --------------------------------------- | ------------------------------------------------------- | -------------------------------- |
| `@rn-agent-observer/schemas`            | `dist/index.js`                                         | Consumer cần parse/type contract |
| `@rn-agent-observer/core`               | root, `/plugins`, `/dashboard`, `/targets`, `/coverage` | Integration Node/agent host      |
| `@rn-agent-observer/cli`                | binary `rn-observe`                                     | Developer/CI local               |
| `@rn-agent-observer/mcp-server`         | binary `rn-observer-mcp`                                | MCP client/AI agent              |
| `@rn-agent-observer/rn-instrumentation` | root, `/babel-plugin`                                   | React Native development app     |

Năm package dùng cùng version và được smoke-test dưới dạng tarball. Root workspace
và `demo-expo` luôn private.

## Demo Expo

`apps/demo-expo` là golden application-under-test:

- `PerformanceLab` cố ý block JS khoảng 100 ms;
- `NetworkLab` dùng fixture nội bộ 0/500/2000 ms và HTTP 503;
- `RenderLab`, `AnimationLab`, `ErrorLab`, `VisualLab` tạo evidence xác định;
- `SecurityLab` chỉ bật bằng build flag và không thuộc release-default manifest.

Không “tối ưu” hai regression fixture đầu. Thay đổi demo phải giữ semantic
`testID`, chạy demo tests, Android/Hermes export và device scenario tương ứng.

## Source, generated state và local state

| Loại                    | Ví dụ                                                        | Commit?                |
| ----------------------- | ------------------------------------------------------------ | ---------------------- |
| Source                  | `packages/*/src`, `apps/demo-expo/*.tsx`, `scripts`          | Có                     |
| Public docs/examples    | `README.md`, `docs`, `examples`                              | Có, sau privacy review |
| Reviewed example config | `.rn-observer.*.example.json`                                | Có                     |
| Live observer config    | `.rn-observer.json`                                          | Không                  |
| Runtime evidence        | `.artifacts`, SQLite, screenshot, trace, recording, `.rnobs` | Không                  |
| Build output            | `dist`, `android`, `ios`, APK/AAB                            | Không                  |
| Dependency store        | `node_modules`, `.pnpm`                                      | Không                  |

Artifact lớn nằm dưới `<targetProject>/.artifacts`; SQLite chỉ giữ metadata/path.
Config và artifact root đều phải contained trong target project sau khi resolve
symlink/junction.

## Đặt thay đổi ở đâu

- Thêm field public: sửa schema + schema test trước, rồi Core/adapters/docs.
- Thêm device/runtime behavior: Core + test; CLI/MCP chỉ expose.
- Thêm CLI flag: CLI parse/validation, truyền typed option vào Core.
- Thêm MCP tool: schema đóng, bounded input/output, gọi cùng Core method.
- Thêm app telemetry: `rn-instrumentation`, fail-closed khi không phải `__DEV__`.
- Thêm report/security rule: ghi source, availability, timestamp, limitation và
  privacy boundary.
- Thêm platform: external target provider/conformance trước; không đổi matrix thành
  supported nếu chưa có exact runtime evidence.

## Kiểm tra theo phạm vi

```powershell
# Lặp nhanh một package/file
pnpm --filter @rn-agent-observer/core test
pnpm --filter @rn-agent-observer/core test -- runtime-telemetry-cache

# Definition of done repository/release
pnpm check
pnpm release:check
```

Mọi thay đổi source phải kết thúc bằng `pnpm check`. Public/release/package/export
change phải chạy `pnpm release:check`; runtime-facing change cần thêm device
workflow trong [testing](testing.md) và [test blueprint](test-blueprint.md).

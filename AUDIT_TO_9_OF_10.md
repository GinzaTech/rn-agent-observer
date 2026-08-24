# Đánh giá và nghiệm thu RN Agent Observer ở mốc 9/10

> Snapshot: **2026-08-24**, workspace version **2.4.0**.
>
> Kết luận hiện tại: **9.1/10, đã nghiệm thu end-to-end trên Android vật lý và
> ba API tier emulator**.
> Thiết bị: Xiaomi `23013PC75G` / `mondrian`, Android 15 API 35; serial và local
> session ID được lược khỏi tài liệu public. Session đã hoàn tất.

## 1. Điểm đa chiều

| Hạng mục                         | Điểm hiện tại | Evidence / giới hạn chính                                                                    |
| -------------------------------- | ------------: | -------------------------------------------------------------------------------------------- |
| Kiến trúc và khả năng mở rộng    |           9.2 | Core provider-neutral, schema versioned, CLI/MCP adapter mỏng, external provider fail-closed |
| Tính trung thực của evidence     |           9.5 | Availability rõ; PID-pinned telemetry sống qua logcat rollover; không ghép UI app khác       |
| Security, privacy và safety      |           9.1 | Active trust hai lớp, allowlist app/device/risk, redaction/HMAC, OSV strict hiện `PASS`      |
| Chất lượng code và regression    |           9.2 | Strict TypeScript, zero-warning lint, test đa package, package-consumer smoke                |
| Release và supply chain          |           9.2 | Frozen lock, 5 tarball smoke, SBOM/OSV, Android/Hermes export nằm trong `release:check`      |
| Performance methodology          |           9.1 | Sampling/budget/baseline/compatibility có contract và fixture 100ms đã chạy trên device      |
| Developer experience và tài liệu |           9.0 | CLI/MCP/docs/fixtures, compatibility matrix, Maestro integration example                     |
| Community và ecosystem           |           8.9 | Apache-2.0, templates/provider SDK và runbook AVD tái lập; chưa có conformance farm          |
| Platform/device coverage         |           8.9 | Physical API 35/arm64 + emulator API 24/30/36 x86_64; chưa có broad OEM matrix               |

Điểm tổng có trọng số: **9.1/10**. Điểm này bao gồm source/release gate và bốn exact
runtime fixtures hiện tại; không suy rộng thành hỗ trợ mọi OEM/ABI hay production
benchmark.

## 2. So sánh với các nhóm dự án tương tự

| Nhóm dự án                       | Họ mạnh hơn Observer                                   | Observer mạnh hơn / vai trò phù hợp                                          |
| -------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Maestro / Appium                 | Black-box automation đa nền tảng, ecosystem runner lớn | Evidence model, source/runtime correlation, session graph, privacy boundary  |
| Detox                            | RN E2E synchronization và assertion workflow           | Quan sát app ngoài test harness, native/JS/network/perf evidence hợp nhất    |
| Expo MCP / agent-device          | Expo-native context và automation đa nền tảng rộng hơn | Local evidence persistence, explicit availability, assurance/security suites |
| React Native DevTools            | Component/props/profiler/JS debugging tương tác sâu    | Automation/export, ADB/native evidence, replay/report và audit trail         |
| Android Studio / Perfetto        | Native profiling và trace analysis chuyên sâu          | Agent-facing normalization, correlation, policy và workflow lặp tự động      |
| Firebase Test Lab / device farms | Ma trận thiết bị/API và parallel scale                 | Local-first/private evidence, source-aware diagnosis, không phụ thuộc cloud  |

Định vị đúng: Observer là **evidence and assurance layer cho agent trên Android**,
không phải bản thay thế toàn phần cho E2E runner, DevTools, profiler hay device
farm. Ví dụ `examples/maestro` cho phép runner điều khiển flow và Observer thu
evidence trong cùng session.

## 3. Những phần đã sửa để đạt chuẩn 9/10 nguồn

### Runtime và evidence integrity

- `ui-model` kiểm tra app state trước khi ghép native UI với source.
- Target stopped/background trả `target-not-running` hoặc
  `target-not-foreground`, không tạo finding giả từ launcher/app khác.
- Schema/MCP phân biệt model unavailable với element có visibility `unknown`.
- Có regression test cho direct UI model và auto-capture khi `session stop`.
- Passive security audit công khai exact input scope và không gọi artifact-only
  scan là manifest audit.
- Telemetry đã parse/redact được giữ trong state của active session, có giới hạn
  kích thước và PID boundary; raw log/body không được persist. `press`/`tap`/`back`/
  `swipe`/`type-text` chụp telemetry ngay sau action để chống logcat rollover.
- Khi PID đổi, toàn bộ process-owned cache bị xóa để bằng chứng của process cũ
  không bị gán cho snapshot process mới. Network/render/route/JS-task/app-data/UI
  model đọc lại cache session khi logcat hiện tại không còn event.

### Security và supply chain

- Telemetry có HMAC-SHA-256 integrity path; secret/body capture vẫn fail-closed.
- Active config cần cả policy allowlist và process-side trust; config trong repo
  không thể tự cấp quyền.
- Metro được override từ 0.84.4 lên security patch 0.84.5, loại dependency
  `image-size` có hai DoS advisory không có patched release.
- `uuid` transitively từ `xcode` được nâng 7.0.3 lên CommonJS-compatible 11.1.1.
- Hook `.pnpmfile.cjs` áp hai pin trên cho cả pnpm 9.6 của repo và wrapper pnpm
  mới hơn; `pack:check` chặn release nếu lockfile tái xuất hiện bản dễ tổn thương.
- Audit OSV strict ngày 2026-08-24: **673/673 components queried, 0 advisory,
  `PASS`**. SBOM và report nằm trong `.artifacts/sessions/standalone/`.

### Release và reproducibility

- `pnpm release:check` bao gồm lint, format, build, tests, MCP, CLI version, 5
  public tarball/clean-consumer smoke và Android/Hermes export.
- Android export dùng OS temp directory, kiểm `metadata.json` và đúng một Hermes
  bundle, rồi chỉ xóa path có prefix an toàn do script tự tạo.
- CI prebuild/check default manifest, SecurityLab opt-in, rồi regenerate/check
  default lần nữa để phát hiện config contamination.
- Export cũ được chuyển khỏi source tree vào
  `.artifacts/manual-exports/export-android-audit-2026-08-24`.

### Community readiness

- `docs/compatibility.md` tách `SUPPORTED`, `FIXTURE_VERIFIED`, `HOST_ONLY`,
  `NOT_VERIFIED`, `EXTENSION_ONLY` theo exact target.
- `examples/maestro/demo-observer.yaml` và README minh họa E2E runner + Observer
  session mà không nhập tài khoản, permission hay Internet data.
- README định vị rõ giới hạn với Maestro/Detox/Appium/device farm.
- GitHub đã có issue/feature/RFC templates, private security reporting,
  Dependabot và protected provenance publication workflow.

### Device UX phát hiện trong nghiệm thu

- Bốn status text của PerformanceLab, NetworkLab, RenderLab và ErrorLab đã được
  gán màu `#cbd5e1`; lỗi chữ đen trên nền `#0f172a` được phát hiện bằng screenshot
  thật, không phải bằng source scan.
- Compare trước/sau trên cùng màn hình và cùng text đạt similarity `0.999446`,
  chỉ 1,369/2,473,200 pixel thay đổi trong vùng chữ; UI tree 36 -> 36, không thêm,
  xóa hay đổi semantic node.

## 4. Gate nghiệm thu nguồn

Các gate bắt buộc trước khi thay đổi trạng thái tài liệu này:

```powershell
pnpm install --frozen-lockfile
pnpm release:check
pnpm rn-observe security dependencies --lockfile pnpm-lock.yaml --strict
git diff --check
```

Trạng thái evidence gần nhất:

| Gate                                   | Trạng thái                                    |
| -------------------------------------- | --------------------------------------------- |
| Frozen lockfile                        | `PASS`                                        |
| Build                                  | `PASS`                                        |
| Android/Hermes export                  | `PASS`, 2 files, 1 Hermes bundle              |
| OSV dependency audit                   | `PASS`, 673 queried, 0 advisory               |
| Full `release:check` sau thay đổi cuối | `PASS`, 352/352 tests + MCP/package/export    |
| Physical Android positive flow         | `PASS`, exact target pinned, session complete |
| Emulator API 24/30/36 positive flow    | `PASS`, ba AVD/session tạm đã cleanup         |

## 5. Cấu hình demo và giới hạn an toàn

Việc xóa `apps/demo-expo/.rn-observer.json` sau acceptance là có chủ đích: active
config tạm đã pin exact serial vật lý, app ID và action allowlist. Không để file
đó trong repo nhằm tránh reuse nhầm hay tạo cảm giác repo tự cấp quyền. Demo chỉ giữ
`.rn-observer.active-security.example.json`; mỗi lần dùng phải copy/review, đổi exact
device serial và vẫn cần `RN_OBSERVER_TRUST_ACTIVE_CONFIG=1` ở process.

Native debug APK mặc định đã build thành công và không chứa CAMERA permission:

- path: `.artifacts/device-ready/rn-agent-observer-demo-2.4.0-debug.apk`;
- size: `135,564,715` bytes;
- SHA-256: `1A87F4136A3030654C4B25271B4D6FF2263F3D2315E9CCA85FD259288B5A0735`;
- application ID: `dev.rnagentobserver.demo`.

Không chạy active flow trên app/tài khoản production. PerformanceLab chặn JS 100ms
và NetworkLab trả fixture 0/500/2000ms + 503 là regression fixture có chủ đích,
không được "tối ưu" khỏi demo.

## 6. Acceptance đã chạy trên Android

### 6.1 Thiết bị vật lý

| Evidence                    | Kết quả                                                                    |
| --------------------------- | -------------------------------------------------------------------------- |
| Target                      | Xiaomi `23013PC75G`, `mondrian`, Android 15/API 35, arm64; serial redacted |
| Build                       | Demo 2.4.0 debug APK, SHA-256 `1A87F...A0735`, CAMERA không được declare   |
| Session                     | Local session ID redacted, `complete`                                      |
| Session integrity           | 268 events, 67 artifacts, 24 telemetry captures, 0 capture failure         |
| Performance fixture         | JS task `100.0005ms`, source `rn-instrumentation`, confidence `0.99`       |
| Diagnosis                   | `Long JS task observed`, high, confidence `0.98`                           |
| Native performance sample   | 68.51 FPS, 14.60ms average frame, 51 samples; dev-build evidence only      |
| Network fixtures            | 200/15.05ms và 503/102.30ms; token redacted; 0 body preview persisted      |
| Network statistics boundary | 2 latency samples, `percentileLowConfidence: true`                         |
| Render/app data             | 46 profiler commits; allowlisted `render-lab` state captured               |
| Logcat rollover             | Raw JS-task lines `0`, session cache JS-task `1`; performance/UI giữ data  |
| Visual contrast             | Similarity `0.999446`; 1,369 changed pixels; UI tree không đổi             |
| Negative foreground path    | Android Settings foreground -> `target-not-foreground`, không ghép UI      |
| Final checkpoint            | `PerformanceLab`, `content`, runtime errors `0`                            |

Artifact gốc nằm dưới local path
`apps/demo-expo/.artifacts/sessions/<session-id>/` và không được commit. Summary,
evidence graph và screenshot contrast được tạo tự động khi stop; public report chỉ
giữ số liệu tổng hợp đã review.

Giới hạn: pin còn 34%, nhiệt độ battery service 40.0 C, app là development build,
mẫu frame/network nhỏ và chỉ có một physical OEM. Vì vậy số đo xác nhận pipeline
hoạt động và finding có evidence; không phải benchmark production.

### 6.2 Ma trận emulator API 24/30/36

Ba AVD mới, tạm thời đã chạy cùng APK/kịch bản trên Google x86_64 images:

- cài/launch/foreground và `observe` PASS ở cả ba tier;
- `understand-screen` nhận Home/NetworkLab `content`; `ui-model` cuối có 7 action
  visible/pressable, 0 interaction error;
- fixture JS trả lần lượt `100.0103ms`, `100.0002ms`, `100.0003ms` và diagnosis
  long-task đúng source;
- mỗi tier có 2 network request/1 failure, token query redacted và percentile
  low-confidence;
- mỗi session `complete`, replay 21 bước;
- API 24/30 giữ gfx row unavailable; API 24 giữ CPU unavailable, không điền 0;
- toàn bộ AVD tạm, image API 24/30 cài riêng, data root và active config đã cleanup;
  AVD API 36.1 có sẵn trước run được giữ nguyên.

Chi tiết fixture, lệnh tái lập và cleanup ở
[`docs/android-device-matrix.md`](docs/android-device-matrix.md). Đây mới là ba API
tier trên một host/emulator engine, chưa phải 2 OEM mỗi tier hay cloud device farm.

## 7. Giá trị nên cung cấp tiếp cho cộng đồng sau mốc 9/10

Ưu tiên theo tác động:

1. Duy trì Android device-farm conformance: lấy ba API tier local hiện có làm
   baseline, mở rộng tới ít nhất 2 OEM/tier và chạy định kỳ; công khai aggregate
   report, không public raw UI data.
2. Provider conformance kit cho iOS/web/Windows: golden JSON-RPC fixtures, timeout /
   cancellation/path/privacy contract và badge chỉ khi provider vượt test suite.
3. Adapter chính thức cho Maestro/Detox/Appium: liên kết runner result với session /
   artifact hashes thay vì nhập lại toàn bộ automation engine.
4. Protocol negotiation cho React Native DevTools/CDP và matrix RN/Expo được bot
   chạy nightly; không hứa wildcard version support.
5. A11y sâu hơn: contrast, focus order, dynamic type và screen-reader flow có
   evidence; giữ heuristic khác với certification.
6. Redacted community benchmark: bootstrap confidence interval, sample count,
   availability và exact target fingerprint; không tạo leaderboard từ metric thiếu.
7. Governance: maintainer rotation, RFC decision log, release cadence/SLA security,
   contributor guide cho plugin/provider và funded device lab.

Mốc 10/10 không nên được định nghĩa là "nhiều feature hơn". Nó cần device matrix có
thể lặp, ít nhất một provider ngoài Android đạt conformance, protocol compatibility
được theo dõi tự động và nhiều maintainer độc lập có thể release an toàn.

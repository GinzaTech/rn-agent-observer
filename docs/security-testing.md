# Security testing

RN Agent Observer cung cấp đường kiểm tra **passive, read-only** cho Android
project/artifact, đường supply-chain cho dependency đã khóa, và hai scenario active
có ràng buộc chặt cho app Android do người chạy sở hữu. Active mode mặc định tắt. Nó
không tự chạy exploit, fuzzing, MITM, credential replay, login, purchase hay mutation
account trên app. Mapping MASVS trong finding là aid để triage, không phải chứng nhận
MASVS hoặc bằng chứng pentest hoàn chỉnh.

## Quick start

Trỏ observer vào project cần kiểm tra, sau đó chạy:

```sh
pnpm rn-observe doctor
pnpm rn-observe init --dry-run
pnpm rn-observe security audit --strict
pnpm rn-observe security sbom --lockfile pnpm-lock.yaml
pnpm rn-observe security dependencies --lockfile pnpm-lock.yaml --strict
pnpm rn-observe suite run security --reporter json,html,junit,sarif,github --strict
```

Với package đã cài, thay `pnpm rn-observe` bằng `pnpm exec rn-observe`. Khi bỏ
`--lockfile`, command dùng `<project-root>/pnpm-lock.yaml`; nếu truyền path từ một
working directory khác, nên dùng absolute path đúng hệ điều hành.

Built-in `security` suite chạy passive audit và tạo SBOM. Nó **không** gọi OSV;
network advisory lookup chỉ xảy ra khi gọi rõ `security dependencies` hoặc MCP
`security_dependency_audit`. Điều này giúp CI không bất ngờ gửi inventory ra dịch
vụ ngoài.

## Passive Android audit

```text
security audit
  [--manifest PATH]...
  [--network-config PATH]...
  [--text PATH]...
  [--no-artifacts]
  [--strict]
```

Nếu không truyền manifest, scanner ưu tiên merged release
`android/app/build/intermediates/**/AndroidManifest.xml`, rồi fallback về
`android/app/src/main/AndroidManifest.xml`. Network security XML được resolve từ
`android:networkSecurityConfig`; `--network-config` cho phép chọn rõ file cần audit.
`--text` thêm file text để secret-scan. Mặc định scanner cũng đọc các artifact text
có extension `.json`, `.jsonl`, `.log`, `.md`, `.ndjson`, `.txt`, `.xml`; dùng
`--no-artifacts` khi chỉ muốn kiểm source/config.

Mọi path audit phải nằm trong project root cả theo lexical path và real path. Scanner
bỏ qua symlink khi walk artifact directory, tối đa 500 file/20 MiB tổng và 2 MiB cho
mỗi secret scan. Chạm giới hạn, thiếu manifest/XML hoặc parse không hoàn tất tạo
limitation/`NOT_VERIFIED`, không tạo PASS giả.

Các rule hiện kiểm tra:

- manifest release posture như `debuggable`, `usesCleartextTraffic`, backup,
  `testOnly`, exported component/permission exposure và dangerous permission cần
  review;
- network security config cho cleartext và trust user-added CAs theo build context;
- credential-shaped text như private key, AWS/GitHub/Slack/Stripe/Google key, JWT,
  bearer token, credential URL và assigned secret.

Secret scanner không trả giá trị match. Kết quả chỉ chứa kind, file/line/column,
length, preview `[REDACTED ...]` và HMAC-SHA256 fingerprint. Không có match chỉ chứng
minh bounded pattern set đã chạy trên input đó; encoded, split hoặc pattern chưa biết
vẫn là limitation.

## SBOM và dependency advisory audit

`security sbom` parse `pnpm-lock.yaml` và `package.json`, rồi ghi CycloneDX 1.6 JSON
vào local `security-report` artifact. Inventory giữ package name/version/purl,
integrity hash khi lockfile có, dependency edges và SHA-256 của BOM. Nó không chứng
minh dependency reachable hay exploitable trong runtime.

`security dependencies` sinh cùng SBOM rồi gửi package name/version đã khóa tới OSV
qua HTTPS `querybatch`. Audit bị bound ở 1.000 component, batch 250, timeout mặc định
30 giây và response tối đa 8 MiB. Kết quả:

| Trường hợp                                           | Outcome        |
| ---------------------------------------------------- | -------------- |
| Mọi component được query, không có advisory trả về   | `PASS`         |
| Có ít nhất một package/advisory match                | `FAIL`         |
| Timeout, cancel, HTTP/JSON/pagination/limit bất toàn | `NOT_VERIFIED` |

Một OSV match được báo severity bảo thủ ở mức medium cho tới khi maintainer đánh giá
reachability, exploitability và context. Không dùng danh sách advisory như kết luận
tự động rằng app có thể bị khai thác.

## Outcome và CI policy

| Outcome        | Cách đọc                                                                 |
| -------------- | ------------------------------------------------------------------------ |
| `PASS`         | Policy cụ thể đã chạy trọn với evidence và đạt yêu cầu                   |
| `FAIL`         | Evidence cho thấy policy/rule không đạt                                  |
| `NA`           | Không có kiểm tra áp dụng; không tương đương pass                        |
| `NOT_VERIFIED` | Thiếu input/capability, scan/query bất toàn, bị hủy hoặc không được phép |

`security audit` và `security dependencies` exit 1 khi outcome `FAIL`; thêm
`--strict` để `NOT_VERIFIED` cũng exit 1. `rn-observe ci` mặc định đã coi
`NOT_VERIFIED` là lỗi; `--allow-not-verified` chỉ nên dùng cho job khám phá có owner
theo dõi limitation. JSON/HTML/JUnit/SARIF/GitHub reporter giữ nguyên outcome;
JUnit map `NA`/`NOT_VERIFIED` thành skipped để tương thích format nhưng report JSON
vẫn là nguồn phân biệt hai trạng thái.

## Active action policy

Config sinh bởi `init` mặc định fail-closed:

```json
{
  "security": {
    "mode": "read-only",
    "allowedActions": ["read"],
    "allowedAppIds": [],
    "allowNetworkInterception": false,
    "allowSensitiveBodyCapture": false,
    "allowPersistentPermissionChanges": false,
    "allowedPersistentPermissions": []
  }
}
```

Custom suite có step risk `app-state`, `device-state`, `persistent-permission` hoặc
`network-interception` chỉ chạy khi config chuyển có chủ ý sang
`authorized-active`, app ID nằm trong `allowedAppIds` và risk nằm trong
`allowedActions`, đồng thời serial ADB đang chọn khớp chính xác
`target.deviceId`; interception còn cần flag riêng. `allowSensitiveBodyCapture`
không tự bật instrumentation capture. Chỉ dùng active mode trên development fixture
được ủy quyền, với allowlist hẹp và cleanup xác định.

Đoạn `security` tối thiểu này chỉ phù hợp khi `com.example.fixture` là app Android mà
người chạy có quyền kiểm thử; merge nó vào config do `init` tạo, không dùng nó như mẫu
để target app của người khác:

```json
{
  "target": {
    "deviceId": "emulator-5554"
  },
  "security": {
    "mode": "authorized-active",
    "allowedActions": ["read", "app-state", "device-state"],
    "allowedAppIds": ["com.example.fixture"],
    "allowNetworkInterception": false,
    "allowSensitiveBodyCapture": false
  }
}
```

Thay `emulator-5554` bằng exact serial từ `adb devices -l`; active mutation bị từ
chối khi CLI/env chọn serial khác hoặc config không pin device.

## Bounded active-security scenarios

Hai scenario active là Android-only. Executor tạo grant ngắn hạn và bind nó với đúng
app ID cấu hình, action và risk; user vẫn chịu trách nhiệm bảo đảm app là của mình/
được ủy quyền kiểm thử. Thiếu policy, app allowlist, baseline hoặc observation có cấu
trúc dẫn tới `NOT_VERIFIED`; runner không dispatch mutation rồi đoán kết quả.

| Scenario                                                                   | Risk cần allow | Bề mặt bị thay đổi                         | Giới hạn an toàn                                                                                                        |
| -------------------------------------------------------------------------- | -------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `security active deep-link` / MCP `security_active_deep_link`              | `app-state`    | Chỉ query của deep link fixture            | 1–6 mutation bounded: empty value, duplicate parameter, invalid percent encoding, oversized value, unexpected parameter |
| `security active permission` / MCP `security_active_permission_transition` | `device-state` | Một Android runtime permission được chỉ rõ | 1–4 grant/revoke transition; không chấp nhận permission có semantics account/credential                                 |

## Persistent permission setup (không phải active-security)

`permissions grant|revoke`, MCP `set_permission` và suite command
`permission-grant`/`permission-revoke` để lại trạng thái permission sau khi chạy.
Chúng **không** dùng executor active, không tự restore/relaunch và không được
authorize chỉ bằng `device-state`. Chỉ dùng chúng khi owner muốn setup state lâu dài
cho exact owned fixture:

```json
{
  "target": { "deviceId": "emulator-5554" },
  "security": {
    "mode": "authorized-active",
    "allowedActions": ["read", "persistent-permission"],
    "allowedAppIds": ["com.example.fixture"],
    "allowPersistentPermissionChanges": true,
    "allowedPersistentPermissions": ["android.permission.CAMERA"],
    "allowNetworkInterception": false,
    "allowSensitiveBodyCapture": false
  }
}
```

Core trước hết kiểm tra exact tên allowlist là runtime permission do app cấu hình
khai báo, rồi đọc lại sau ADB mutation. CLI yêu cầu
`--confirm-persistent-permission`; MCP requires
`confirm_persistent_permission_change: true`. A custom suite additionally needs the
same confirmation on the _calling_ `suite run`/`ci`/`run_quality_suite`/`verify_fix`
request, so a suite file cannot silently approve a persistent change.

Ví dụ CLI phải nêu rõ scenario, probe và state được phép; không có default “safe
screen” ngầm:

```sh
pnpm rn-observe security active deep-link \
  --scenario deep-link-query-fixture \
  --base-uri 'examplefixture://fixture/safe?item=fixture' \
  --probe empty-item:empty-value:item \
  --allow-state content \
  --max-errors 0

pnpm rn-observe security active permission \
  --scenario camera-transition-fixture \
  --permission android.permission.CAMERA \
  --probe revoke-camera:revoke \
  --allow-state content \
  --max-errors 0
```

Malformed deep-link scenario chỉ tạo mutation query và từ chối URI/protocol/semantics
liên quan login, account, credential, payment/purchase, order, profile, reset,
transfer hoặc network interception trước khi mở link. Nó capture baseline trước khi
probe, sau đó chỉ đánh giá process state, allowed screen state và số error/fatal log
đã khai báo. Route không được suy ra; raw log message không xuất hiện trong finding,
chỉ metadata đã redact/fingerprint.

Permission scenario đọc original state trước mọi mutation. Sau mỗi probe nó đọc lại
state và capture observation; trong `finally`, cleanup chạy trong một timeout riêng
để restore original state ngay cả khi probe timeout, abort hoặc executor lỗi. Trên
Android, grant/revoke có thể kết thúc process: nếu PID trước mutation không còn,
recovery chỉ được thực hiện sau khi exit-info của đúng app/PID khớp với transition
permission dự kiến. Thiếu hoặc không khớp evidence này không được suy diễn là
recovery; sau một recovery đã xác minh, observation đầu `blank`/`loading` chỉ được
re-observe thêm một lần có bound trước khi phán định. Restore thất bại là `FAIL`,
restore không xác minh được là `NOT_VERIFIED`; dừng chạy và khôi phục permission thủ
công trước scenario tiếp theo nếu cleanup fail. Cả hai scenario đều giới hạn timeout
scenario 30 giây, settle tối đa 2 giây, error log tối đa 20 và không thực hiện login,
purchase, account mutation hoặc network interception.

`PASS` ở đây chỉ nghĩa là những mutation/probe đã khai báo hoàn tất với observation
phù hợp. Nó không chứng minh deep link/permission flow an toàn cho mọi input, không
phải dynamic pentest rộng hay security certification.

### Bằng chứng runtime hẹp trên demo AVD (2026-08-23)

Một Android AVD do nhóm sở hữu đã chạy development fixture `SecurityLab` của demo.
Probe deep-link duplicate-query trả `PASS`; UI giữ `content`, hiện `REJECTED` và
`unexpected-query`, không hiện URI/query thô. Scenario CAMERA grant/revoke cũng
`PASS` và cleanup restore permission ban đầu. Revoke ghi nhận process exit
`PERMISSION CHANGE`; recovery chỉ xảy ra sau khi PID và exit-info khớp, rồi cần
`recoveryObservationAttempts: 2` mới quan sát lại được `content`.

Đây chỉ là evidence cho fixture, AVD và các probe đã khai báo. Nó không nâng trạng
thái của app ngoài, permission/deep-link khác, thiết bị khác, hoặc thành dynamic
pentest/certification. Chi tiết phạm vi evidence nằm trong [testing.md](testing.md).

## Privacy và artifact handling

- Artifact mặc định được phân loại `sensitive`, `allowShare: false`, retention 14
  ngày và nằm trong project root. Chạy `artifacts cleanup --dry-run` trước cleanup.
- Passive report có thể chứa absolute file path; SBOM/OSV report chứa package
  inventory. Review/redact trước khi upload issue, CI artifact hoặc gửi bên thứ ba.
- Network body capture tắt mặc định. URL/header/body preview instrumentation dùng
  allowlist fail-closed; chỉ bật preview trong development fixture không chứa dữ
  liệu thật.
- MCP artifact resource chỉ trả metadata, nhưng session resource có timeline. Dùng
  `rnobs://dashboard`/`dashboard_snapshot` khi cần aggregate đã loại payload/path.
- Dashboard không nhúng secret, binary, base64, source/project/artifact path hoặc
  finding text; file HTML vẫn nên được giữ local trừ khi project policy cho phép.
- Portable bundle `.rnobs` là cách share hẹp hơn session resource: mặc định chỉ có
  metadata session/artifact, bytes và SHA-256; không có timeline, path, binary hay
  artifact content. Binary embedding luôn tắt. Text embedding là opt-in và chỉ được
  phép khi file bounded, UTF-8 hợp lệ và secret scan hoàn tất; entry bị exclude hoặc
  không kiểm chứng khiến bundle là `NOT_VERIFIED`. Bên nhận nên verify SHA-256,
  canonical format, policy và limits trước khi tin bundle; verifier không extract
  artifact từ bundle.

`session share` và MCP `export_session_share_bundle` yêu cầu
`artifacts.allowShare: true`, vốn mặc định là `false`. Hãy bật nó riêng cho project
đã review evidence, rồi export path relative contained dưới artifact root; writer từ
chối ghi đè. Ví dụ:

```powershell
$bundle = pnpm rn-observe session share SESSION_ID --output shares/review.rnobs | ConvertFrom-Json
pnpm rn-observe bundle verify $bundle.path --sha256 $bundle.sha256
```

`session share` trả `path` tuyệt đối nằm dưới artifact root và `sha256`; dùng trực
tiếp hai giá trị này tránh việc verifier hiểu path relative theo thư mục hiện tại của
CLI source thay vì project đang quan sát.

Chỉ thêm `--include-text` sau khi owner chấp nhận rủi ro text artifact; `--strict`
làm bundle `NOT_VERIFIED` exit 1. CLI verifier có thể kiểm một file `.rnobs` local
portable; MCP `verify_session_share_bundle` cố ý chỉ nhận `relative_path` dưới
artifact root và không trả embedded content.

## Verification boundary

Static manifest/XML/lockfile analysis có thể chạy không cần device, nhưng không phải
Android runtime verification. Một scenario chỉ có device evidence trong đúng phạm vi
development build, device/AVD, probe và session artifact đã chạy; ngoài phạm vi đó,
status vẫn là `NOT_VERIFIED`. Unit/host test và policy authorization không thay thế
evidence của đúng owned fixture/device. Xem [testing.md](testing.md) cho bằng chứng
hiện có và [SECURITY.md](../SECURITY.md) để báo cáo lỗ hổng của chính dự án.

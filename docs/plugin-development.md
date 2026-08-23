# Plugin development

Plugin SDK được export từ `@rn-agent-observer/core/plugins`; contract target provider
được export từ `@rn-agent-observer/core/targets`. API v1 hỗ trợ trusted in-process
analyzer/reporter qua `PluginRegistry` và explicit JSON-RPC stdio provider/action qua
`ExternalPluginHost`. Không có auto-discovery hay tự expose plugin; CLI target flow
vẫn cần manifest, capability/permission grant và host khởi tạo rõ ràng.

## Isolation contract

| Kind       | Execution          | Trạng thái hiện tại                                             |
| ---------- | ------------------ | --------------------------------------------------------------- |
| `analyzer` | `in-process`       | Có thể initialize/analyze/dispose; chỉ dành cho code được trust |
| `reporter` | `in-process`       | Có thể initialize/report/dispose; chỉ dành cho code được trust  |
| `provider` | `external-process` | `ExternalPluginHost.collect()` sau fail-closed handshake        |
| `action`   | `external-process` | `ExternalPluginHost.executeAction()` sau fail-closed handshake  |

In-process timeout và abort là cooperative: registry reject invocation và abort
signal, nhưng JavaScript synchronous bị block không thể bị preempt. Không load
community code không tin cậy vào cùng process với observer hoặc secret của project.

External manifest bắt buộc `shell: false`, command/args tách riêng, environment
allowlist, request/shutdown timeout và message-size bound. `registerExternal()` chỉ
lưu descriptor; process chỉ chạy khi caller tạo và gọi `ExternalPluginHost`.

## Manifest v1

Mọi manifest có:

- `manifestVersion: 1`, `apiVersion: 1`, lowercase package-like `id`, semver
  `version`, `displayName`, `kind`;
- `capabilities.provides`/`requires` để host kiểm readiness trước initialize;
- `permissions` là yêu cầu, không phải grant;
- `risk` phải ít nhất bằng kind/permission risk floor;
- `execution` mô tả trust/isolation và bounds.

Permission/risk floor:

| Permission                                                       | Risk tối thiểu |
| ---------------------------------------------------------------- | -------------- |
| `evidence:read`, `artifacts:read`, `project:read`, `device:read` | `read-only`    |
| `artifacts:write`                                                | `low`          |
| `network:access`                                                 | `medium`       |
| `device:control`                                                 | `high`         |

`action` luôn ít nhất `medium`. In-process plugin không được yêu cầu
`device:control`; analyzer/reporter là hai kind duy nhất được phép in-process.

## Analyzer tối thiểu

```ts
import {
  PluginRegistry,
  type AnalyzerExtension,
} from '@rn-agent-observer/core/plugins';

const analyzer: AnalyzerExtension = {
  manifest: {
    manifestVersion: 1,
    apiVersion: 1,
    id: 'community.performance-analyzer',
    displayName: 'Community performance analyzer',
    version: '1.0.0',
    kind: 'analyzer',
    capabilities: {
      provides: ['analysis.performance'],
      requires: ['evidence.session'],
    },
    permissions: ['evidence:read'],
    risk: 'read-only',
    execution: {
      mode: 'in-process',
      trusted: true,
      timeoutMs: 10_000,
    },
  },
  analyze(request, context) {
    context.logger.info('Analyzing bounded evidence', {
      count: request.evidence.length,
    });
    return { findings: [] };
  },
};

const registry = new PluginRegistry({
  projectRoot: '/absolute/path/to/app',
  artifactRoot: '/absolute/path/to/app/.artifacts',
  capabilities: ['evidence.session'],
  grantedPermissions: ['evidence:read'],
});

registry.register(analyzer);
const result = await registry.analyze(analyzer.manifest.id, {
  evidence: [],
  configuration: {},
});
await registry.disposeAll();
```

Thay path placeholder bằng absolute path đúng hệ điều hành; trên Windows có thể dùng
`C:\\path\\to\\app` trong string TypeScript.

Analyzer nhận `EvidenceEnvelope[]`, không nhận raw core internals. Mỗi envelope có
schema version, provider, target fingerprint, availability, classification,
references và payload typed `unknown`; plugin phải validate payload nó hiểu. Kết quả
được parse lại bằng public `AssuranceFindingSchema`:

- finding `PASS` bắt buộc có ít nhất một evidence reference;
- finding `NOT_VERIFIED` bắt buộc có limitation cụ thể;
- confidence là score có basis của analyzer, không mặc nhiên là xác suất;
- không đưa secret/raw binary/base64 vào finding description, metadata hay evidence
  URI.

## Reporter

Reporter nhận `Session`, findings, output directory và configuration, rồi trả
artifact descriptor `{ path, mimeType?, label? }`. Runtime boundary kiểm shape nhưng
không sandbox filesystem của trusted plugin. Reporter phải:

1. resolve output dưới directory host cấp, kể cả sau symlink resolution;
2. không overwrite ngoài policy, không follow path từ finding/session một cách mù;
3. escape HTML/XML/Markdown, áp CSP cho offline HTML;
4. không embed raw event payload, input text, network body, secret hoặc binary/base64;
5. ghi classification/limitation khi report lược dữ liệu.

Built-in suite reporter là reference cho JSON, HTML, JUnit, SARIF và GitHub Markdown.

## Permission và lifecycle

Host truyền `capabilities` và `grantedPermissions` độc lập với manifest. Registry
fail closed trước initialize nếu requirement hoặc grant thiếu. ID trùng giữa
in-process/external bị từ chối. Lifecycle:

```text
registered -> initializing -> ready -> disposed
                         \-> failed
```

Concurrent initialize chỉ chạy hook một lần. `disposeAll()` chạy thứ tự ngược và cố
dispose cả extension initialize dở. Mỗi invocation nhận ID riêng, phase, logger và
`AbortSignal`; hook cần dừng I/O/loop sớm khi signal abort.

Output từ community code không được tin chỉ vì TypeScript compile: analyzer finding
và reporter artifact descriptor đều được runtime-validate. Dùng
`inspectPluginConformance()` để trả report issues không throw, hoặc
`validatePluginManifest()`/`parsePluginManifest()` khi cần validate trực tiếp.

## External process protocol và host

Provider/action manifest dùng protocol cố định
`rn-agent-observer-plugin-jsonrpc-stdio-v1`. Method được suy từ kind:

- cả hai: `plugin.initialize`, `plugin.capabilities`, `plugin.dispose`;
- provider: `provider.collect`;
- action: `action.execute`.

Ví dụ đăng ký descriptor rồi chạy host có chủ ý:

```ts
import {
  EXTERNAL_PLUGIN_PROTOCOL,
  ExternalPluginHost,
  PluginRegistry,
} from '@rn-agent-observer/core/plugins';

const registry = new PluginRegistry({
  projectRoot: '/absolute/path/to/app',
  artifactRoot: '/absolute/path/to/app/.artifacts',
  capabilities: ['device.android'],
  grantedPermissions: ['device:control'],
});

const descriptor = registry.registerExternal({
  manifestVersion: 1,
  apiVersion: 1,
  id: 'community.android-actions',
  displayName: 'Community Android actions',
  version: '1.0.0',
  kind: 'action',
  capabilities: {
    provides: ['action.device-tap'],
    requires: ['device.android'],
  },
  permissions: ['device:control'],
  risk: 'high',
  execution: {
    mode: 'external-process',
    protocol: EXTERNAL_PLUGIN_PROTOCOL,
    command: process.execPath,
    args: ['plugin.js'],
    shell: false,
    environmentAllowlist: ['RN_OBSERVER_DEVICE_ID'],
    requestTimeoutMs: 2_000,
    shutdownTimeoutMs: 2_000,
    maxMessageBytes: 1_048_576,
  },
});

const host = new ExternalPluginHost(descriptor, {
  projectRoot: '/absolute/path/to/app',
  cwd: 'plugins/community-android-actions',
  environment: {
    RN_OBSERVER_DEVICE_ID: process.env.RN_OBSERVER_DEVICE_ID,
  },
  capabilities: ['device.android'],
  grantedPermissions: ['device:control'],
});

try {
  const handshake = await host.start();
  const output = await host.executeAction({ action: 'fixture-status' });
  console.log(handshake.pluginId, output);
} finally {
  await host.dispose();
}
```

`registry.initialize(descriptor.manifest.id)` cố ý trả
`PLUGIN_EXTERNAL_ONLY`; external lifecycle thuộc `ExternalPluginHost`, không thuộc
in-process registry. Host hiện:

- resolve `projectRoot` và `cwd` có thật, rồi từ chối cwd thoát root kể cả qua
  symlink;
- không kế thừa `process.env` ngầm: chỉ forward value từ object `environment` do
  caller sở hữu và chỉ tên nằm trong manifest allowlist;
- spawn trực tiếp với `shell: false`, hidden window trên Windows và process group
  riêng trên POSIX;
- gọi `plugin.initialize`, đối chiếu protocol/plugin ID/kind/API, rồi gọi
  `plugin.capabilities` và yêu cầu provide/require set khớp manifest;
- dùng JSON-RPC 2.0 mỗi dòng, numeric request ID, đúng một `result` hoặc `error`, và
  giới hạn cả request lẫn stdout response theo `maxMessageBytes`;
- bound + redact stderr (email/JWT/bearer/credential/opaque token), không trộn stderr
  vào protocol stdout;
- timeout/abort/protocol failure làm host fail closed và terminate process tree;
  shutdown thử `plugin.dispose`, đóng stdin, rồi force-kill nếu quá hạn;
- giữ host `ready` sau JSON-RPC application error hợp lệ để caller có thể quyết định
  retry/triage.

Request `timeoutMs` của caller chỉ được rút ngắn, không được kéo dài timeout manifest.
Provider gọi `collect()`, action gọi `executeAction()`; gọi sai kind trả
`PLUGIN_KIND_MISMATCH`. Manifest/handshake pass vẫn chưa chứng minh dữ liệu/action của
plugin đúng: mỗi provider/action cần fixture, policy và session evidence riêng; case
chưa chạy đúng fixture giữ `NOT_VERIFIED`.

## External target provider

Target provider là một plugin `provider` external-process dùng `provider.collect`;
nó không phải Android provider built-in và không được auto-discover. Android là
platform built-in duy nhất. iOS, web và Windows chỉ extension-ready: một manifest
hợp lệ hoặc `target support` hiển thị `extension-available` không phải bằng chứng
rằng runtime của platform đó đã được implement hay đã chạy trên device/browser/host.

Provider khai báo từng capability theo tên
`target.<platform>.<operation>`. Platform hợp lệ là `android`, `ios`, `web`,
`windows`; operation v1 là `device-list`, `device-info`, `app-state`, `screenshot`,
`ui-tree`, `logs`, `performance`, hoặc `device-network`. Ví dụ manifest read-only
cho provider iOS chỉ support metadata và screenshot:

```json
{
  "manifestVersion": 1,
  "apiVersion": 1,
  "id": "community.ios-observer",
  "displayName": "Community iOS observer",
  "version": "1.0.0",
  "kind": "provider",
  "capabilities": {
    "provides": ["target.ios.device-info", "target.ios.screenshot"],
    "requires": ["host.evidence-v1"]
  },
  "permissions": ["device:read"],
  "risk": "read-only",
  "execution": {
    "mode": "external-process",
    "protocol": "rn-agent-observer-plugin-jsonrpc-stdio-v1",
    "command": "node",
    "args": ["provider.mjs"],
    "shell": false,
    "environmentAllowlist": [],
    "requestTimeoutMs": 10000,
    "shutdownTimeoutMs": 2000,
    "maxMessageBytes": 1048576
  }
}
```

Để inspect capability, CLI không spawn process:

```sh
pnpm rn-observe target support --manifest plugins/community-ios-observer.json
```

Collection yêu cầu manifest, platform, operation, explicit permission grant và chỉ
forward environment name đã nằm trong manifest allowlist:

```sh
pnpm rn-observe target collect \
  --manifest plugins/community-ios-observer.json \
  --platform ios \
  --operation device-info \
  --device-id simulator-1 \
  --app-id com.example.fixture \
  --grant device:read
```

Params của `provider.collect` chứa contract
`rn-agent-observer-target-provider-v1`/schema `1.0`: request ID, operation, target
selector, bounded `maxEvidence`/`maxPayloadBytes` và object parameters. Provider chỉ
trả `AVAILABLE`, `DEGRADED` hoặc `UNAVAILABLE`, cùng limitations; `AVAILABLE` phải có
ít nhất một evidence envelope available, còn `DEGRADED`/`UNAVAILABLE` phải giải thích
limitation. Host đối chiếu protocol/schema/request ID/operation, plugin ID/version và
target fingerprint của từng envelope, áp dụng bounds, và từ chối inline binary,
base64 hoặc evidence payload không đúng contract. Binary phải được ghi thành artifact
reference theo policy thay vì nhét vào response.

Không cài/execute provider chỉ để "thử" trên target ngoài phạm vi. Với target không
thuộc quyền kiểm thử, chỉ observation read-only được user cho phép mới phù hợp; action
stateful cần policy/grant khác và không được suy ra từ capability provider.

## Conformance và release checklist

```sh
pnpm --filter @rn-agent-observer/core test -- plugins
pnpm --filter @rn-agent-observer/core build
```

Trước khi publish plugin:

- pin/test `manifestVersion` và `apiVersion`; unknown version phải fail closed;
- test missing grant/capability, duplicate ID, timeout, abort, malformed output và
  dispose sau failure;
- dùng fixture synthetic, không commit session/artifact thật;
- document permission, risk, data classification, retention và network endpoint;
- giữ analyzer/reporter deterministic và bounded; không diễn giải
  `NA`/`NOT_VERIFIED` thành PASS;
- test external handshake mismatch, env/cwd containment, message bound, stderr
  redaction, RPC error, timeout/abort, process-tree termination và dispose;
- với target provider, test capability/operation chưa khai báo, request/response ID,
  provider identity, exact target match, `AVAILABLE`/`UNAVAILABLE` truthfulness,
  payload/evidence bound và inline binary/base64 rejection;
- báo rõ manifest/descriptor validation chưa đồng nghĩa với scenario runtime pass.

Xem thêm [architecture](architecture.md), [protocol](protocol.md),
[security testing](security-testing.md) và [contributing](../CONTRIBUTING.md).

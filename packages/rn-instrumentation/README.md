# `@rn-agent-observer/rn-instrumentation`

Development-only React Native instrumentation for RN Agent Observer. It can
publish route, fetch timing, render, long-task, UI lifecycle, and interaction
evidence that Android system APIs cannot observe directly.

## Install

Install the lockstep public release (`2.5.1` or newer):

```sh
pnpm add --save-dev @rn-agent-observer/rn-instrumentation
```

Enable only in a development build:

```ts
import {
  installNetworkObserver,
  reportRoute,
} from '@rn-agent-observer/rn-instrumentation';

const uninstallNetworkObserver = installNetworkObserver();
reportRoute('Home');
```

Call the returned uninstall function from lifecycle cleanup. Missing instrumentation
means route/render/JS/network telemetry is unavailable; consumers must not convert
missing evidence to zero.

Cold-start TTI needs two app-owned marks with the same startup ID. The launch mark
must carry the actual native-host timestamp/monotonic clock; do not emit it late
from JavaScript and call that native startup:

```ts
reportPerformanceMark(nativeLaunchMark);
reportPerformanceMark({
  name: 'screenInteractive',
  startupId: nativeLaunchMark.startupId,
  startupType: 'cold',
  foreground: true,
  monotonicMs: performance.now(),
});
```

`performance tti --strict` remains `NOT_VERIFIED` for missing/mismatched, warm/hot,
or background marks.

Optional Babel interaction instrumentation:

```js
module.exports = {
  plugins: [
    [
      require.resolve('@rn-agent-observer/rn-instrumentation/babel-plugin'),
      { projectRoot: __dirname },
    ],
  ],
};
```

Network body capture is off by default and must remain limited to development
fixtures. Do not ship instrumentation in a production build or publish secrets,
credentials, personal data, or unreviewed application state through telemetry.

See the [installation guide](https://github.com/GinzaTech/rn-agent-observer/blob/main/docs/installation.md#7-thêm-instrumentation-vào-app),
[instrumentation guide](https://github.com/GinzaTech/rn-agent-observer/blob/main/docs/usage.md#8-instrumentation-phát-triển),
and [security policy](https://github.com/GinzaTech/rn-agent-observer/security/policy).

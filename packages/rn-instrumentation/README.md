# `@rn-agent-observer/rn-instrumentation`

Development-only React Native instrumentation for RN Agent Observer. It can
publish route, fetch timing, render, long-task, UI lifecycle, and interaction
evidence that Android system APIs cannot observe directly.

## Install

Check registry availability first. Before the first npm publication, use the source
workspace or reviewed tarballs created by `pnpm pack:check`.

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

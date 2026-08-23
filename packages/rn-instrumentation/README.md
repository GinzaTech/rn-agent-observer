# `@rn-agent-observer/rn-instrumentation`

Development-only React Native instrumentation for RN Agent Observer. It can
publish route, fetch timing, render, long-task, UI lifecycle, and interaction
evidence that Android system APIs cannot observe directly.

## Install

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

See the [instrumentation guide](https://github.com/GinzaTech/rn-agent-observer/blob/main/docs/usage.md#8-instrumentation-trong-app)
and [security policy](https://github.com/GinzaTech/rn-agent-observer/security/policy).

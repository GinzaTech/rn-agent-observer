# Maestro + Observer example

This example shows the intended division of responsibility: Maestro drives a
portable black-box flow, while RN Agent Observer records Android/runtime evidence
for the same owned demo fixture. Maestro is optional and is not bundled.

The checked-in flow is deterministic and does not log in, call an Internet API,
change an account, request a permission, or touch production data. Its current
physical-device status is `NOT_VERIFIED` until a run records an exact device serial
and Observer session.

## Prerequisites

- build and install `dev.rnagentobserver.demo` on an owned Android target;
- install Maestro separately and verify `maestro --version`;
- close React Native DevTools;
- start Metro for the demo and pin every ADB command to the serial;
- create a narrowly scoped `authorized-active` Observer config for that same serial
  and app ID, then set process-side trust.

## PowerShell flow

```powershell
$device = '<exact-serial-from-adb-devices>'
$env:RN_OBSERVER_PROJECT_ROOT = (Resolve-Path '..\..\apps\demo-expo').Path
$env:RN_OBSERVER_DEVICE_ID = $device
$env:RN_OBSERVER_APP_ID = 'dev.rnagentobserver.demo'
$env:RN_OBSERVER_TRUST_ACTIVE_CONFIG = '1'

adb devices -l
adb -s $device reverse tcp:8081 tcp:8081

$session = pnpm rn-observe session start | ConvertFrom-Json
$env:RN_OBSERVER_SESSION_ID = $session.id

pnpm rn-observe observe
pnpm rn-observe understand-screen
pnpm rn-observe ui-model

maestro --device $device test .\examples\maestro\demo-observer.yaml
$maestroExit = $LASTEXITCODE

pnpm rn-observe understand-screen
pnpm rn-observe ui-model
pnpm rn-observe performance
pnpm rn-observe network requests
pnpm rn-observe diagnose
pnpm rn-observe session stop $env:RN_OBSERVER_SESSION_ID
pnpm rn-observe session graph $env:RN_OBSERVER_SESSION_ID

if ($maestroExit -ne 0) { exit $maestroExit }
```

Review the `session stop` and `session graph` outputs for artifact paths, source,
timestamps and availability. The Observer session does not convert a failed Maestro
assertion into a pass, and a passing Maestro flow does not invent missing JS/native
metrics.

For CI/device-farm adoption, keep the runner result and Observer evidence as two
linked but independent artifacts. Add a target to the public compatibility matrix
only after a repeatable run on that exact RN/Expo/device/API tuple.

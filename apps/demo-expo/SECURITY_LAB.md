# SecurityLab development fixture

`SecurityLab` is a development-only screen in this demo. It exists solely to
collect bounded evidence for the observer's owned-app active-security scenarios;
it is not a general deep-link fuzzer or a production permission workflow.

## Safe deep-link contract

Only an Android development build made with `RN_OBSERVER_SECURITY_LAB=1` owns
this fixture URI:

```text
rnobs-security-demo://security/lab?item=fixture
```

Only that exact URI reaches the `accepted` state. A link using the demo's custom
scheme but with an empty, duplicated, malformed, oversized, encoded, or
unexpected query becomes `rejected` and remains on a normal content screen. The
screen reports only fixed state/reason codes; it never renders, logs, or persists
the raw URL or query value. There are no account, login, payment, purchase, or
network-interception paths in this fixture.

Stable test IDs:

- `open-SecurityLab`
- `security-lab-screen`
- `security-lab-deep-link-status`
- `security-lab-deep-link-reason`
- `security-lab-camera-status`
- `security-lab-camera-refresh`
- `security-lab-camera-request`

## Camera permission fixture

The build flag adds `android.permission.CAMERA` only so an owned development
build has a real Android runtime permission for the bounded grant/revoke scenario.
The screen never opens a camera, and it never requests the permission
automatically. Use the explicit refresh control after an ADB transition to collect
app-owned state; use the request control only when manually testing the demo.

The active-policy example pins `target.deviceId` to `emulator-5554`. Replace it with
the exact serial reported by `adb devices -l` for an owned test device; active actions
fail closed when the selected serial and config do not match.

## Observed owned-AVD run (2026-08-23)

The owned Android AVD run for this exact development fixture passed a bounded
duplicate-query deep-link probe. The screen stayed in `content` and displayed
`REJECTED` with `unexpected-query`; no raw URI or query value appeared in the
fixture UI.

The same run passed the bounded CAMERA grant/revoke scenario and restored the
original permission during cleanup. Revoking CAMERA caused the app process to
exit with Android's `PERMISSION CHANGE` reason. The observer recovered only after
the prior PID and Android exit-info matched that expected transition; the revoke
probe recorded `recoveryObservationAttempts: 2` before `content` was observed.

This is runtime evidence for this owned demo/AVD and these declared probes only.
It is not evidence for another app, permission, Android environment, broad dynamic
testing, or security certification.

## Build-time opt-in

`app.json` is deliberately release-safe: it contains neither the restricted
`VIEW` intent filter nor `android.permission.CAMERA`. `app.config.cjs` adds those
two Android values only when the environment flag is exactly `1`; it deliberately
does not add Expo's broad `scheme` setting, which would create a second generic
scheme intent filter.

Build the owned development fixture in one PowerShell session:

```powershell
$env:RN_OBSERVER_SECURITY_LAB = '1'
pnpm --filter @rn-agent-observer/demo-expo exec expo prebuild --clean --no-install
pnpm --filter @rn-agent-observer/demo-expo android
```

Validate the opt-in bundle config without installing an app:

```powershell
$env:RN_OBSERVER_SECURITY_LAB = '1'
pnpm --filter @rn-agent-observer/demo-expo exec expo config --type public --json
pnpm --filter @rn-agent-observer/demo-expo exec expo export --platform android --output-dir <temporary-directory>
```

For default/release work, remove the flag before building or exporting:

```powershell
Remove-Item Env:RN_OBSERVER_SECURITY_LAB -ErrorAction SilentlyContinue
pnpm --filter @rn-agent-observer/demo-expo exec expo export --platform android --output-dir <temporary-directory>
```

The runtime screen remains guarded by `__DEV__`; the build flag alone does not
make it reachable in a release bundle.

## Explicit active-policy opt-in

This directory intentionally does **not** contain `.rn-observer.json`.
`.rn-observer.active-security.example.json` is a narrow template for this exact
demo package. Copy it to `.rn-observer.json` only for an Android development
build that you own and are authorized to test; delete the copied file afterwards
to return to fail-closed read-only defaults.

The template enables only `app-state` and `device-state`, keeps network
interception/body capture disabled, and does not enable artifact sharing.

#!/usr/bin/env bash

set -euo pipefail

repository_root="${GITHUB_WORKSPACE:-$(pwd)}"
demo_root="${repository_root}/apps/demo-expo"
metro_log="${RUNNER_TEMP:-/tmp}/rn-agent-observer-metro.log"
metro_pid=""

cleanup() {
  status=$?
  if [[ -n "${metro_pid}" ]]; then
    kill "${metro_pid}" 2>/dev/null || true
    wait "${metro_pid}" 2>/dev/null || true
  fi
  if [[ ${status} -ne 0 ]]; then
    tail -n 200 "${metro_log}" 2>/dev/null || true
    adb -s emulator-5554 logcat -d -t 400 '*:W' 2>/dev/null || true
  fi
  exit "${status}"
}
trap cleanup EXIT

export CI=1
export RN_OBSERVER_PROJECT_ROOT="${demo_root}"
export RN_OBSERVER_DEVICE_ID=emulator-5554
export RN_OBSERVER_APP_ID=dev.rnagentobserver.demo

adb -s emulator-5554 wait-for-device
adb -s emulator-5554 shell input keyevent 82 || true
adb -s emulator-5554 reverse tcp:8081 tcp:8081

(
  cd "${demo_root}"
  pnpm exec expo start --dev-client --port 8081 >"${metro_log}" 2>&1
) &
metro_pid=$!

for _ in $(seq 1 60); do
  if curl --fail --silent --show-error http://127.0.0.1:8081/status | grep -q 'packager-status:running'; then
    break
  fi
  if ! kill -0 "${metro_pid}" 2>/dev/null; then
    tail -n 200 "${metro_log}" || true
    exit 1
  fi
  sleep 2
done
curl --fail --silent --show-error http://127.0.0.1:8081/status | grep -q 'packager-status:running'

"${demo_root}/android/gradlew" \
  --project-dir "${demo_root}/android" \
  --no-daemon \
  app:assembleDebug

adb -s emulator-5554 install -r "${demo_root}/android/app/build/outputs/apk/debug/app-debug.apk"
adb -s emulator-5554 shell am force-stop dev.rnagentobserver.demo
adb -s emulator-5554 shell am start -W -n dev.rnagentobserver.demo/.MainActivity

node "${repository_root}/scripts/check-android-emulator-runtime.mjs"

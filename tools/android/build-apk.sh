#!/usr/bin/env bash
# Construit l'APK de debug d'Echo (coquille Capacitor autour du build de apps/web, modèles inclus).
#   bash tools/android/build-apk.sh            # build web s'il manque, sync, tests JVM, assembleDebug
#   bash tools/android/build-apk.sh --rebuild-web   # refait aussi `pnpm build` de apps/web
# Prérequis : JDK 21, SDK Android (platform 36, build-tools 35) sous $ANDROID_HOME (défaut /root/android-sdk ;
# voir tools/android/install-sdk.sh). Sortie : apps/android/dist/echo-debug.apk (ignoré par git).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export ANDROID_HOME="${ANDROID_HOME:-/root/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
APP="$ROOT/apps/android"

if [[ "${1:-}" == "--rebuild-web" || ! -f "$ROOT/apps/web/dist/index.html" ]]; then
  (cd "$ROOT" && pnpm build)
fi
# Les modèles doivent être dans le build (sinon l'APK ne marche pas hors ligne).
if ! ls "$ROOT"/apps/web/dist/models/*/*/onnx/*.onnx >/dev/null 2>&1; then
  echo "apps/web/dist has no models: run pnpm models:download then pnpm build" >&2
  exit 1
fi

echo "sdk.dir=$ANDROID_HOME" > "$APP/android/local.properties"
(cd "$APP" && npx cap sync android)
cd "$APP/android"
./gradlew --no-daemon -q testDebugUnitTest assembleDebug
mkdir -p "$APP/dist"
cp app/build/outputs/apk/debug/app-debug.apk "$APP/dist/echo-debug.apk"
ls -l "$APP/dist/echo-debug.apk"
du -h "$APP/dist/echo-debug.apk"

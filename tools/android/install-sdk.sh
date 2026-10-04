#!/usr/bin/env bash
# SDK Android sans Android Studio (Linux) : cmdline-tools officiels + platform-tools, platform 36, build-tools 35 (version imposée par AGP 8.13).
#   bash tools/android/install-sdk.sh [dossier]   (défaut /root/android-sdk, ~1 Go)
set -euo pipefail
SDK="${1:-/root/android-sdk}"
ZIP_URL="https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip"
mkdir -p "$SDK" && cd "$SDK"
if [[ ! -x cmdline-tools/latest/bin/sdkmanager ]]; then
  curl -sSLo cmdtools.zip "$ZIP_URL"
  python3 -m zipfile -e cmdtools.zip cmdline-tools   # pas besoin de unzip
  rm -rf cmdline-tools/latest && mv cmdline-tools/cmdline-tools cmdline-tools/latest
  chmod +x cmdline-tools/latest/bin/*
  rm -f cmdtools.zip
fi
yes | cmdline-tools/latest/bin/sdkmanager --sdk_root="$SDK" --licenses >/dev/null || true
cmdline-tools/latest/bin/sdkmanager --sdk_root="$SDK" "platform-tools" "platforms;android-36" "build-tools;35.0.0"
echo "Android SDK ready in $SDK"

#!/bin/sh
# ---------------------------------------------------------------------------
# Build the kiosk's native helpers as static binaries, for both CPU kinds:
#
#   prebuilt/armeabi-v7a/vp-usbprint     32-bit ARM (e.g. Amlogic TX3)
#   prebuilt/arm64-v8a/vp-usbprint       64-bit ARM (e.g. Rockchip RK3568)
#   prebuilt/gutenprint-armhf.tgz        Canon inkjet converter (runs on both)
#
# Static = no dependency on Termux's or Android's libraries, so a kiosk is
# installed by copying files (android/install.sh) — no compiler on the box.
# Runs on any x86-64 machine with Docker:  sh android/build-prebuilt.sh
# ---------------------------------------------------------------------------
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
OUT="$HERE/prebuilt"
mkdir -p "$OUT/armeabi-v7a" "$OUT/arm64-v8a"

docker run --rm -v "$HERE:/src:ro" -v "$OUT:/out" debian:bookworm bash -euc '
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    gcc-arm-linux-gnueabihf libc6-dev-armhf-cross gcc-aarch64-linux-gnu libc6-dev-arm64-cross >/dev/null
  arm-linux-gnueabihf-gcc -O2 -Wall -static -o /out/armeabi-v7a/vp-usbprint /src/vp-usbprint.c
  aarch64-linux-gnu-gcc   -O2 -Wall -static -o /out/arm64-v8a/vp-usbprint   /src/vp-usbprint.c
  arm-linux-gnueabihf-strip /out/armeabi-v7a/vp-usbprint
  aarch64-linux-gnu-strip   /out/arm64-v8a/vp-usbprint
'
# Canon converter (static armhf; 64-bit ARM boards run 32-bit binaries too)
(cd "$OUT" && sh "$HERE/build-gutenprint.sh" && mv gutenprint-armhf.tgz gutenprint-armhf.tgz.new && mv gutenprint-armhf.tgz.new gutenprint-armhf.tgz)
(cd "$OUT" && sha256sum armeabi-v7a/vp-usbprint arm64-v8a/vp-usbprint gutenprint-armhf.tgz > SHA256SUMS)
cat "$OUT/SHA256SUMS"

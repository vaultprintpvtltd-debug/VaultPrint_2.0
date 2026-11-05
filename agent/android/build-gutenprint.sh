#!/bin/sh
# ---------------------------------------------------------------------------
# Build vp-gutenprint for the Android box (Canon PIXMA G2010 backend).
#
# Runs on any x86-64 machine with Docker. Cross-compiles Gutenprint 5.3.4
# (Debian 12's source package) for armhf as a static library with its
# drivers built in, links android/vp-gutenprint.c against it fully
# statically, and packs the binary with Gutenprint's printer data:
#
#   sh android/build-gutenprint.sh            → ./gutenprint-armhf.tgz
#
# Install on the box (as root via adb, then fix owner/SELinux label):
#   tar xzf gutenprint-armhf.tgz -C ~/vaultprint      (→ ~/vaultprint/gutenprint)
#   cp android/vp-gutenprint.sh ~/vaultprint/bin/vp-gutenprint
#
# Why static + _FILE_OFFSET_BITS=64: Debian's armhf libgutenprint finds no
# drivers or printer data on this box — its 32-bit readdir() fails on
# 64-bit directory offsets, so it loads zero printers and crashes.
# ---------------------------------------------------------------------------
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$(pwd)

docker run --rm -v "$HERE:/src:ro" -v "$OUT:/out" debian:bookworm bash -euc '
  sed -i "s/^Types: deb$/Types: deb deb-src/" /etc/apt/sources.list.d/debian.sources
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq gcc-arm-linux-gnueabihf libc6-dev-armhf-cross \
    make dpkg-dev xz-utils libgutenprint-common >/dev/null
  cd /tmp && apt-get source -qq --download-only gutenprint >/dev/null
  tar xf gutenprint_*.orig.tar.xz && cd gutenprint-5.3.4*
  ./configure -q --host=arm-linux-gnueabihf --disable-shared --enable-static --with-modules=static \
    --without-cups --without-gimp2 --disable-libgutenprintui2 --disable-samples --disable-escputil \
    --disable-test --disable-testpattern --disable-nls --without-doc --without-readline
  make -s -j"$(nproc)" -C include >/dev/null
  make -s -j"$(nproc)" -C src/main CFLAGS="-O2 -D_FILE_OFFSET_BITS=64" >/dev/null
  mkdir -p /tmp/pkg/gutenprint
  arm-linux-gnueabihf-gcc -O2 -Wall -D_FILE_OFFSET_BITS=64 -static -Iinclude \
    -o /tmp/pkg/gutenprint/vp-gutenprint.bin /src/vp-gutenprint.c src/main/.libs/libgutenprint.a -lm
  arm-linux-gnueabihf-strip /tmp/pkg/gutenprint/vp-gutenprint.bin
  cp -r /usr/share/gutenprint/5.3/xml /tmp/pkg/gutenprint/xml
  tar czf /out/gutenprint-armhf.tgz -C /tmp/pkg gutenprint
  sha256sum /tmp/pkg/gutenprint/vp-gutenprint.bin
'
echo "built $OUT/gutenprint-armhf.tgz"

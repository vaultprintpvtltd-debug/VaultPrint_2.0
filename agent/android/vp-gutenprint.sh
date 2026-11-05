#!/data/data/com.termux/files/usr/bin/sh
# ---------------------------------------------------------------------------
# vp-gutenprint launcher (installed as ~/vaultprint/bin/vp-gutenprint).
#
# vp-gutenprint.bin is a fully static armhf build (Gutenprint 5.3.4 with its
# drivers compiled in — see android/build-gutenprint.sh), so it runs on
# Android without Termux's libraries. It only needs Gutenprint's printer
# data, found through STP_DATA_PATH.
#
#   gs -sDEVICE=pgmraw -r300 ... -sOutputFile=- doc.pdf | vp-gutenprint -d bjc-G2000-series > job.prn
# ---------------------------------------------------------------------------
GP="$HOME/vaultprint/gutenprint"
export STP_DATA_PATH="$GP/xml"
exec "$GP/vp-gutenprint.bin" "$@"

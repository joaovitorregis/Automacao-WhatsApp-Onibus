#!/data/data/com.termux/files/usr/bin/bash
set -eu
cd -- "$(dirname -- "$0")"
# Preserve LD_PRELOAD supplied by Termux. Do not unset it.
if [ "$#" -eq 0 ]; then set -- --dry-run; fi
exec node src/automation.cjs "$@"

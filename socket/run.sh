#!/data/data/com.termux/files/usr/bin/sh
set -eu
cd -- "$(dirname -- "$0")"
export WHATSAPP_KERNEL_LOCK=1
exec flock -n -F ../runtime/automation.guard node auth.mjs "$@"

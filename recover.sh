#!/data/data/com.termux/files/usr/bin/sh
export PATH=/data/data/com.termux/files/usr/bin:$PATH
export LD_PRELOAD=/data/data/com.termux/files/usr/lib/libtermux-exec.so
cd /data/data/com.termux/files/home/whatsapp-onibus-rota-1-android || exit 1
termux-wake-lock
# This only restores the executor; sendingEnabled and delivery records are untouched.
exec >> runtime/recovery.log 2>&1
date -u '+recovery_invoked %Y-%m-%dT%H:%M:%SZ'
flock -n runtime/recovery.guard timeout -k 5s 40s node service.cjs start
result=$?
echo "recovery_exit $result"
exit "$result"

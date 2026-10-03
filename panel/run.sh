#!/data/data/com.termux/files/usr/bin/sh
export PATH=/data/data/com.termux/files/usr/bin:/system/bin
export LD_PRELOAD=/data/data/com.termux/files/usr/lib/libtermux-exec.so
export PANEL_HOST="${PANEL_HOST:-127.0.0.1}"
umask 077
cd /data/data/com.termux/files/home/whatsapp-onibus-rota-1-android || exit 1
exec /data/data/com.termux/files/usr/bin/node panel/server.cjs

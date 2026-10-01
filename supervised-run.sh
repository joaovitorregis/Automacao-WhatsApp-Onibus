#!/data/data/com.termux/files/usr/bin/sh
export PATH=/data/data/com.termux/files/usr/bin:$PATH
export LD_PRELOAD=/data/data/com.termux/files/usr/lib/libtermux-exec.so
cd /data/data/com.termux/files/home/whatsapp-onibus-rota-1-android || exit 1
exec node /data/data/com.termux/files/home/whatsapp-onibus-rota-1-android/scheduler.cjs

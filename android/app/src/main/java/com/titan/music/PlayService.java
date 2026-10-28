package com.titan.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.IBinder;
import android.os.PowerManager;

// 상단 알림을 띄워 두는 동안 안드로이드가 앱을 재우거나 죽이지 않는다
public class PlayService extends Service {
    PowerManager.WakeLock cpu;
    WifiManager.WifiLock wifi;

    @Override public int onStartCommand(Intent i, int flags, int id) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("play", "재생", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, "play")
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("사무실 플레이어 재생 중")
                .setContentIntent(open)
                .setOngoing(true)
                .build();
        startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);

        if (cpu == null) {
            cpu = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "titan:play");
            cpu.acquire();
            wifi = getSystemService(WifiManager.class).createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "titan:play");
            wifi.acquire();
        }
        return START_STICKY;
    }

    @Override public void onDestroy() {
        if (cpu != null) { cpu.release(); wifi.release(); }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent i) { return null; }
}

package com.titan.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import java.io.InputStream;
import java.net.URL;

// 상단 알림을 띄워 두는 동안 안드로이드가 앱을 재우거나 죽이지 않는다.
// 알림과 잠금화면에 이전곡·재생/일시정지·다음곡 버튼도 띄운다(MediaSession).
public class PlayService extends Service {
    PowerManager.WakeLock cpu;
    WifiManager.WifiLock wifi;
    MediaSession session;
    String title = "", id = "";
    boolean playing;
    Bitmap art; // 지금 곡 유튜브 썸네일 (잠금화면 배경·알림 그림)

    @Override public int onStartCommand(Intent i, int flags, int startId) {
        if (session == null) {
            getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("play", "재생", NotificationManager.IMPORTANCE_LOW));
            session = new MediaSession(this, "titan");
            session.setCallback(new MediaSession.Callback() { // 잠금화면·이어폰·안드로이드 13+ 알림 버튼
                @Override public void onPlay() { MainActivity.js("toggle"); }
                @Override public void onPause() { MainActivity.js("toggle"); }
                @Override public void onSkipToNext() { MainActivity.js("next"); }
                @Override public void onSkipToPrevious() { MainActivity.js("prev"); }
            });
            session.setActive(true);
            cpu = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "titan:play");
            cpu.acquire();
            wifi = getSystemService(WifiManager.class).createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "titan:play");
            wifi.acquire();
        }

        String a = i == null ? null : i.getAction();
        if ("update".equals(a)) {
            title = i.getStringExtra("title");
            playing = i.getBooleanExtra("playing", false);
            String v = i.getStringExtra("id");
            if (!v.equals(id)) { id = v; art = null; loadArt(v); }
        }
        else if ("prev".equals(a) || "next".equals(a) || "toggle".equals(a)) MainActivity.js(a); // 안드로이드 12 이하 알림 버튼
        show();
        return START_STICKY;
    }

    // 썸네일은 네트워크라 따로 받아 오고, 그사이 곡이 바뀌었으면 버린다
    void loadArt(String v) {
        if (v.isEmpty()) return;
        new Thread(() -> {
            try (InputStream in = new URL("https://i.ytimg.com/vi/" + v + "/hqdefault.jpg").openStream()) {
                Bitmap b = BitmapFactory.decodeStream(in);
                new Handler(Looper.getMainLooper()).post(() -> { if (v.equals(id) && session != null) { art = b; show(); } });
            } catch (Exception ignored) {} // 썸네일 없이도 재생·버튼은 그대로
        }).start();
    }

    void show() {
        session.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title.isEmpty() ? "타이탄 뮤직플레이어" : title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, "타이탄 뮤직플레이어")
                .putBitmap(MediaMetadata.METADATA_KEY_ART, art)
                .build());
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                        | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1)
                .build());

        Notification n = new Notification.Builder(this, "play")
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(title.isEmpty() ? "타이탄 뮤직플레이어" : title)
                .setContentText("타이탄 뮤직플레이어")
                .setContentIntent(PendingIntent.getActivity(this, 0, getPackageManager().getLaunchIntentForPackage(getPackageName()), PendingIntent.FLAG_IMMUTABLE))
                .setLargeIcon(art)
                .setVisibility(Notification.VISIBILITY_PUBLIC) // 잠금화면에도 보이게
                .setOngoing(true)
                .addAction(button(android.R.drawable.ic_media_previous, "이전곡", "prev"))
                .addAction(playing ? button(android.R.drawable.ic_media_pause, "일시정지", "toggle")
                                   : button(android.R.drawable.ic_media_play, "재생", "toggle"))
                .addAction(button(android.R.drawable.ic_media_next, "다음곡", "next"))
                .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2))
                .build();
        startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
    }

    Notification.Action button(int icon, String label, String action) {
        PendingIntent pi = PendingIntent.getService(this, 0, new Intent(this, PlayService.class).setAction(action), PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), label, pi).build();
    }

    @Override public void onDestroy() {
        if (session != null) { session.release(); cpu.release(); wifi.release(); }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent i) { return null; }
}

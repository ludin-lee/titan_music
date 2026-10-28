package com.titan.music;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.widget.FrameLayout;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    static final String URL = "https://titanmusic-three.vercel.app/player";

    // 화면이 꺼져도 페이지가 "보이는 중"이라고 믿게 해서 유튜브가 멈추지 않게 한다
    static class AlwaysVisibleWebView extends WebView {
        AlwaysVisibleWebView(Context c) { super(c); }
        @Override protected void onWindowVisibilityChanged(int v) { super.onWindowVisibilityChanged(View.VISIBLE); }
    }

    static WebView web; // PlayService가 알림 버튼을 누르면 여기로 전달

    // 알림·잠금화면 버튼 → 페이지의 window.titan.prev/next/toggle
    static void js(String fn) { if (web != null) web.evaluateJavascript("window.titan && titan." + fn + "()", null); }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 0);
        startForegroundService(new Intent(this, PlayService.class)); // 앱이 뒤로 가도 프로세스·CPU를 살려 둔다

        web = new AlwaysVisibleWebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true); // 층·비밀번호 기억(localStorage)
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient()); // 링크도 앱 안에서 연다
        web.addJavascriptInterface(new Object() { // 페이지 → 알림: 지금 곡 제목·재생 여부
            @JavascriptInterface public void update(String title, boolean playing) {
                startService(new Intent(MainActivity.this, PlayService.class).setAction("update")
                        .putExtra("title", title).putExtra("playing", playing));
            }
        }, "TitanApp");

        // 안드로이드 15부터 앱이 상태바·내비게이션바 밑까지 그려지므로 그만큼 비워 둔다
        FrameLayout root = new FrameLayout(this);
        root.addView(web);
        if (Build.VERSION.SDK_INT >= 30) root.setOnApplyWindowInsetsListener((v, w) -> {
            Insets i = w.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsets.CONSUMED;
        });
        setContentView(root);
        if (b == null) web.loadUrl(URL); else web.restoreState(b);
    }

    @Override protected void onSaveInstanceState(Bundle b) { super.onSaveInstanceState(b); web.saveState(b); }

    // onPause/onStop에서 web.onPause()·pauseTimers()를 부르지 않는다 → 화면이 꺼져도 재생·3초 점검이 계속 돈다

    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else moveTaskToBack(true); }

    @Override protected void onDestroy() {
        stopService(new Intent(this, PlayService.class));
        web.destroy();
        web = null;
        super.onDestroy();
    }
}

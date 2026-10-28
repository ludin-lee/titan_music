package com.titan.music;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.MutableContextWrapper;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
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

    // 화면(Activity)이 새로 만들어져도 웹뷰는 그대로 옮겨 붙여서 재생이 끊기지 않게 한다.
    // PlayService가 알림 버튼을 누르면 여기로 전달
    static WebView web;

    // 알림·잠금화면 버튼 → 페이지의 window.titan.prev/next/toggle
    static void js(String fn) { if (web != null) web.evaluateJavascript("window.titan && titan." + fn + "()", null); }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 0);
        startForegroundService(new Intent(this, PlayService.class)); // 앱이 뒤로 가도 프로세스·CPU를 살려 둔다

        if (web != null) { // 알림·잠금화면에서 다시 들어옴 등: 기존 웹뷰를 떼어 와서 새 화면에 붙인다
            ((MutableContextWrapper) web.getContext()).setBaseContext(this);
            if (web.getParent() != null) ((ViewGroup) web.getParent()).removeView(web);
        } else create();

        // 안드로이드 15부터 앱이 상태바·내비게이션바 밑까지 그려지므로 그만큼 비워 둔다
        FrameLayout root = new FrameLayout(this);
        root.addView(web);
        if (Build.VERSION.SDK_INT >= 30) root.setOnApplyWindowInsetsListener((v, w) -> {
            Insets i = w.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsets.CONSUMED;
        });
        setContentView(root);
    }

    void create() {
        web = new AlwaysVisibleWebView(new MutableContextWrapper(this));
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true); // 층·비밀번호 기억(localStorage)
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient()); // 링크도 앱 안에서 연다
        web.addJavascriptInterface(new Object() { // 페이지 → 알림: 지금 곡 제목·재생 여부·유튜브 id(썸네일)
            @JavascriptInterface public void update(String title, boolean playing, String id) {
                web.getContext().startService(new Intent(web.getContext(), PlayService.class).setAction("update")
                        .putExtra("title", title).putExtra("playing", playing).putExtra("id", id));
            }
        }, "TitanApp");
        web.loadUrl(URL);
    }

    // onPause/onStop에서 web.onPause()·pauseTimers()를 부르지 않는다 → 화면이 꺼져도 재생·3초 점검이 계속 돈다

    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else moveTaskToBack(true); }

    // 화면이 다시 만들어지는 중이면 웹뷰를 살려 두고, 정말 앱을 닫을 때만 재생을 끝낸다
    @Override protected void onDestroy() {
        if (isFinishing()) {
            stopService(new Intent(this, PlayService.class));
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}

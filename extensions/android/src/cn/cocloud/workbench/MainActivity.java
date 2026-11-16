package cn.cocloud.workbench;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.app.NotificationManager;
import android.provider.Settings;
import android.graphics.Color;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.Environment;
import android.os.SystemClock;
import android.view.Display;
import android.view.MotionEvent;
import android.view.WindowManager;
import android.window.BackEvent;
import android.window.OnBackAnimationCallback;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import java.util.Arrays;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** A thin Android client; Codex and all project execution stay on the server. */
public final class MainActivity extends Activity {
    private static final String HOME = BuildConfig.ORIGIN + "/";
    private static final int CHOOSE_FILES = 100;
    private static final int TAKE_PHOTO = 102;
    private Uri cameraUri;
    private static final int NOTIFICATION_PERMISSION = 101;
    private WebView web;
    private BlobDownloads blobDownloads;
    private LinearLayout errorPanel;
    private LinearLayout layout;
    private ValueCallback<Uri[]> fileCallback;
    private AppUpdater updater;
    private OnBackInvokedCallback backCallback;
    private final SidebarBackGesture sidebarBack = new SidebarBackGesture();
    private float latestBackProgress;
    private boolean backFramePending;
    private final Runnable backProgressFrame = () -> {
        backFramePending = false;
        dispatchSidebarProgress(sidebarBack.progress(latestBackProgress), null);
    };
    private boolean recentLeftEdge;
    private long lastTouchAt;

    private static boolean trusted(Uri uri) {
        return "https".equals(uri.getScheme()) && "workbench.example".equals(uri.getHost())
                && uri.getPort() == 8443 && uri.getUserInfo() == null;
    }

    @Override public void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        CameraProvider.prune(this);
        WebView.setWebContentsDebuggingEnabled(false);
        layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(Color.WHITE);
        setContentView(layout);
        // Android 15 draws behind system bars; keep controls clear of bars and the keyboard.
        layout.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        layout.requestApplyInsets();
        web = new WebView(this);
        blobDownloads = new BlobDownloads(this, web);
        layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        web.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            int height = bottom - top;
            int strip = Math.round(200 * getResources().getDisplayMetrics().density);
            int edge = Math.round(28 * getResources().getDisplayMetrics().density);
            int start = Math.max(0, (height - strip) / 2);
            int width = right - left;
            web.setSystemGestureExclusionRects(Arrays.asList(
                new Rect(0, start, edge, Math.min(height, start + strip)),
                new Rect(Math.max(0, width - edge), start, width, Math.min(height, start + strip))));
        });
        configureBackNavigation();
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        String version;
        try { version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (Exception ex) { version = "unknown"; }
        settings.setUserAgentString(settings.getUserAgentString() + " CocloudAndroid/" + version);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                clearBackProgress();
                sidebarBack.cancel();
                blobDownloads.navigationStarted();
            }
            @Override public void onPageCommitVisible(WebView view, String url) {
                if (trusted(Uri.parse(url))) blobDownloads.install();
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (trusted(uri) && "/__cocloud_app__/notifications".equals(uri.getPath())) {
                    if (request.isForMainFrame() && request.hasGesture()
                            && trusted(Uri.parse(view.getUrl() == null ? "" : view.getUrl()))) showNotificationSettings();
                    return true;
                }
                if (trusted(uri) && "/__cocloud_app__/check-update".equals(uri.getPath())) {
                    if (request.isForMainFrame() && request.hasGesture()
                            && trusted(Uri.parse(view.getUrl() == null ? "" : view.getUrl())))
                        updater.check(true);
                    return true;
                }
                if ("cocloud-update".equals(uri.getScheme())) {
                    if (request.isForMainFrame() && trusted(Uri.parse(view.getUrl() == null ? "" : view.getUrl())))
                        updater.check(true);
                    return true;
                }
                if ("cocloud-download".equals(uri.getScheme())) {
                    String downloadUrl = uri.getQueryParameter("url");
                    if (downloadUrl != null) download(downloadUrl, web.getSettings().getUserAgentString(), null, null);
                    return true;
                }
                if (trusted(uri)) return false;
                if (request.isForMainFrame() && request.hasGesture()
                        && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (ActivityNotFoundException ex) { toast("没有可打开链接的浏览器"); }
                }
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                if (trusted(Uri.parse(url))) { blobDownloads.install(); syncTaskNotifications(false); }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError("暂时无法连接服务器，请检查网络后重试。服务器上的任务会继续运行。");
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, android.net.http.SslError error) {
                handler.cancel();
                showError("服务器证书验证失败，请检查手机时间和服务器证书。");
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                clearCamera(true);
                fileCallback = callback;
                if (CameraPolicy.shouldCapture(params.isCaptureEnabled(), params.getAcceptTypes())) {
                    if (!trusted(Uri.parse(view.getUrl() == null ? "" : view.getUrl()))) {
                        fileCallback.onReceiveValue(null); fileCallback = null; return true;
                    }
                    try {
                        cameraUri = CameraProvider.create(MainActivity.this);
                        Intent capture = new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE);
                        capture.putExtra(android.provider.MediaStore.EXTRA_OUTPUT, cameraUri);
                        capture.setClipData(android.content.ClipData.newRawUri("photo", cameraUri));
                        capture.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                        startActivityForResult(capture, TAKE_PHOTO);
                    } catch (Exception ex) {
                        clearCamera(true);
                        fileCallback.onReceiveValue(null); fileCallback = null;
                        toast("无法打开相机，请检查系统相机是否可用");
                    }
                    return true;
                }
                try {
                    Intent pick = params.createIntent();
                    pick.addCategory(Intent.CATEGORY_OPENABLE);
                    pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                    startActivityForResult(Intent.createChooser(pick, "选择要上传的文件"), CHOOSE_FILES);
                } catch (ActivityNotFoundException ex) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    toast("请先安装或启用系统文件管理器");
                }
                return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> download(url, agent, disposition, mime));
        String launch = notificationUrl(getIntent());
        if (launch != null) web.loadUrl(launch);
        else if (savedState == null || web.restoreState(savedState) == null) web.loadUrl(HOME);
        updater = new AppUpdater(this);
        updater.check(false);
    }

    private void download(String url, String agent, String disposition, String mime) {
            if (blobDownloads.start(url, URLUtil.guessFileName(url, disposition, mime), mime)) return;
            Uri uri = Uri.parse(url);
            if (!trusted(uri)) { toast("仅支持下载此工作台的服务器文件"); return; }
            try {
                String name = uri.getPath() != null && uri.getPath().endsWith("/archive")
                        ? "project-" + System.currentTimeMillis() + ".tar.gz"
                        : URLUtil.guessFileName(url, disposition, mime);
                DownloadManager.Request request = new DownloadManager.Request(uri);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) request.addRequestHeader("Cookie", cookies);
                request.addRequestHeader("User-Agent", agent);
                if (mime != null) request.setMimeType(mime);
                request.setTitle(name);
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
                toast("已开始下载，可在系统下载列表查看");
            } catch (RuntimeException ex) { toast("下载未开始，请重试或使用浏览器下载"); }
    }

    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }

    private String notificationUrl(Intent intent) {
        Uri uri = intent == null ? null : intent.getData();
        if (uri == null || !trusted(uri) || !"/".equals(uri.getPath())) return null;
        return uri.toString();
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent);
        String url = notificationUrl(intent);
        if (url != null && web != null) web.loadUrl(url);
    }
    private void syncTaskNotifications(boolean ask) {
        if (!TaskNotificationService.enabled(this)) { stopService(new Intent(this, TaskNotificationService.class)); return; }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            if (ask) requestPermissions(new String[] { "android.permission.POST_NOTIFICATIONS" }, NOTIFICATION_PERMISSION);
            return;
        }
        if (!getSystemService(NotificationManager.class).areNotificationsEnabled()) return;
        try { startForegroundService(new Intent(this, TaskNotificationService.class)); }
        catch (RuntimeException ignored) { if (ask) toast("提醒服务未启动，请重新打开工作台再试"); }
    }
    private void showNotificationSettings() {
        String state = TaskNotificationService.enabled(this) ? "当前已开启" : "当前已关闭";
        new AlertDialog.Builder(this).setTitle("任务完成通知 · " + state)
            .setMessage("任务完成时弹出系统通知，点击回到对应对话。开启后会显示后台提醒服务通知。\n\n锁屏或切到后台可以继续检查；系统强行停止应用后不能接收。若真我手机限制后台，请在电池设置中允许此应用后台活动。")
            .setPositiveButton("开启提醒", (dialog, which) -> {
                TaskNotificationService.preferences(this).edit().putBoolean("enabled", true).apply();
                if (!getSystemService(NotificationManager.class).areNotificationsEnabled()
                        && (Build.VERSION.SDK_INT < 33 || checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED)) {
                    startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
                } else syncTaskNotifications(true);
            })
            .setNegativeButton("关闭提醒", (dialog, which) -> {
                TaskNotificationService.preferences(this).edit().putBoolean("enabled", false).apply();
                stopService(new Intent(this, TaskNotificationService.class));
            })
            .setNeutralButton("系统设置", (dialog, which) -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))))
            .show();
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == NOTIFICATION_PERMISSION) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) syncTaskNotifications(false);
            else toast("未获得通知权限，可在设置 → 安装到手机 → 任务完成通知中开启");
        }
    }

    private void showError(String message) {
        if (errorPanel != null) { ((TextView) errorPanel.getChildAt(0)).setText(message); return; }
        web.setVisibility(WebView.GONE);
        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setPadding(36, 48, 36, 24);
        TextView text = new TextView(this); text.setText(message); text.setTextSize(17);
        Button retry = new Button(this); retry.setText("重新连接");
        retry.setOnClickListener(v -> {
            layout.removeView(errorPanel); errorPanel = null; web.setVisibility(WebView.VISIBLE);
            web.loadUrl(HOME);
        });
        errorPanel.addView(text); errorPanel.addView(retry);
        layout.addView(errorPanel, new LinearLayout.LayoutParams(-1, -1));
    }

    private void clearCamera(boolean delete) {
        if (cameraUri == null) return;
        revokeUriPermission(cameraUri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (delete) CameraProvider.remove(this, cameraUri);
        cameraUri = null;
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == TAKE_PHOTO) {
            Uri photo = cameraUri;
            boolean success = result == RESULT_OK && photo != null && CameraProvider.hasPhoto(this, photo);
            clearCamera(!success);
            ValueCallback<Uri[]> callback = fileCallback; fileCallback = null;
            if (callback != null) callback.onReceiveValue(success ? new Uri[]{photo} : null);
            return;
        }
        if (request == CHOOSE_FILES && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        }
    }
    @Override public void onBackPressed() {
        handleBack(SystemClock.uptimeMillis() - lastTouchAt < 1500 ? (recentLeftEdge ? "open" : "close") : "back");
    }
    @Override public boolean dispatchTouchEvent(MotionEvent event) {
        if (event.getActionMasked() == MotionEvent.ACTION_DOWN)
            recentLeftEdge = event.getX() <= 32 * getResources().getDisplayMetrics().density;
        lastTouchAt = SystemClock.uptimeMillis();
        return super.dispatchTouchEvent(event);
    }
    private void handleBack(String action) {
        if (web == null) { moveTaskToBack(true); return; }
        String script = "!window.dispatchEvent(new CustomEvent('cocloud-native-sidebar',{cancelable:true,detail:{action:'" + action + "'}}))";
        web.evaluateJavascript(script, handled -> {
            if ("true".equals(handled)) return;
            if (web.canGoBack()) web.goBack();
            else moveTaskToBack(true);
        });
    }
    private void clearBackProgress() {
        if (web != null) web.removeCallbacks(backProgressFrame);
        backFramePending = false;
    }
    private void dispatchSidebarProgress(String script, ValueCallback<String> callback) {
        if (script == null || web == null || !trusted(Uri.parse(web.getUrl() == null ? "" : web.getUrl()))) {
            if (callback != null) callback.onReceiveValue("false");
            return;
        }
        web.evaluateJavascript(script, callback);
    }
    private void configureBackNavigation() {
        if (Build.VERSION.SDK_INT >= 34) {
            backCallback = new OnBackAnimationCallback() {
                private int edge = -1;
                @Override public void onBackStarted(BackEvent event) {
                    clearBackProgress();
                    edge = event.getSwipeEdge();
                    dispatchSidebarProgress(sidebarBack.start(edge == BackEvent.EDGE_RIGHT), null);
                }
                @Override public void onBackProgressed(BackEvent event) {
                    latestBackProgress = event.getProgress();
                    if (web != null && sidebarBack.active() && !backFramePending) {
                        backFramePending = true;
                        web.postOnAnimation(backProgressFrame);
                    }
                }
                @Override public void onBackCancelled() {
                    clearBackProgress();
                    dispatchSidebarProgress(sidebarBack.cancel(), null);
                    edge = -1;
                }
                @Override public void onBackInvoked() {
                    clearBackProgress();
                    final int completedEdge = edge;
                    edge = -1;
                    String finish = sidebarBack.finish();
                    if (finish == null) { handleBack("back"); return; }
                    dispatchSidebarProgress(finish, handled -> {
                        // Old pages without the progress protocol retain their existing behavior.
                        if (!"true".equals(handled)) handleBack(completedEdge == BackEvent.EDGE_LEFT ? "open" : "close");
                    });
                }
            };
        } else if (Build.VERSION.SDK_INT >= 33) {
            backCallback = () -> handleBack(SystemClock.uptimeMillis() - lastTouchAt < 1500 ? (recentLeftEdge ? "open" : "close") : "back");
        }
        if (Build.VERSION.SDK_INT >= 33)
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
    }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onPause() { clearBackProgress(); dispatchSidebarProgress(sidebarBack.cancel(), null); CookieManager.getInstance().flush(); web.onPause(); super.onPause(); }
    @Override protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        if (updater != null) { updater.resumeInstall(); updater.showInstallResult(); }
        boolean asked = TaskNotificationService.preferences(this).getBoolean("asked", false);
        if (!asked) TaskNotificationService.preferences(this).edit().putBoolean("asked", true).apply();
        syncTaskNotifications(!asked);
        requestSmoothDisplay();
    }
    private void requestSmoothDisplay() {
        Display display = getWindowManager().getDefaultDisplay();
        if (display == null) return;
        Display.Mode current = display.getMode();
        Display.Mode best = current;
        for (Display.Mode mode : display.getSupportedModes()) {
            if (mode.getPhysicalWidth() == current.getPhysicalWidth()
                    && mode.getPhysicalHeight() == current.getPhysicalHeight()
                    && mode.getRefreshRate() > best.getRefreshRate() && mode.getRefreshRate() <= 144.5f) best = mode;
        }
        WindowManager.LayoutParams params = getWindow().getAttributes();
        params.preferredDisplayModeId = best.getModeId();
        params.preferredRefreshRate = best.getRefreshRate();
        getWindow().setAttributes(params);
        if (web != null && Build.VERSION.SDK_INT >= 35) web.setRequestedFrameRate(best.getRefreshRate());
    }
    @Override protected void onDestroy() {
        clearCamera(true);
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null)
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        if (updater != null) updater.close();
        if (blobDownloads != null) blobDownloads.close();
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        layout.removeView(web); web.destroy(); super.onDestroy();
    }
}

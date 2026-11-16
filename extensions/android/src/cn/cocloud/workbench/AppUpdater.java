package cn.cocloud.workbench;

import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import android.os.Build;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

final class AppUpdater {
    private static final String BASE = BuildConfig.ORIGIN + "/downloads/";
    private final MainActivity activity;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean();
    private volatile boolean cancelled;
    private boolean waitingForPermission;
    private ProgressDialog progress;

    AppUpdater(MainActivity activity) { this.activity = activity; }
    private boolean alive() { return !activity.isFinishing() && !activity.isDestroyed(); }
    private void ui(Runnable action) { activity.runOnUiThread(() -> { if (alive()) action.run(); }); }
    private void toast(String message) { Toast.makeText(activity, message, Toast.LENGTH_LONG).show(); }
    private HttpURLConnection connect(String path) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(BASE + path).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(15000); connection.setReadTimeout(20000);
        connection.setUseCaches(false); connection.setRequestProperty("Cache-Control", "no-cache");
        if (connection.getResponseCode() != 200) { connection.disconnect(); throw new Exception("update HTTP failure"); }
        return connection;
    }
    void check(boolean manual) {
        if (!busy.compareAndSet(false, true)) { if (manual) toast("正在检查或下载更新"); return; }
        if (manual) toast("正在检查更新…");
        worker.submit(() -> {
            try {
                HttpURLConnection connection = connect("latest.json?t=" + System.currentTimeMillis());
                byte[] data;
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[4096]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (out.size() + count > 65536) throw new SecurityException("manifest too large");
                        out.write(buffer, 0, count);
                    }
                    data = out.toByteArray();
                } finally { connection.disconnect(); }
                JSONObject envelope = new JSONObject(new String(data, StandardCharsets.UTF_8));
                byte[] payload = UpdatePolicy.verify(envelope.getString("payload"), envelope.getString("signature"), UpdateTrust.PUBLIC_KEY);
                JSONObject release = new JSONObject(new String(payload, StandardCharsets.UTF_8));
                long available = release.getLong("versionCode");
                UpdatePolicy.validate(available, release.getString("filename"), release.getLong("bytes"), release.getString("sha256"));
                if (!activity.getPackageName().equals(release.getString("packageName"))) throw new SecurityException("wrong package");
                long installed = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).getLongVersionCode();
                ui(() -> {
                    if (!UpdatePolicy.newer(available, installed)) { if (manual) toast("当前已是最新版本"); return; }
                    new AlertDialog.Builder(activity).setTitle("发现新版本 " + release.optString("version"))
                            .setMessage(release.optString("notes", "工作台体验与稳定性更新") + "\n\n下载完成后由系统确认安装，保留登录和项目数据。")
                            .setNegativeButton("稍后", null).setPositiveButton("下载更新", (dialog, which) -> download(release)).show();
                });
            } catch (Exception ex) { if (manual) ui(() -> toast("检查更新失败，请检查网络后重试")); }
            finally { busy.set(false); }
        });
    }
    private void download(JSONObject release) {
        if (!busy.compareAndSet(false, true)) return;
        cancelled = false;
        progress = new ProgressDialog(activity); progress.setTitle("正在下载更新");
        progress.setProgressStyle(ProgressDialog.STYLE_HORIZONTAL); progress.setMax(100);
        progress.setCancelable(false); progress.setButton(ProgressDialog.BUTTON_NEGATIVE, "取消", (dialog, which) -> cancelled = true);
        progress.show();
        worker.submit(() -> {
            File directory = new File(activity.getFilesDir(), "updates");
            File temporary = new File(directory, "download.part");
            File ready = new File(directory, "update.apk");
            try {
                if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("no update directory");
                long expected = release.getLong("bytes");
                HttpURLConnection connection = connect(release.getString("filename"));
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long bytes = 0; int lastPercent = -1;
                try (InputStream input = connection.getInputStream(); FileOutputStream out = new FileOutputStream(temporary)) {
                    byte[] buffer = new byte[32768]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (cancelled || Thread.currentThread().isInterrupted()) throw new InterruptedException();
                        bytes += count; if (bytes > expected || bytes > UpdatePolicy.MAX_APK_BYTES) throw new SecurityException("unexpected size");
                        out.write(buffer, 0, count); digest.update(buffer, 0, count);
                        int percent = (int) (bytes * 100 / expected);
                        if (percent != lastPercent) { lastPercent = percent; ui(() -> progress.setProgress(percent)); }
                    }
                    out.getFD().sync();
                } finally { connection.disconnect(); }
                StringBuilder hash = new StringBuilder(); for (byte value : digest.digest()) hash.append(String.format("%02x", value & 255));
                if (bytes != expected || !hash.toString().equals(release.getString("sha256"))) throw new SecurityException("checksum mismatch");
                verifyApk(temporary, release.getLong("versionCode"));
                if (ready.exists() && !ready.delete()) throw new Exception("old update locked");
                if (!temporary.renameTo(ready)) throw new Exception("update rename failed");
                activity.getPreferences(0).edit().putLong("pendingUpdateVersion", release.getLong("versionCode")).apply();
                ui(this::install);
            } catch (Exception ex) { ui(() -> toast(cancelled ? "更新下载已取消" : "更新下载或校验失败，请重试")); }
            finally { temporary.delete(); busy.set(false); ui(() -> { if (progress != null) progress.dismiss(); }); }
        });
    }
    private void verifyApk(File apk, long version) throws Exception {
        PackageManager pm = activity.getPackageManager();
        PackageInfo candidate = pm.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
        PackageInfo installed = pm.getPackageInfo(activity.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
        if (candidate == null || !activity.getPackageName().equals(candidate.packageName)
                || candidate.getLongVersionCode() != version || !UpdatePolicy.newer(version, installed.getLongVersionCode())
                || candidate.signingInfo == null || installed.signingInfo == null
                || !Arrays.equals(candidate.signingInfo.getApkContentsSigners(), installed.signingInfo.getApkContentsSigners()))
            throw new SecurityException("update identity mismatch");
    }
    private void install() {
        try {
            File apk = new File(activity.getFilesDir(), "updates/update.apk");
            verifyApk(apk, activity.getPreferences(0).getLong("pendingUpdateVersion", 0));
            if (!activity.getPackageManager().canRequestPackageInstalls()) {
                new AlertDialog.Builder(activity).setTitle("允许安装更新")
                        .setMessage("请在接下来的系统页面允许 Cocloud 安装应用。返回后会打开更新安装界面。")
                        .setNegativeButton("取消", null).setPositiveButton("打开设置", (dialog, which) -> {
                            try {
                                waitingForPermission = true;
                                activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
                            } catch (RuntimeException ex) { waitingForPermission = false; toast("请在系统设置中允许此应用安装更新"); }
                        }).show();
                return;
            }
            toast("正在准备系统安装程序…");
            worker.submit(() -> stageInstall(apk));
        } catch (Exception ex) { toast("无法打开更新安装程序，请重新检查更新"); }
    }
    private void stageInstall(File apk) {
        PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
        int sessionId = -1;
        try {
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(activity.getPackageName());
            params.setSize(apk.length());
            if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
            sessionId = installer.createSession(params);
            try (PackageInstaller.Session session = installer.openSession(sessionId)) {
                try (InputStream input = new FileInputStream(apk); OutputStream output = session.openWrite("base.apk", 0, apk.length())) {
                    byte[] buffer = new byte[32768]; int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    session.fsync(output);
                }
                Intent result = new Intent(activity, UpdateInstallReceiver.class)
                        .setAction(activity.getPackageName() + ".UPDATE_INSTALL_STATUS")
                        .setData(Uri.parse("cocloud-install:" + sessionId));
                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
                PendingIntent callback = PendingIntent.getBroadcast(activity, sessionId, result, flags);
                session.commit(callback.getIntentSender());
            }
        } catch (Exception ex) {
            if (sessionId >= 0) try { installer.abandonSession(sessionId); } catch (RuntimeException ignored) { }
            ui(() -> new AlertDialog.Builder(activity).setTitle("无法准备安装更新")
                    .setMessage("请使用手机浏览器下载最新 APK 覆盖安装，无需卸载。\n\n" + ex.getClass().getSimpleName())
                    .setPositiveButton("确定", null).show());
        }
    }
    void showInstallResult() {
        android.content.SharedPreferences prefs = activity.getSharedPreferences("update-install", 0);
        String failure = prefs.getString("failure", null);
        if (failure == null) return;
        prefs.edit().remove("failure").apply();
        new AlertDialog.Builder(activity).setTitle("更新未完成").setMessage(failure)
                .setPositiveButton("确定", null).show();
    }
    void resumeInstall() {
        if (!waitingForPermission) return;
        waitingForPermission = false;
        if (activity.getPackageManager().canRequestPackageInstalls()) install();
    }
    void close() { cancelled = true; worker.shutdownNow(); if (progress != null) progress.dismiss(); }
}

package cn.cocloud.workbench;

import android.app.Activity;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.WebView;
import android.widget.Toast;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Pull bounded chunks from our top-level WebView into a pending MediaStore download.
 * No addJavascriptInterface: page scripts cannot directly invoke native writes.
 */
final class BlobDownloads {
    private final Activity activity;
    private final WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService disk = Executors.newSingleThreadExecutor();
    private final String script;
    private Job active;
    private boolean closed;
    private static final class Job {
        final String id = UUID.randomUUID().toString();
        final long started = SystemClock.elapsedRealtime();
        final String fallbackName, fallbackMime;
        DownloadPolicy.Transfer transfer;
        String name;
        Uri uri;
        OutputStream output;
        volatile boolean cancelled;
        Job(String name, String mime) { fallbackName = name; fallbackMime = mime; }
    }
    BlobDownloads(Activity activity, WebView web) {
        this.activity = activity; this.web = web;
        try (InputStream input = activity.getAssets().open("blob-download.js")) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] block = new byte[8192]; int count;
            while ((count = input.read(block)) != -1) bytes.write(block, 0, count);
            script = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) { throw new IllegalStateException("Missing blob download transport", e); }
    }
    void install() {
        if (!closed && DownloadPolicy.trusted(web.getUrl())) web.evaluateJavascript(script, null);
    }
    boolean start(String url, String name, String mime) {
        if (url == null || !url.startsWith("blob:")) return false;
        if (closed || !DownloadPolicy.blob(url, web.getUrl())) { toast("无法保存其他页面的临时文件"); return true; }
        if (active != null) { toast("正在保存文件，请稍候"); return true; }
        Job j = active = new Job(name, mime);
        install();
        web.evaluateJavascript("window.__cocloudDownloadsV1.begin(" + JSONObject.quote(j.id) + "," + JSONObject.quote(url) + ")", value -> {
            if (!valid(j)) return;
            if (!"true".equals(value)) { fail(j, "无法读取临时文件，请重新点击保存"); return; }
            toast("正在保存文件…"); pollInfo(j);
        });
        ui.postDelayed(() -> { if (active == j) fail(j, "保存超时，请重试"); }, 120000);
        return true;
    }
    private boolean valid(Job j) {
        if (closed || j.cancelled || active != j) return false;
        if (!DownloadPolicy.trusted(web.getUrl()) || SystemClock.elapsedRealtime() - j.started > 120000) {
            fail(j, "页面已改变或下载超时"); return false;
        }
        return true;
    }
    private JSONObject object(String raw) throws Exception {
        Object value = new JSONTokener(raw == null ? "null" : raw).nextValue();
        if (!(value instanceof JSONObject)) throw new IllegalArgumentException("页面下载数据已失效");
        return (JSONObject)value;
    }
    private void pollInfo(Job j) {
        if (!valid(j)) return;
        web.evaluateJavascript("window.__cocloudDownloadsV1.info(" + JSONObject.quote(j.id) + ")", raw -> {
            if (!valid(j)) return;
            try {
                JSONObject info = object(raw);
                if ("error".equals(info.optString("phase"))) throw new IllegalArgumentException(info.optString("error", "读取失败"));
                if (!"ready".equals(info.optString("phase"))) { ui.postDelayed(() -> pollInfo(j), 50); return; }
                j.transfer = new DownloadPolicy.Transfer(info.getLong("size"));
                String mime = DownloadPolicy.mime(info.optString("mime", j.fallbackMime));
                j.name = DownloadPolicy.filename(info.optString("name", "").isEmpty() ? j.fallbackName : info.optString("name"), mime);
                disk.execute(() -> {
                    try {
                        if (j.cancelled) return;
                        ContentValues values = new ContentValues();
                        values.put(MediaStore.Downloads.DISPLAY_NAME, j.name);
                        values.put(MediaStore.Downloads.MIME_TYPE, mime);
                        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                        values.put(MediaStore.Downloads.IS_PENDING, 1);
                        j.uri = activity.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                        if (j.uri == null) throw new IllegalStateException("无法创建下载文件");
                        j.output = activity.getContentResolver().openOutputStream(j.uri, "w");
                        if (j.output == null) throw new IllegalStateException("无法写入下载目录");
                        ui.post(() -> next(j));
                    } catch (Exception e) { ui.post(() -> fail(j, "无法创建下载文件")); }
                });
            } catch (Exception e) { fail(j, e.getMessage()); }
        });
    }
    private void next(Job j) {
        if (!valid(j)) return;
        if (j.transfer.complete()) { finish(j); return; }
        long offset = j.transfer.offset;
        web.evaluateJavascript("window.__cocloudDownloadsV1.pull(" + JSONObject.quote(j.id) + "," + offset + ")", raw -> {
            if (!valid(j)) return;
            try {
                JSONObject chunk = object(raw);
                if (chunk.has("error")) throw new IllegalArgumentException(chunk.optString("error"));
                if (chunk.optBoolean("pending")) { ui.postDelayed(() -> next(j), 50); return; }
                if (chunk.getLong("offset") != offset) throw new IllegalArgumentException("下载顺序错误");
                String data = chunk.getString("data");
                if (data.length() > DownloadPolicy.CHUNK_BYTES * 4 / 3 + 4) throw new IllegalArgumentException("下载数据超限");
                byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
                j.transfer.accept(offset, bytes.length);
                disk.execute(() -> {
                    try { if (j.cancelled) return; j.output.write(bytes); ui.post(() -> next(j)); }
                    catch (Exception e) { ui.post(() -> fail(j, "写入下载目录失败")); }
                });
            } catch (Exception e) { fail(j, e.getMessage()); }
        });
    }
    private void finish(Job j) {
        disk.execute(() -> {
            try {
                if (j.cancelled) return;
                j.output.close(); j.output = null;
                if (!j.transfer.complete()) throw new IllegalStateException("文件未完整写入");
                if (j.cancelled) return;
                ContentValues values = new ContentValues(); values.put(MediaStore.Downloads.IS_PENDING, 0);
                if (activity.getContentResolver().update(j.uri, values, null, null) != 1) throw new IllegalStateException("无法完成文件保存");
                ui.post(() -> {
                    if (!valid(j)) return;
                    release(j); active = null;
                    toast("已保存到下载文件夹：" + j.name);
                });
            } catch (Exception e) { ui.post(() -> fail(j, "保存未完成，请重试")); }
        });
    }
    private void release(Job j) {
        if (!closed) web.evaluateJavascript("window.__cocloudDownloadsV1?.cancel(" + JSONObject.quote(j.id) + ")", null);
    }
    private void fail(Job j, String reason) {
        if (active != j || j.cancelled) return;
        j.cancelled = true; active = null; release(j);
        disk.execute(() -> {
            try { if (j.output != null) j.output.close(); } catch (Exception ignored) { }
            try { if (j.uri != null) activity.getContentResolver().delete(j.uri, null, null); } catch (Exception ignored) { }
        });
        if (!closed) toast("保存失败：" + (reason == null ? "请重试" : reason));
    }
    void navigationStarted() { if (active != null) fail(active, "页面已切换，请重新保存"); }
    void close() { closed = true; if (active != null) fail(active, "页面已关闭"); disk.shutdown(); ui.removeCallbacksAndMessages(null); }
    private void toast(String text) { Toast.makeText(activity, text, Toast.LENGTH_LONG).show(); }
}

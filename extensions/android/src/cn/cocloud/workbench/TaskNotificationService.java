package cn.cocloud.workbench;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.IBinder;
import android.webkit.CookieManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Observes authenticated server metadata only; never runs an agent or sends model requests. */
public final class TaskNotificationService extends Service {
    static final String HOME = BuildConfig.ORIGIN + "/";
    private static final String MONITOR = "task-monitor", COMPLETE = "task-completed";
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor();
    private volatile boolean closed;
    private volatile HttpURLConnection connection;
    private SharedPreferences prefs;
    private TaskCompletionGate gate;
    private String environmentId;
    private int failures;
    private CookieManager cookies;
    static SharedPreferences preferences(android.content.Context context) {
        return context.getSharedPreferences("task-notifications", MODE_PRIVATE);
    }
    static boolean enabled(android.content.Context context) { return preferences(context).getBoolean("enabled", true); }
    @Override public void onCreate() {
        super.onCreate();
        prefs = preferences(this);
        cookies = CookieManager.getInstance();
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel monitor = new NotificationChannel(MONITOR, "后台任务提醒服务", NotificationManager.IMPORTANCE_LOW);
        monitor.setDescription("保持远程任务状态检查；可在工作台设置中关闭");
        monitor.setShowBadge(false);
        manager.createNotificationChannel(monitor);
        NotificationChannel complete = new NotificationChannel(COMPLETE, "任务完成", NotificationManager.IMPORTANCE_HIGH);
        complete.setDescription("服务器任务完成时提醒，点击打开对应对话");
        complete.enableVibration(true);
        manager.createNotificationChannel(complete);
        startForeground(4100, new Notification.Builder(this, MONITOR)
            .setSmallIcon(cn.cocloud.workbench.R.drawable.ic_notification)
            .setContentTitle("云端任务提醒已开启")
            .setContentText("后台检查任务状态，点击打开工作台")
            .setContentIntent(openIntent(null)).setOngoing(true).setOnlyAlertOnce(true)
            .addAction(new Notification.Action.Builder(null, "关闭提醒", PendingIntent.getService(this, 4101,
                new Intent(this, TaskNotificationService.class).setAction("stop"), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)).build())
            .build());
        Map<String, String> saved = new HashMap<>();
        try {
            JSONObject data = new JSONObject(prefs.getString("handled", "{}"));
            for (Iterator<String> keys = data.keys(); keys.hasNext();) { String id = keys.next(); saved.put(id, data.getString(id)); }
        } catch (Exception ignored) { }
        gate = new TaskCompletionGate(prefs.getBoolean("initialized", false), saved);
        worker.schedule(this::poll, 0, TimeUnit.SECONDS);
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (!enabled(this) || (intent != null && "stop".equals(intent.getAction()))) {
            prefs.edit().putBoolean("enabled", false).apply();
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }
    private JSONObject get(String path) throws Exception {
        HttpURLConnection http = (HttpURLConnection) new URL(HOME + path).openConnection();
        connection = http;
        try {
            http.setInstanceFollowRedirects(false);
            http.setConnectTimeout(10000); http.setReadTimeout(15000); http.setUseCaches(false);
            http.setRequestProperty("x-t3-orchestration-protocol", "2");
            String cookie = cookies.getCookie(HOME);
            if (cookie != null) http.setRequestProperty("Cookie", cookie);
            if (http.getResponseCode() != 200) throw new Exception("status unavailable");
            try (InputStream input = http.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] block = new byte[8192]; int count;
                while ((count = input.read(block)) != -1) {
                    output.write(block, 0, count);
                    if (output.size() > 8 * 1024 * 1024) throw new Exception("snapshot too large");
                }
                return new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
            }
        } finally { http.disconnect(); connection = null; }
    }
    private void poll() {
        long delay = 15;
        try {
            if (closed || !enabled(this)) return;
            if (cookies.getCookie(HOME) == null) { delay = 30; return; }
            if (environmentId == null) environmentId = get(".well-known/t3/environment").getString("environmentId");
            // Keep settled threads to catch completions that happened during network interruptions.
            JSONArray threads = get("api/orchestration/shell?omitIdleSubagents=1").getJSONArray("threads");
            Set<String> ids = new HashSet<>();
            for (int i = 0; i < threads.length(); i++) {
                JSONObject thread = threads.getJSONObject(i);
                String id = thread.getString("id"); ids.add(id);
                boolean completed = "completed".equals(thread.optString("status"))
                    && thread.isNull("activeRunId") && !thread.isNull("latestRunCompletedAt");
                JSONObject lineage = thread.optJSONObject("lineage");
                boolean nested = lineage != null && ("subagent".equals(lineage.optString("relationshipToParent")) || lineage.optBoolean("sideChat"));
                boolean quiet = !thread.isNull("archivedAt") || thread.optBoolean("latestRunStopRequested")
                    || nested || !thread.isNull("pendingRuntimeRequest");
                if (gate.observe(id, thread.optString("latestRunId", ""), completed, quiet))
                    notifyCompleted(id, thread.optString("title", "云端对话"));
            }
            gate.finishSnapshot(ids);
            prefs.edit().putBoolean("initialized", true).putString("handled", new JSONObject(gate.handled).toString()).apply();
            failures = 0;
        } catch (Exception ignored) {
            delay = Math.min(120, 15L << Math.min(++failures, 3));
        } finally {
            if (!closed) worker.schedule(this::poll, delay, TimeUnit.SECONDS);
        }
    }
    private PendingIntent openIntent(String thread) {
        Intent intent = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (thread != null) intent.setData(android.net.Uri.parse(HOME).buildUpon()
            .appendQueryParameter("cocloudThread", thread).appendQueryParameter("cocloudEnvironment", environmentId).build());
        return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private void notifyCompleted(String thread, String title) {
        try {
            getSystemService(NotificationManager.class).notify("complete:" + thread, 4102,
                new Notification.Builder(this, COMPLETE).setSmallIcon(cn.cocloud.workbench.R.drawable.ic_notification)
                    .setContentTitle("任务已完成").setContentText(title).setContentIntent(openIntent(thread))
                    .setAutoCancel(true).setCategory(Notification.CATEGORY_STATUS).build());
        } catch (SecurityException ignored) { }
    }
    @Override public void onDestroy() {
        closed = true;
        HttpURLConnection http = connection; if (http != null) http.disconnect();
        worker.shutdownNow(); super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}

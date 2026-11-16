"""Run the production install state and receiver against a small host Android fixture."""
from pathlib import Path
import subprocess
import sys
import tempfile

source = Path(__file__).resolve().parents[1]
java = Path(sys.argv[1]) / 'bin'
stubs = {
    'android/content/SharedPreferences.java': '''
package android.content;
public interface SharedPreferences {
    int getInt(String key, int fallback);
    long getLong(String key, long fallback);
    String getString(String key, String fallback);
    Editor edit();
    interface Editor {
        Editor putInt(String key, int value);
        Editor putLong(String key, long value);
        Editor putString(String key, String value);
        Editor remove(String key);
        boolean commit();
        void apply();
    }
}''',
    'android/content/Context.java': '''
package android.content;
import android.content.pm.PackageManager;
public abstract class Context {
    public abstract SharedPreferences getSharedPreferences(String name, int mode);
    public abstract String getPackageName();
    public abstract PackageManager getPackageManager();
    public abstract void startActivity(Intent intent);
}''',
    'android/content/BroadcastReceiver.java': '''
package android.content;
public abstract class BroadcastReceiver { public abstract void onReceive(Context context, Intent intent); }
''',
    'android/net/Uri.java': '''
package android.net;
public final class Uri {
    private final String value;
    private Uri(String value) { this.value = value; }
    public static Uri parse(String value) { return new Uri(value); }
    public String getScheme() { return value.split(":", 2)[0]; }
    public String getSchemeSpecificPart() { return value.split(":", 2)[1]; }
}''',
    'android/content/Intent.java': '''
package android.content;
import android.net.Uri;
public class Intent {
    public static final String EXTRA_INTENT = "intent";
    public static final int FLAG_ACTIVITY_NEW_TASK = 0x10000000;
    private String action; private Uri data;
    private final java.util.Map<String, Object> extras = new java.util.HashMap<>();
    public Intent setAction(String value) { action = value; return this; }
    public String getAction() { return action; }
    public Intent setData(Uri value) { data = value; return this; }
    public Uri getData() { return data; }
    public Intent putExtra(String key, Object value) { extras.put(key, value); return this; }
    public int getIntExtra(String key, int fallback) { return (int) extras.getOrDefault(key, fallback); }
    public String getStringExtra(String key) { return (String) extras.get(key); }
    @SuppressWarnings("unchecked") public <T> T getParcelableExtra(String key) { return (T) extras.get(key); }
    public Intent addFlags(int flags) { return this; }
}''',
    'android/content/pm/PackageInfo.java': '''
package android.content.pm;
public class PackageInfo { public long version; public long getLongVersionCode() { return version; } }
''',
    'android/content/pm/PackageManager.java': '''
package android.content.pm;
public abstract class PackageManager { public abstract PackageInfo getPackageInfo(String name, int flags) throws Exception; }
''',
    'android/content/pm/PackageInstaller.java': '''
package android.content.pm;
public final class PackageInstaller {
    public static final String EXTRA_STATUS = "status", EXTRA_STATUS_MESSAGE = "message";
    public static final int STATUS_PENDING_USER_ACTION = -1, STATUS_SUCCESS = 0, STATUS_FAILURE = 1, STATUS_FAILURE_ABORTED = 3;
}''',
    'android/widget/Toast.java': '''
package android.widget;
import android.content.Context;
public class Toast {
    public static final int LENGTH_LONG = 1; public static int shown;
    public static Toast makeText(Context context, String text, int duration) { return new Toast(); }
    public void show() { shown++; }
}''',
}

with tempfile.TemporaryDirectory(prefix='update-install-regression-') as temporary:
    root = Path(temporary)
    for name, text in stubs.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    classes = root / 'classes'
    production = source / 'src/cn/cocloud/workbench'
    subprocess.run([str(java / 'javac'), '-encoding', 'UTF-8', '-d', str(classes),
                    *map(str, root.rglob('*.java')),
                    str(production / 'UpdateInstallState.java'), str(production / 'UpdateInstallReceiver.java'),
                    str(source / 'tests/UpdateInstallStateTest.java')], check=True)
    subprocess.run([str(java / 'java'), '-cp', str(classes), 'cn.cocloud.workbench.UpdateInstallStateTest'], check=True)

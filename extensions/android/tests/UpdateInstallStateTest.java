package cn.cocloud.workbench;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.widget.Toast;
import java.util.HashMap;
import java.util.Map;

public final class UpdateInstallStateTest {
    static final String ABORTED = "INSTALL_FAILED_ABORTED: User rejected permissions";
    static final class Prefs implements SharedPreferences {
        final Map<String, Object> values = new HashMap<>();
        boolean writable = true;
        public int getInt(String key, int fallback) { return (int) values.getOrDefault(key, fallback); }
        public long getLong(String key, long fallback) { return (long) values.getOrDefault(key, fallback); }
        public String getString(String key, String fallback) { return (String) values.getOrDefault(key, fallback); }
        public Editor edit() { return new Editor() {
            final Map<String, Object> changes = new HashMap<>();
            public Editor putInt(String key, int value) { changes.put(key, value); return this; }
            public Editor putLong(String key, long value) { changes.put(key, value); return this; }
            public Editor putString(String key, String value) { changes.put(key, value); return this; }
            public Editor remove(String key) { changes.put(key, null); return this; }
            public boolean commit() {
                if (!writable) return false;
                changes.forEach((key, value) -> { if (value == null) values.remove(key); else values.put(key, value); });
                return true;
            }
            public void apply() { commit(); }
        }; }
    }
    static final class Device extends Context {
        final Prefs prefs;
        long installed = 8;
        int confirmations;
        boolean lookupFails, confirmationFails;
        Device() { this(new Prefs()); }
        Device(Prefs prefs) { this.prefs = prefs; }
        public SharedPreferences getSharedPreferences(String name, int mode) { return prefs; }
        public String getPackageName() { return "cn.cocloud.workbench"; }
        public PackageManager getPackageManager() { return new PackageManager() {
            public PackageInfo getPackageInfo(String name, int flags) throws Exception {
                if (lookupFails) throw new Exception("package lookup unavailable");
                PackageInfo info = new PackageInfo(); info.version = installed; return info;
            }
        }; }
        public void startActivity(Intent intent) {
            if (confirmationFails) throw new IllegalStateException("installer unavailable");
            confirmations++;
        }
    }
    static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    static Intent result(int session, int status) {
        return new Intent().setAction("cn.cocloud.workbench.UPDATE_INSTALL_STATUS")
                .setData(Uri.parse("cocloud-install:" + session))
                .putExtra(PackageInstaller.EXTRA_STATUS, status).putExtra(PackageInstaller.EXTRA_STATUS_MESSAGE, ABORTED);
    }
    static void deliver(Device device, int session, int status) {
        new UpdateInstallReceiver().onReceive(device, result(session, status));
    }
    public static void main(String[] args) {
        Device device = new Device();
        // Original failure: the old APK saved only a failure string and an Activity target.
        UpdateInstallState.fail(device, ABORTED);
        check(UpdateInstallState.consumeFailure(device, 8) == null, "already installed legacy update must not show failure");
        check(device.prefs.values.isEmpty(), "successful migration must clear stale state");
        UpdateInstallState.fail(device, ABORTED);
        check(UpdateInstallState.consumeFailure(device, 7) == null, "newer installed version supersedes old failure");
        UpdateInstallState.fail(device, ABORTED);
        check(ABORTED.equals(UpdateInstallState.consumeFailure(device, 9)), "real legacy failure must remain visible");
        check(UpdateInstallState.consumeFailure(device, 9) == null, "failure shown only once");

        // Process replacement dropped success; a later abort must not revive the failure.
        UpdateInstallState.begin(device, 20, 9);
        deliver(device, 20, PackageInstaller.STATUS_FAILURE_ABORTED);
        Device relaunched = new Device(device.prefs); relaunched.installed = 9;
        check(UpdateInstallState.consumeFailure(relaunched, 0) == null, "relaunch must reconcile persisted target without success callback");
        int toasts = Toast.shown;
        deliver(relaunched, 20, PackageInstaller.STATUS_FAILURE_ABORTED);
        check(Toast.shown == toasts && relaunched.prefs.values.isEmpty(), "late abort after success must be ignored");
        UpdateInstallState.begin(relaunched, 21, 9);
        deliver(relaunched, 21, PackageInstaller.STATUS_FAILURE_ABORTED);
        check(Toast.shown == toasts && relaunched.prefs.values.isEmpty(), "installed version wins over current abort callback");

        // A newer target must still report genuine rejection, even if a prior update succeeded.
        UpdateInstallState.begin(device, 30, 9);
        deliver(device, 30, PackageInstaller.STATUS_FAILURE_ABORTED);
        String failure = UpdateInstallState.consumeFailure(device, 8);
        check(failure != null && failure.contains(ABORTED) && failure.contains("3"), "actual rejection must preserve system reason");
        check(UpdateInstallState.consumeFailure(device, 8) == null, "real rejection shown once");
        UpdateInstallState.fail(device, ABORTED);
        UpdateInstallState.begin(device, 31, 10);
        deliver(device, 30, PackageInstaller.STATUS_FAILURE_ABORTED);
        deliver(device, 30, PackageInstaller.STATUS_SUCCESS);
        check(device.prefs.getString("failure", null) == null && UpdateInstallState.accepts(device, 31), "old callbacks must not alter new attempt");
        deliver(device, 31, PackageInstaller.STATUS_SUCCESS);
        check(device.prefs.values.isEmpty(), "matching success clears state");

        UpdateInstallState.begin(device, 40, 9);
        Intent confirmation = result(40, PackageInstaller.STATUS_PENDING_USER_ACTION).putExtra(Intent.EXTRA_INTENT, new Intent());
        new UpdateInstallReceiver().onReceive(device, confirmation);
        check(device.confirmations == 1, "current install must open system confirmation");
        UpdateInstallState.begin(device, 41, 9);
        new UpdateInstallReceiver().onReceive(device, confirmation);
        check(device.confirmations == 1, "superseded install must not open confirmation");
        device.confirmationFails = true;
        new UpdateInstallReceiver().onReceive(device,
                result(41, PackageInstaller.STATUS_PENDING_USER_ACTION).putExtra(Intent.EXTRA_INTENT, new Intent()));
        check(UpdateInstallState.consumeFailure(device, 0) != null, "confirmation launch failure must stay visible");

        UpdateInstallState.fail(device, ABORTED);
        device.lookupFails = true;
        check(ABORTED.equals(UpdateInstallState.consumeFailure(device, 9)), "lookup failure must not hide installation error");
        device.lookupFails = false;
        UpdateInstallState.clear(device);
        UpdateInstallState.fail(device, ABORTED);
        check(ABORTED.equals(UpdateInstallState.consumeFailure(device, 0)), "unknown target cannot prove success");
        device.prefs.writable = false;
        try { UpdateInstallState.begin(device, 50, 9); throw new AssertionError("unpersisted install accepted"); }
        catch (IllegalStateException expected) { }
        System.out.println("Install result regression passed: legacy false failure, process replacement, late abort, session isolation, real rejection and confirmation handling.");
    }
}

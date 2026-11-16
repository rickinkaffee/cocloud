package cn.cocloud.workbench;

import android.content.Context;
import android.content.SharedPreferences;

/** Persist before commit: self replacement may kill the process before its success callback. */
final class UpdateInstallState {
    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("update-install", 0);
    }

    static void begin(Context context, int sessionId, long targetVersion) {
        if (targetVersion <= 0 || sessionId < 0) throw new IllegalArgumentException("invalid install attempt");
        if (!prefs(context).edit().putInt("sessionId", sessionId).putLong("targetVersion", targetVersion)
                .remove("failure").commit()) throw new IllegalStateException("cannot persist install attempt");
    }

    static boolean accepts(Context context, int sessionId) {
        return sessionId >= 0 && prefs(context).getInt("sessionId", -1) == sessionId;
    }

    static void clear(Context context) {
        prefs(context).edit().remove("failure").remove("sessionId").remove("targetVersion").apply();
    }

    static boolean reconcile(Context context, long legacyTarget) {
        long target = prefs(context).getLong("targetVersion", legacyTarget);
        if (target <= 0) return false;
        try {
            long installed = context.getPackageManager().getPackageInfo(context.getPackageName(), 0).getLongVersionCode();
            if (installed < target) return false;
        } catch (Exception ex) {
            // An unavailable package lookup must not hide an actual installation error.
            return false;
        }
        clear(context);
        return true;
    }

    static void fail(Context context, String message) {
        prefs(context).edit().putString("failure", message).apply();
    }

    static String consumeFailure(Context context, long legacyTarget) {
        if (reconcile(context, legacyTarget)) return null;
        String failure = prefs(context).getString("failure", null);
        if (failure != null) prefs(context).edit().remove("failure").apply();
        return failure;
    }
}

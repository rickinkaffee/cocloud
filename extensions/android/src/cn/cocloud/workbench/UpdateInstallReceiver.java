package cn.cocloud.workbench;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.widget.Toast;

/** Only the explicit PendingIntent issued for our install session reaches this receiver. */
public final class UpdateInstallReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent result) {
        if (!(context.getPackageName() + ".UPDATE_INSTALL_STATUS").equals(result.getAction())) return;
        int status = result.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirmation = result.getParcelableExtra(Intent.EXTRA_INTENT);
            try {
                if (confirmation == null) throw new IllegalStateException("missing confirmation");
                confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(confirmation);
            } catch (RuntimeException ex) {
                failure(context, "系统安装确认页面未能打开，请返回工作台重试，或使用浏览器下载 APK 覆盖安装。");
            }
        } else if (status == PackageInstaller.STATUS_SUCCESS) {
            context.getSharedPreferences("update-install", 0).edit().remove("failure").apply();
        } else {
            String message = result.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            if (message == null) message = "系统未提供详细原因";
            failure(context, "系统安装返回代码 " + status + "：\n"
                    + message.substring(0, Math.min(message.length(), 800))
                    + "\n\n可使用手机浏览器下载最新 APK 覆盖安装，无需卸载。");
        }
    }
    private static void failure(Context context, String message) {
        context.getSharedPreferences("update-install", 0).edit().putString("failure", message).apply();
        Toast.makeText(context, "更新未完成，返回工作台查看安装原因", Toast.LENGTH_LONG).show();
    }
}

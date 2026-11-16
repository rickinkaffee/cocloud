package cn.cocloud.workbench;

final class CameraPolicy {
    static boolean shouldCapture(boolean capture, String[] types) {
        if (!capture || types == null || types.length == 0) return false;
        boolean image = false;
        for (String group : types) {
            if (group == null) continue;
            for (String type : group.split(",")) {
                String value = type.trim().toLowerCase(java.util.Locale.ROOT);
                if (value.isEmpty()) continue;
                if (!value.startsWith("image/")) return false;
                image = true;
            }
        }
        return image;
    }
    static boolean validName(String name) {
        return name != null && name.matches("photo-[a-f0-9-]{36}\\.jpg");
    }
}

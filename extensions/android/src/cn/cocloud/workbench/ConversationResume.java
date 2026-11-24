package cn.cocloud.workbench;

import java.net.URI;

final class ConversationResume {
    static String conversation(String url) {
        if (!DownloadPolicy.trusted(url)) return null;
        String path = URI.create(url).getRawPath();
        return path.matches("(?i)/(?:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|draft)/(?:[a-z0-9_~:-]|%[a-f0-9]{2})+")
            ? DownloadPolicy.ORIGIN + path : null;
    }

    static String returnTarget(String checkpoint, String current) {
        String saved = conversation(checkpoint);
        if (saved == null || !DownloadPolicy.trusted(current) || saved.equals(conversation(current))) return null;
        URI uri = URI.create(current);
        if (uri.getRawQuery() != null || uri.getRawFragment() != null) return null;
        return "/".equals(uri.getRawPath()) || uri.getRawPath().startsWith("/draft/") ? saved : null;
    }

    static boolean backgroundOnBack(String current, String previous) {
        String saved = conversation(current);
        return saved != null && !saved.startsWith(DownloadPolicy.ORIGIN + "/draft/") && returnTarget(saved, previous) != null;
    }
}

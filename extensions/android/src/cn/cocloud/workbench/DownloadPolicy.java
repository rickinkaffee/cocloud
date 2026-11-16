package cn.cocloud.workbench;

import java.net.URI;

final class DownloadPolicy {
    static final String ORIGIN = BuildConfig.ORIGIN;
    static final long MAX_BYTES = 64L * 1024 * 1024;
    static final int CHUNK_BYTES = 192 * 1024;
    static int effectivePort(URI uri) { return uri.getPort() == -1 ? 443 : uri.getPort(); }
    static boolean trusted(String value) {
        try {
            URI uri = URI.create(value);
            return "https".equals(uri.getScheme()) && URI.create(ORIGIN).getHost().equals(uri.getHost())
                && effectivePort(uri) == effectivePort(URI.create(ORIGIN)) && uri.getRawUserInfo() == null;
        } catch (Exception e) { return false; }
    }
    static boolean blob(String value, String page) {
        return trusted(page) && value != null && value.startsWith("blob:" + ORIGIN + "/")
            && value.length() > ("blob:" + ORIGIN + "/").length();
    }
    static String mime(String value) {
        return value != null && value.matches("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+") ? value : "application/octet-stream";
    }
    static String filename(String name, String mime) {
        String clean = name == null ? "" : name.replaceAll("[\\\\/\\p{Cntrl}:*?\"<>|]", "_").trim();
        if (clean.length() > 120) clean = clean.substring(clean.length() - 120);
        if (clean.isEmpty() || clean.equals(".") || clean.equals("..")) {
            String ext = "image/png".equals(mime) ? ".png" : "image/jpeg".equals(mime) ? ".jpg"
                : "application/json".equals(mime) ? ".json" : "text/plain".equals(mime) ? ".txt" : ".bin";
            clean = "download-" + System.currentTimeMillis() + ext;
        }
        return clean;
    }
    static final class Transfer {
        final long size;
        long offset;
        Transfer(long size) {
            if (size < 0 || size > MAX_BYTES) throw new IllegalArgumentException("Invalid download size");
            this.size = size;
        }
        void accept(long at, int count) {
            if (at != offset || count <= 0 || count > CHUNK_BYTES || count > size - offset)
                throw new IllegalArgumentException("Invalid download chunk");
            offset += count;
        }
        boolean complete() { return offset == size; }
    }
}

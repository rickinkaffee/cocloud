package cn.cocloud.workbench;

public final class DownloadPolicyTest {
    private static void check(boolean ok) { if (!ok) throw new AssertionError(); }
    private static void rejects(Runnable action) {
        try { action.run(); } catch (IllegalArgumentException expected) { return; }
        throw new AssertionError("Expected rejection");
    }
    public static void main(String[] args) {
        String origin = DownloadPolicy.ORIGIN;
        check(DownloadPolicy.blob("blob:" + origin + "/abc", origin + "/thread"));
        for (String url : new String[]{"blob:https://evil.test/abc", "blob:null/abc", "blob:" + origin + "@evil.test/abc", "data:text/plain,hi", "blob:" + origin + "/"})
            check(!DownloadPolicy.blob(url, origin));
        check(!DownloadPolicy.blob("blob:" + origin + "/abc", "https://evil.test/"));
        check(!DownloadPolicy.trusted("https://user:pass@workbench.example:8443/"));
        check(!DownloadPolicy.trusted("http://workbench.example:8443/"));
        check(DownloadPolicy.trusted(BuildConfig.ORIGIN + "/"));
        check(!DownloadPolicy.trusted("https://wrong.example/"));
        check(DownloadPolicy.filename("../../report.json\n", "application/json").indexOf('/') == -1);
        check(DownloadPolicy.filename("女孩.png", "image/png").equals("女孩.png"));
        check(DownloadPolicy.filename("", "image/png").endsWith(".png"));
        check(DownloadPolicy.mime("text/plain\r\nx:test").equals("application/octet-stream"));
        DownloadPolicy.Transfer t = new DownloadPolicy.Transfer(DownloadPolicy.CHUNK_BYTES + 1);
        rejects(() -> t.accept(1, 1)); rejects(() -> t.accept(0, 0));
        rejects(() -> t.accept(0, DownloadPolicy.CHUNK_BYTES + 1));
        t.accept(0, DownloadPolicy.CHUNK_BYTES); check(!t.complete());
        rejects(() -> t.accept(0, 1)); rejects(() -> t.accept(t.offset, 2));
        t.accept(t.offset, 1); check(t.complete());
        check(new DownloadPolicy.Transfer(0).complete());
        rejects(() -> new DownloadPolicy.Transfer(-1));
        rejects(() -> new DownloadPolicy.Transfer(DownloadPolicy.MAX_BYTES + 1));
        System.out.println("Download origin, filename, MIME, size, offset and completion tests passed");
    }
}

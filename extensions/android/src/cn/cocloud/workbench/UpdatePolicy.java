package cn.cocloud.workbench;

import java.security.KeyFactory;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

/** Pure Java checks shared by the Android client and focused build-time tests. */
public final class UpdatePolicy {
    public static final long MAX_APK_BYTES = 50L * 1024 * 1024;
    public static byte[] verify(String encoded, String signature, String key) throws Exception {
        if (encoded.length() > 50000 || signature.length() > 2048) throw new SecurityException("manifest too large");
        byte[] payload = Base64.getDecoder().decode(encoded);
        Signature verifier = Signature.getInstance("SHA256withRSA");
        verifier.initVerify(KeyFactory.getInstance("RSA").generatePublic(
                new X509EncodedKeySpec(Base64.getDecoder().decode(key))));
        verifier.update(payload);
        if (!verifier.verify(Base64.getDecoder().decode(signature))) throw new SecurityException("invalid update signature");
        return payload;
    }
    public static void validate(long version, String filename, long bytes, String sha256) {
        if (version <= 0 || !filename.matches("cocloud-android-[0-9]+[.][0-9]+[.][0-9]+[.]apk")
                || bytes <= 0 || bytes > MAX_APK_BYTES || !sha256.matches("[0-9a-f]{64}"))
            throw new SecurityException("invalid release metadata");
    }
    public static boolean newer(long available, long installed) { return available > installed; }
}

package cn.cocloud.workbench;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.util.Base64;

public final class UpdatePolicyTest {
    interface Attempt { void run() throws Exception; }
    static void rejects(Attempt attempt) throws Exception {
        try { attempt.run(); } catch (Exception expected) { return; }
        throw new AssertionError("Unsafe update accepted");
    }
    public static void main(String[] args) throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(2048);
        KeyPair pair = generator.generateKeyPair();
        String key = Base64.getEncoder().encodeToString(pair.getPublic().getEncoded());
        byte[] data = "{\"versionCode\":2}".getBytes(StandardCharsets.UTF_8);
        Signature signer = Signature.getInstance("SHA256withRSA"); signer.initSign(pair.getPrivate()); signer.update(data);
        String signature = Base64.getEncoder().encodeToString(signer.sign());
        String encoded = Base64.getEncoder().encodeToString(data);
        if (!java.util.Arrays.equals(UpdatePolicy.verify(encoded, signature, key), data)) throw new AssertionError();
        data[1] ^= 1;
        rejects(() -> UpdatePolicy.verify(Base64.getEncoder().encodeToString(data), signature, key));
        rejects(() -> UpdatePolicy.verify(encoded, signature, Base64.getEncoder().encodeToString(generator.generateKeyPair().getPublic().getEncoded())));
        String hash = new String(new char[64]).replace((char) 0, 'a');
        UpdatePolicy.validate(2, "cocloud-android-1.0.1.apk", 1024, hash);
        for (String name : new String[]{"../evil.apk", "https://evil/app.apk", "cocloud-android-1.0.1.apk?x=1", "other.apk"})
            rejects(() -> UpdatePolicy.validate(2, name, 1024, hash));
        rejects(() -> UpdatePolicy.validate(2, "cocloud-android-1.0.1.apk", 0, hash));
        rejects(() -> UpdatePolicy.validate(2, "cocloud-android-1.0.1.apk", UpdatePolicy.MAX_APK_BYTES + 1, hash));
        rejects(() -> UpdatePolicy.validate(2, "cocloud-android-1.0.1.apk", 1, "bad"));
        if (!UpdatePolicy.newer(2, 1) || UpdatePolicy.newer(1, 1) || UpdatePolicy.newer(1, 2)) throw new AssertionError("downgrade allowed");
        if (args.length == 3) UpdatePolicy.verify(args[1], args[2], args[0]);
        System.out.println("OTA policy: signed manifest, tamper rejection, pinned key, paths, size limits and downgrade checks passed");
    }
}

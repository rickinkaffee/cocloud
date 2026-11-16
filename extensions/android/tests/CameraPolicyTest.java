package cn.cocloud.workbench;

public final class CameraPolicyTest {
    static void require(boolean value) { if (!value) throw new AssertionError(); }
    public static void main(String[] args) {
        require(CameraPolicy.shouldCapture(true, new String[]{"image/*"}));
        require(CameraPolicy.shouldCapture(true, new String[]{"image/jpeg,image/png"}));
        require(CameraPolicy.shouldCapture(true, new String[]{" IMAGE/JPEG "}));
        require(!CameraPolicy.shouldCapture(false, new String[]{"image/*"}));
        require(!CameraPolicy.shouldCapture(true, new String[]{"video/*"}));
        require(!CameraPolicy.shouldCapture(true, new String[]{"image/*", "application/pdf"}));
        require(!CameraPolicy.shouldCapture(true, new String[]{"*/*"}));
        require(!CameraPolicy.shouldCapture(true, new String[]{""}));
        require(!CameraPolicy.shouldCapture(true, null));
        require(CameraPolicy.validName("photo-70ab6aef-9898-4f10-8d57-400c0569ba76.jpg"));
        for (String path : new String[]{"../update.apk", "photo-../../secret.jpg", "update.apk", "photo-.jpg", null})
            require(!CameraPolicy.validName(path));
        System.out.println("Camera policy: image-only capture and private output path regressions passed");
    }
}

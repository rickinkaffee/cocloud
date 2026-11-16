package cn.cocloud.workbench;

/** Pure protocol/state adapter between Android predictive back and the Ionic panel.
 * No touch thresholds here: Android owns edge recognition and cancellation. */
final class SidebarBackGesture {
    private int sequence;
    private int active;
    private boolean right;

    String start(boolean rightEdge) {
        active = ++sequence;
        right = rightEdge;
        return script("start", 0);
    }
    String progress(float value) {
        if (active == 0) return null;
        float safe = Float.isNaN(value) ? 0 : Math.max(0, Math.min(1, value));
        return script("progress", safe);
    }
    String cancel() { return end("cancel"); }
    String finish() { return end("finish"); }
    boolean active() { return active != 0; }
    private String end(String action) {
        if (active == 0) return null;
        String result = script(action, 0);
        active = 0;
        return result;
    }
    private String script(String action, float progress) {
        return "!window.dispatchEvent(new CustomEvent('cocloud-native-sidebar',{cancelable:true,detail:{action:'"
            + action + "',edge:'" + (right ? "right" : "left") + "',id:" + active
            + ",progress:" + Float.toString(progress) + "}}))";
    }
}

package cn.cocloud.workbench;

public final class SidebarBackGestureTest {
    static void require(boolean value, String label) { if (!value) throw new AssertionError(label); }
    public static void main(String[] args) {
        SidebarBackGesture back = new SidebarBackGesture();
        if (args.length > 0 && "--script-fixtures".equals(args[0])) {
            System.out.println(back.start(false));
            System.out.println(back.progress(.45f));
            System.out.println(back.finish());
            System.out.println(back.start(true));
            System.out.println(back.progress(.6f));
            System.out.println(back.cancel());
            return;
        }
        require(back.progress(.3f) == null && back.finish() == null, "idle callbacks must do nothing");
        require(back.start(false).contains("edge:'left',id:1"), "left edge start");
        require(back.active(), "capture stays active during progress");
        require(back.progress(.45f).contains("action:'progress',edge:'left',id:1,progress:0.45"), "progress must reach web before release");
        require(back.cancel().contains("action:'cancel'"), "system cancellation must restore original position");
        require(!back.active() && back.progress(.9f) == null && back.cancel() == null, "no movement after cancel");
        require(back.start(true).contains("edge:'right',id:2"), "right edge start");
        require(back.progress(-4).contains("progress:0.0"), "negative progress clamped");
        require(back.progress(4).contains("progress:1.0"), "overshoot clamped");
        require(back.progress(Float.NaN).contains("progress:0.0"), "non-number progress clamped");
        require(back.finish().contains("action:'finish',edge:'right',id:2"), "commit correct gesture");
        require(back.finish() == null && !back.active(), "cannot commit a gesture twice");
        require(back.start(false).contains("id:3"), "next gesture gets a distinct token");
        require(back.start(true).contains("id:4"), "replacement invalidates stale token");
        System.out.println("SidebarBackGestureTest: 13 lifecycle/progress checks passed");
    }
}

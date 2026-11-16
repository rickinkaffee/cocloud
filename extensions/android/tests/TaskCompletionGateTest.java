package cn.cocloud.workbench;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Arrays;

public final class TaskCompletionGateTest {
    private static void check(boolean value) { if (!value) throw new AssertionError(); }
    public static void main(String[] args) {
        TaskCompletionGate gate = new TaskCompletionGate(false, new HashMap<>());
        check(!gate.observe("old", "r1", true, false));
        check(!gate.observe("live", "r2", false, false));
        gate.finishSnapshot(new HashSet<>(Arrays.asList("old", "live")));
        check(gate.observe("live", "r2", true, false));
        check(!gate.observe("live", "r2", true, false));
        check(!gate.observe("old", "stopped", true, true));
        check(!gate.observe("old", "stopped", true, false));
        check(!gate.observe("old", "failed", false, false));
        check(gate.observe("other-device", "r3", true, false));
        TaskCompletionGate restored = new TaskCompletionGate(true, gate.handled);
        check(!restored.observe("live", "r2", true, false));
        check(restored.observe("live", "r4", true, false));
        System.out.println("Task completion baseline, dedup, reconnect and quiet-run tests passed");
    }
}

package cn.cocloud.workbench;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/** Persistent per-thread completion watermarks; a first snapshot never floods old results. */
final class TaskCompletionGate {
    final Map<String, String> handled = new HashMap<>();
    private boolean initialized;
    TaskCompletionGate(boolean initialized, Map<String, String> saved) {
        this.initialized = initialized;
        handled.putAll(saved);
    }
    boolean observe(String id, String runId, boolean completed, boolean quiet) {
        if (!completed || runId.isEmpty()) return false;
        String prior = handled.put(id, runId);
        return initialized && !quiet && !runId.equals(prior);
    }
    void finishSnapshot(Set<String> ids) {
        handled.keySet().retainAll(ids);
        initialized = true;
    }
}

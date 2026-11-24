package cn.cocloud.workbench;

public class ConversationResumeTest {
    public static void main(String[] args) {
        String home = DownloadPolicy.ORIGIN + "/";
        String saved = home + "12345678-1234-1234-1234-123456789abc/demo-thread-17";
        if (!saved.equals(ConversationResume.conversation(saved + "?panel=files"))) throw new AssertionError();
        for (String reset : new String[]{home, home + "draft/empty"})
            if (!saved.equals(ConversationResume.returnTarget(saved, reset))) throw new AssertionError();
        for (String intentional : new String[]{saved, home + "?cocloudThread=18", home + "settings", home + "pair", "https://example.org/"})
            if (ConversationResume.returnTarget(saved, intentional) != null) throw new AssertionError();
        if (ConversationResume.conversation("https://example.org/draft/test") != null) throw new AssertionError();
        System.out.println("Android lifecycle policy | simulated conversation: demo-thread-17");
        if (!ConversationResume.backgroundOnBack(saved, home + "draft/empty") || !ConversationResume.backgroundOnBack(saved, home)
                || ConversationResume.backgroundOnBack(saved, home + "settings") || ConversationResume.backgroundOnBack(saved, saved + "-other")) throw new AssertionError();
        System.out.println("System Back with home/draft behind conversation -> background without leaving thread: PASS");
        System.out.println("Pause in demo-thread-17 -> resume at /draft/empty -> demo-thread-17: PASS");
        System.out.println("Pause in demo-thread-17 -> resume at / -> demo-thread-17: PASS");
        System.out.println("Already on previous conversation -> no reload: PASS");
        System.out.println("Notification, settings, authentication and foreign origin left alone: PASS");
    }
}

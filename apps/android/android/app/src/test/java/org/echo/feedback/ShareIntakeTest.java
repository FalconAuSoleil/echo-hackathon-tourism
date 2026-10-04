package org.echo.feedback;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Test;

public class ShareIntakeTest {

    private static final ShareIntake.Item NOTE = new ShareIntake.Item(
        "https://localhost/_capacitor_file_/data/user/0/org.echo.feedback/cache/share/a",
        "PTT-20261004-WA0001.opus",
        "audio/ogg"
    );

    @Test
    public void loneLinkIsNotFeedback() {
        assertFalse(ShareIntake.isFeedbackText("https://example.org/x"));
        assertFalse(ShareIntake.isFeedbackText("   "));
        assertFalse(ShareIntake.isFeedbackText(null));
        assertTrue(ShareIntake.isFeedbackText("The walk was too long https://example.org"));
    }

    @Test
    public void countsLikeTheServiceWorker() {
        assertEquals(1, ShareIntake.expectedCount(Collections.singletonList(NOTE), ""));
        assertEquals(2, ShareIntake.expectedCount(Arrays.asList(NOTE, NOTE), "https://wa.me/1"));
        assertEquals(1, ShareIntake.expectedCount(Collections.emptyList(), "Lunch was great"));
    }

    @Test
    public void scriptPostsToShareTargetAndEscapesText() throws Exception {
        String evil = "it's \"fine\"\n</script><script>alert(1)</script> `${x}`";
        String js = ShareIntake.buildScript(Collections.singletonList(NOTE), evil);
        assertTrue(js.contains("fetch('/share-target', { method: 'POST', body: form })"));
        assertTrue(js.contains("form.append('audio'"));
        assertTrue(js.contains("#/host?shared=2"));
        // The text is a JSON string literal: quotes, newline and slashes are escaped, nothing breaks out.
        assertTrue(js.contains("\"it's \\\"fine\\\"\\n<\\/script><script>alert(1)<\\/script> `${x}`\""));
        assertTrue(js.contains("PTT-20261004-WA0001.opus"));
    }

    @Test
    public void textOnlyShareHasNoFiles() throws Exception {
        List<ShareIntake.Item> none = Collections.emptyList();
        String js = ShareIntake.buildScript(none, "Guide was great");
        assertTrue(js.contains("const files = [];"));
        assertTrue(js.contains("#/host?shared=1"));
    }
}

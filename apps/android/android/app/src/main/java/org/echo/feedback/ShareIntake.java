package org.echo.feedback;

import java.util.List;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Turns an Android share (WhatsApp voice note, forwarded text) into a script for the web app.
 *
 * The web app already receives shares through its service worker (Web Share Target, POST /share-target),
 * which puts them in the IndexedDB queue. Inside the APK there is no browser share sheet, so the native side
 * copies the shared files to the app cache and the script below rebuilds the same multipart form and posts it
 * to /share-target. The queue, the analysis and the "nothing is analysed on reception" rule stay in the web app.
 *
 * Pure Java (only org.json), unit-tested in ShareIntakeTest.
 */
public final class ShareIntake {

    /** One shared file, already copied to the app cache and served at {@code url} by the Capacitor local server. */
    public static final class Item {
        public final String url;
        public final String name;
        public final String mime;

        public Item(String url, String name, String mime) {
            this.url = url;
            this.name = name;
            this.mime = mime;
        }
    }

    private static final Pattern BARE_LINK = Pattern.compile("^https?://\\S+$");

    private ShareIntake() {}

    /** Same rule as the service worker: a lone link is not visitor feedback. */
    public static boolean isFeedbackText(String text) {
        if (text == null) return false;
        String t = text.trim();
        return !t.isEmpty() && !BARE_LINK.matcher(t).matches();
    }

    /** Number of queue entries the service worker will create (shown by the host page as "N received"). */
    public static int expectedCount(List<Item> items, String text) {
        return items.size() + (isFeedbackText(text) ? 1 : 0);
    }

    /**
     * Script run in the page once it is loaded. It waits for the service worker to control the page (first
     * launch), posts the form, tells the native side the cache copies can be deleted, then opens the host page.
     */
    public static String buildScript(List<Item> items, String text) throws JSONException {
        JSONArray files = new JSONArray();
        for (Item it : items) {
            JSONObject o = new JSONObject();
            o.put("url", it.url);
            o.put("name", it.name);
            o.put("mime", it.mime == null ? "" : it.mime);
            files.put(o);
        }
        String quotedText = JSONObject.quote(text == null ? "" : text);
        int count = expectedCount(items, text);
        return "(async () => {\n"
            + "  const files = " + files.toString() + ";\n"
            + "  const text = " + quotedText + ";\n"
            + "  const done = () => { try { window.Capacitor && window.Capacitor.nativePromise('EchoShare', 'consumed', {}); } catch (e) {} };\n"
            + "  try {\n"
            + "    if (!('serviceWorker' in navigator)) throw new Error('no service worker');\n"
            + "    await navigator.serviceWorker.ready;\n"
            + "    if (!navigator.serviceWorker.controller) {\n"
            + "      await new Promise((r) => { navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }); setTimeout(r, 10000); });\n"
            + "    }\n"
            + "    if (!navigator.serviceWorker.controller) throw new Error('service worker not controlling the page');\n"
            + "    const form = new FormData();\n"
            + "    for (const f of files) {\n"
            + "      const blob = await (await fetch(f.url)).blob();\n"
            + "      form.append('audio', new File([blob], f.name, { type: f.mime || blob.type }));\n"
            + "    }\n"
            + "    if (text) form.append('text', text);\n"
            + "    await fetch('/share-target', { method: 'POST', body: form });\n"
            + "    done();\n"
            + "    location.hash = '#/host?shared=" + count + "';\n"
            + "    location.reload();\n"
            + "  } catch (e) {\n"
            + "    done();\n"
            + "    console.error('[echo-share]', e);\n"
            + "    alert('Echo could not receive this share. Open Echo once with the phone online, then share again.');\n"
            + "  }\n"
            + "})();";
    }
}

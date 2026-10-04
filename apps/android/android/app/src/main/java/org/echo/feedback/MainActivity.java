package org.echo.feedback;

import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Log;
import android.widget.Toast;
import android.webkit.MimeTypeMap;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Capacitor shell around the Echo web app (apps/web build, models bundled in the APK assets).
 *
 * Native additions, nothing else:
 *  - receives ACTION_SEND / ACTION_SEND_MULTIPLE for audio/* and text/plain (WhatsApp, Share, Echo) and hands
 *    them to the web app's own share handler (see ShareIntake);
 *  - sms: links open the phone's SMS app prefilled (Capacitor's default for non-app URLs); a person presses Send.
 *    The app never sends an SMS itself and does not request SEND_SMS.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "EchoShare";
    private static final String SHARE_DIR = "share";
    /** Shared copies are transient: anything older than this is removed at start-up and when the app stops. */
    private static final long STALE_MS = 10 * 60 * 1000L;

    /** Renderer losses (low memory) tolerated in a row before giving up instead of looping. */
    private static final int MAX_RESTARTS = 2;
    private static final long RESTART_WINDOW_MS = 5 * 60 * 1000L;
    private static int rendererLosses;
    private static long lastRendererLossMs;

    private String pendingScript;
    private boolean pageLoaded;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EchoSharePlugin.class);
        super.onCreate(savedInstanceState);
        clearShareCache(this, STALE_MS);
        bridge.addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageLoaded(WebView webView) {
                    pageLoaded = true;
                    flush();
                }

                // Low-memory phones: the system may kill the WebView renderer while Whisper runs. Without this,
                // Android WebView kills the whole app. We restart the page instead and say why; the queue is in
                // IndexedDB, so nothing already received is lost.
                @Override
                public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                    Log.w(TAG, "WebView renderer gone (crash=" + detail.didCrash() + ")");
                    // The dead WebView must be destroyed, otherwise each restart leaks one (and its memory).
                    if (webView.getParent() instanceof android.view.ViewGroup) {
                        ((android.view.ViewGroup) webView.getParent()).removeView(webView);
                    }
                    webView.destroy();
                    if (isFinishing() || isDestroyed()) return true;
                    long now = System.currentTimeMillis();
                    if (now - lastRendererLossMs > RESTART_WINDOW_MS) rendererLosses = 0;
                    lastRendererLossMs = now;
                    rendererLosses++;
                    if (rendererLosses > MAX_RESTARTS) {
                        Toast.makeText(
                            MainActivity.this,
                            "This phone does not have enough free memory for Echo right now. Close other apps or restart the phone.",
                            Toast.LENGTH_LONG
                        ).show();
                        finish();
                        return true;
                    }
                    Toast.makeText(
                        MainActivity.this,
                        "Echo ran out of memory and restarted. Close other apps, then try again.",
                        Toast.LENGTH_LONG
                    ).show();
                    pageLoaded = false;
                    recreate();
                    return true;
                }
            }
        );
        handleShare(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShare(intent);
    }

    @Override
    public void onDestroy() {
        WebView wv = bridge == null ? null : bridge.getWebView();
        super.onDestroy();
        // Capacitor does not destroy its WebView: without this, every recreate() keeps one alive.
        if (wv != null) {
            try {
                if (wv.getParent() instanceof android.view.ViewGroup) ((android.view.ViewGroup) wv.getParent()).removeView(wv);
                wv.destroy();
            } catch (Exception e) {
                Log.w(TAG, "WebView already destroyed", e);
            }
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        clearShareCache(this, STALE_MS);
    }

    private void handleShare(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
        try {
            List<Uri> uris = new ArrayList<>();
            if (Intent.ACTION_SEND.equals(action)) {
                Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (u != null) uris.add(u);
            } else {
                ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (list != null) uris.addAll(list);
            }
            List<ShareIntake.Item> items = new ArrayList<>();
            for (Uri u : uris) {
                ShareIntake.Item it = copyToCache(u, intent.getType());
                if (it != null) items.add(it);
            }
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            String body = text == null ? "" : text.toString();
            if (items.isEmpty() && !ShareIntake.isFeedbackText(body)) return;
            pendingScript = ShareIntake.buildScript(items, body);
            // Consumed: a rotation or a relaunch must not enqueue the same share twice.
            intent.setAction(Intent.ACTION_MAIN);
            flush();
        } catch (Exception e) {
            Log.e(TAG, "share not received", e);
        }
    }

    private void flush() {
        if (pendingScript == null || !pageLoaded || bridge == null) return;
        String script = pendingScript;
        pendingScript = null;
        bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(script, null));
    }

    /** Copies a shared content:// file to cache/share/ and returns the URL the WebView can fetch it from. */
    private ShareIntake.Item copyToCache(Uri uri, String intentType) {
        String mime = getContentResolver().getType(uri);
        if (mime == null) mime = intentType;
        if (mime != null && !mime.startsWith("audio/") && !mime.equals("application/ogg")) {
            Log.w(TAG, "ignored non-audio share: " + mime);
            return null;
        }
        String name = displayName(uri);
        String ext = mime == null ? null : MimeTypeMap.getSingleton().getExtensionFromMimeType(mime.split(";")[0]);
        if (name == null || name.isEmpty()) name = "voice-note" + (ext == null ? "" : "." + ext);
        File dir = new File(getCacheDir(), SHARE_DIR);
        if (!dir.exists() && !dir.mkdirs()) return null;
        File out = new File(dir, UUID.randomUUID().toString());
        try (InputStream in = getContentResolver().openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
            if (in == null) return null;
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
        } catch (Exception e) {
            Log.e(TAG, "copy failed", e);
            out.delete();
            return null;
        }
        String url = bridge.getLocalUrl() + "/_capacitor_file_" + out.getAbsolutePath();
        return new ShareIntake.Item(url, name, mime);
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception e) {
            Log.w(TAG, "no display name", e);
        }
        return null;
    }

    /** Deletes shared copies older than {@code olderThanMs} (0 = all). Audio is not kept outside the queue. */
    static void clearShareCache(Context ctx, long olderThanMs) {
        File dir = new File(ctx.getCacheDir(), SHARE_DIR);
        File[] files = dir.listFiles();
        if (files == null) return;
        long now = System.currentTimeMillis();
        for (File f : files) {
            if (olderThanMs == 0 || now - f.lastModified() > olderThanMs) f.delete();
        }
    }
}

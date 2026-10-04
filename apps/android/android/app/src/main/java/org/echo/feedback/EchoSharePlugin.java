package org.echo.feedback;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Called by the share script once the files are in the web app's queue: the cache copies are deleted. */
@CapacitorPlugin(name = "EchoShare")
public class EchoSharePlugin extends Plugin {

    @PluginMethod
    public void consumed(PluginCall call) {
        MainActivity.clearShareCache(getContext(), 0);
        call.resolve();
    }
}

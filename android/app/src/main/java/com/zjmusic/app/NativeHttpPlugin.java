package com.zjmusic.app;

import android.text.TextUtils;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * Raw HTTP plugin that ALWAYS returns the exact response bytes (base64), bypassing
 * Capacitor's built-in response handling. The stock CapacitorHttp tries to JSON.parse
 * any response whose Content-Type is application/json (ignoring responseType), which
 * rejects legitimate binary / non-JSON bodies (kuwo wbd API, netease eapi encrypted
 * payloads, etc.). This plugin keeps byte-for-byte fidelity for every content type.
 */
@CapacitorPlugin(name = "NativeHttp")
public class NativeHttpPlugin extends Plugin {

    @PluginMethod
    public void request(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        final String method = call.getString("method", "GET").toUpperCase();
        final JSObject headersObj = call.getObject("headers");
        final String body = call.getString("body");
        final Integer timeoutMs = call.getInt("timeoutMs", 20000);

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setRequestMethod(method);
                conn.setConnectTimeout(timeoutMs);
                conn.setReadTimeout(timeoutMs);
                conn.setInstanceFollowRedirects(true);

                if (headersObj != null) {
                    Iterator<String> keys = headersObj.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        conn.setRequestProperty(key, headersObj.getString(key));
                    }
                }

                if (body != null && !body.isEmpty() && !"GET".equals(method) && !"HEAD".equals(method)) {
                    conn.setDoOutput(true);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(body.getBytes("UTF-8"));
                    }
                }

                int status = conn.getResponseCode();
                InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                if (stream != null) {
                    byte[] chunk = new byte[16384];
                    int n;
                    while ((n = stream.read(chunk)) != -1) {
                        buffer.write(chunk, 0, n);
                    }
                    stream.close();
                }

                JSObject headers = new JSObject();
                Map<String, List<String>> headerFields = conn.getHeaderFields();
                for (Map.Entry<String, List<String>> entry : headerFields.entrySet()) {
                    String key = entry.getKey();
                    if (key == null) continue;
                    headers.put(key, TextUtils.join(", ", entry.getValue()));
                }

                JSObject result = new JSObject();
                result.put("status", status);
                result.put("headers", headers);
                result.put("data", Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP));
                call.resolve(result);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }
}

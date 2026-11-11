package com.docuall.app;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Receives files from "Open with" (ACTION_VIEW) and Share (ACTION_SEND / SEND_MULTIPLE).
 * Uses only the temporary read grant Android attaches to the content:// URI and copies
 * each file into the app cache, so no storage permission is needed.
 */
@CapacitorPlugin(name = "DocuIntake")
public class DocuIntakePlugin extends Plugin {
    static final long MAX_BYTES = 25L * 1024 * 1024;
    private final List<JSObject> pending = new ArrayList<>();

    @Override
    public void load() {
        Intent intent = getActivity().getIntent();
        if (intent != null) ingest(intent);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        ingest(intent);
    }

    static List<Uri> urisFrom(Intent intent) {
        List<Uri> uris = new ArrayList<>();
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) {
            if (intent.getData() != null) uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) for (Uri u : list) if (u != null) uris.add(u);
        } else {
            return uris;
        }
        if (uris.isEmpty() && intent.getClipData() != null) {
            ClipData clip = intent.getClipData();
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri u = clip.getItemAt(i).getUri();
                if (u != null) uris.add(u);
            }
        }
        return uris;
    }

    private void ingest(Intent intent) {
        final List<Uri> uris = urisFrom(intent);
        if (uris.isEmpty()) return;
        // Consume so a rotation/reload doesn't import the same file twice.
        intent.setAction(Intent.ACTION_MAIN);
        new Thread(() -> {
            List<JSObject> copied = new ArrayList<>();
            for (Uri uri : uris) copied.add(copy(uri));
            synchronized (pending) { pending.addAll(copied); }
            notifyListeners("incoming", new JSObject(), true);
        }).start();
    }

    private JSObject copy(Uri uri) {
        JSObject out = new JSObject();
        ContentResolver cr = getContext().getContentResolver();
        String name = null;
        long size = -1;
        try {
            out.put("mimeType", cr.getType(uri));
            if ("content".equals(uri.getScheme())) {
                try (Cursor c = cr.query(uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
                    if (c != null && c.moveToFirst()) {
                        int ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                        int si = c.getColumnIndex(OpenableColumns.SIZE);
                        if (ni >= 0 && !c.isNull(ni)) name = c.getString(ni);
                        if (si >= 0 && !c.isNull(si)) size = c.getLong(si);
                    }
                }
            } else {
                // Only content:// is accepted; file:// from other apps is refused.
                out.put("error", "unsupported_scheme");
                return out;
            }
            if (name != null) out.put("name", name);
            if (size > MAX_BYTES) {
                out.put("size", size);
                out.put("error", "too_large");
                return out;
            }
            File dir = new File(getContext().getCacheDir(), "incoming");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("no cache dir");
            String fname = UUID.randomUUID().toString() + ".bin";
            File dest = new File(dir, fname);
            long total = 0;
            try (InputStream in = cr.openInputStream(uri); OutputStream os = new FileOutputStream(dest)) {
                if (in == null) throw new Exception("no stream");
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > MAX_BYTES) {
                        os.close();
                        dest.delete();
                        out.put("size", total);
                        out.put("error", "too_large");
                        return out;
                    }
                    os.write(buf, 0, n);
                }
            }
            out.put("size", total);
            out.put("path", "incoming/" + fname);
        } catch (Exception e) {
            out.put("error", "unreadable");
        }
        return out;
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSArray arr = new JSArray();
        synchronized (pending) { for (JSObject o : pending) arr.put(o); }
        JSObject ret = new JSObject();
        ret.put("files", arr);
        call.resolve(ret);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        synchronized (pending) { pending.clear(); }
        File dir = new File(getContext().getCacheDir(), "incoming");
        File[] files = dir.listFiles();
        if (files != null) for (File f : files) f.delete();
        call.resolve();
    }
}

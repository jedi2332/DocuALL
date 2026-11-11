package com.docuall.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;
import androidx.activity.result.ActivityResult;
import androidx.appcompat.app.AppCompatActivity;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONException;

/** Shares only the media selected in this plugin's Android picker. */
@CapacitorPlugin(name = "DocuCapCut")
public final class DocuCapCutPlugin extends Plugin {
    static final String CAPCUT_PACKAGE = "com.lemon.lvoverseas";
    private static final int MAX_FILES = 20;
    private static final long MAX_BATCH_BYTES = 2L * 1024 * 1024 * 1024;
    private static final int MAX_PENDING_RECEIPTS = 50;
    private static final long PICK_VALID_MS = 15 * 60 * 1000L;
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean();
    private volatile Selection selection;

    private static final class Selection {
        final String id = UUID.randomUUID().toString();
        final long expiresAt = android.os.SystemClock.elapsedRealtime() + PICK_VALID_MS;
        final String ownerId;
        final String vaultId;
        final ArrayList<Uri> uris;
        final ArrayList<String> types;
        final JSArray files;

        Selection(String ownerId, String vaultId, ArrayList<Uri> uris, ArrayList<String> types, JSArray files) {
            this.ownerId = ownerId;
            this.vaultId = vaultId;
            this.uris = uris;
            this.types = types;
            this.files = files;
        }
    }

    @PluginMethod
    public void pickMedia(PluginCall call) {
        String ownerId = call.getString("ownerId");
        String vaultId = call.getString("vaultId");
        if (!isUuid(ownerId) || !isUuid(vaultId)) {
            call.reject("Open a Vault before picking media.", "INVALID_VAULT");
            return;
        }
        if (!busy.compareAndSet(false, true)) {
            call.reject("Finish the current selection first.", "BUSY");
            return;
        }

        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "image/*", "video/*", "audio/*" })
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        getBridge().executeOnMainThread(() -> {
            try {
                selection = null;
                startActivityForResult(call, picker, "onPicked");
            } catch (RuntimeException e) {
                fail(call, "Android could not open its file picker.", "PICKER_UNAVAILABLE");
            }
        });
    }

    @ActivityCallback
    private void onPicked(PluginCall call, ActivityResult result) {
        if (call == null) {
            busy.set(false);
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            busy.set(false);
            call.resolve(new JSObject().put("status", "cancelled"));
            return;
        }
        worker.execute(() -> {
            try {
                Selection picked = readSelection(call, result.getData());
                selection = picked;
                busy.set(false);
                call.resolve(new JSObject()
                    .put("status", "ready").put("selectionId", picked.id).put("files", picked.files));
            } catch (IOException | NoSuchAlgorithmException | RuntimeException e) {
                String reason = e instanceof IOException ? e.getMessage() : null;
                // Provider errors can contain private device paths. Use only messages we set.
                String message = "Could not read the selected media. Pick locally available files and try again.";
                if ("selection_limit".equals(reason)) message = "Select between 1 and 20 media files.";
                if ("byte_limit".equals(reason)) message = "This selection is over 2 GB. Choose a smaller batch.";
                if ("invalid_media".equals(reason)) message = "Select supported photos, video clips, or audio.";
                fail(call, message, "MEDIA_UNREADABLE");
            }
        });
    }

    private Selection readSelection(PluginCall call, Intent data) throws IOException, NoSuchAlgorithmException {
        Set<Uri> picked = new LinkedHashSet<>();
        ClipData clip = data.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) picked.add(clip.getItemAt(i).getUri());
        }
        if (data.getData() != null) picked.add(data.getData());
        if (picked.isEmpty() || picked.size() > MAX_FILES) throw new IOException("selection_limit");

        ContentResolver resolver = getContext().getContentResolver();
        ArrayList<String> types = new ArrayList<>();
        JSArray files = new JSArray();
        byte[] buffer = new byte[64 * 1024];
        long total = 0;
        for (Uri uri : picked) {
            if (uri == null || !"content".equals(uri.getScheme())) throw new IOException("invalid_media");
            String name = "";
            long reportedSize = -1;
            try (Cursor row = resolver.query(uri,
                    new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
                if (row != null && row.moveToFirst()) {
                    int nameColumn = row.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    int sizeColumn = row.getColumnIndex(OpenableColumns.SIZE);
                    if (nameColumn >= 0 && !row.isNull(nameColumn)) name = row.getString(nameColumn);
                    if (sizeColumn >= 0 && !row.isNull(sizeColumn)) reportedSize = row.getLong(sizeColumn);
                }
            }
            name = cleanName(name);
            String type = mediaType(resolver.getType(uri), name);
            if (type == null) throw new IOException("invalid_media");
            if (reportedSize > MAX_BATCH_BYTES - total) throw new IOException("byte_limit");

            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long size = 0;
            try (InputStream input = resolver.openInputStream(uri)) {
                if (input == null) throw new IOException("no_stream");
                int count;
                while ((count = input.read(buffer)) != -1) {
                    size += count;
                    if (size > MAX_BATCH_BYTES - total) throw new IOException("byte_limit");
                    digest.update(buffer, 0, count);
                }
            }
            if (size == 0) throw new IOException("invalid_media");
            total += size;
            types.add(type);
            files.put(new JSObject()
                .put("name", name).put("size", size).put("type", type).put("hash", toHex(digest.digest())));
        }
        return new Selection(call.getString("ownerId"), call.getString("vaultId"),
            new ArrayList<>(picked), types, files);
    }

    @PluginMethod
    public void discardSelection(PluginCall call) {
        Selection picked = selection;
        if (!busy.get() && picked != null && picked.id.equals(call.getString("selectionId"))) selection = null;
        call.resolve();
    }

    @PluginMethod
    public void sendToCapCut(PluginCall call) {
        if (!busy.compareAndSet(false, true)) {
            call.reject("Finish the current selection first.", "BUSY");
            return;
        }
        Selection picked = selection;
        if (picked == null || !picked.id.equals(call.getString("selectionId"))
                || !picked.ownerId.equals(call.getString("ownerId"))
                || !picked.vaultId.equals(call.getString("vaultId"))
                || picked.expiresAt < android.os.SystemClock.elapsedRealtime()) {
            fail(call, "This selection expired. Pick the files again.", "SELECTION_EXPIRED");
            return;
        }
        int pending = 0;
        for (String key : pendingReceipts().getAll().keySet()) {
            if (key.startsWith(picked.ownerId + ".")) pending++;
        }
        if (pending >= MAX_PENDING_RECEIPTS) {
            fail(call, "Reconnect to save pending Vault tags before sharing more files.", "SYNC_REQUIRED");
            return;
        }

        getBridge().executeOnMainThread(() -> launchCapCut(call, picked));
    }

    private void launchCapCut(PluginCall call, Selection picked) {
        AppCompatActivity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()
                || !activity.getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)
                || !activity.hasWindowFocus()) {
            fail(call, "Reopen DocuALL and pick the files again.", "NO_ACTIVITY");
            return;
        }
        try {
            Intent send = createSendIntent(picked.uris, picked.types);
            if (activity.getPackageManager().resolveActivity(send, PackageManager.MATCH_DEFAULT_ONLY) == null) {
                fail(call, "CapCut cannot receive this selection. Try one photo or video, or one media type at a time.",
                    "CAPCUT_UNAVAILABLE");
                return;
            }
            activity.startActivity(send);
        } catch (ActivityNotFoundException e) {
            fail(call, "CapCut could not open this selection.", "CAPCUT_UNAVAILABLE");
            return;
        } catch (SecurityException e) {
            fail(call, "Android could not give CapCut access. Pick the original files again.", "URI_ACCESS_LOST");
            return;
        }

        // The OS accepted the handoff. CapCut does not report a timeline import here.
        selection = null;
        JSObject receipt = new JSObject()
            .put("id", picked.id).put("ownerId", picked.ownerId).put("vaultId", picked.vaultId)
            .put("sharedAtMs", System.currentTimeMillis()).put("files", picked.files);
        worker.execute(() -> {
            boolean queued;
            try {
                queued = pendingReceipts().edit().putString(
                    receiptKey(picked.ownerId, picked.id), receipt.toString()).commit();
            } catch (RuntimeException e) {
                queued = false;
            }
            busy.set(false);
            call.resolve(new JSObject().put("receipt", receipt).put("queued", queued));
        });
    }

    static Intent createSendIntent(ArrayList<Uri> uris, ArrayList<String> types) {
        if (uris.isEmpty() || uris.size() != types.size()) throw new IllegalArgumentException("Invalid media batch");
        boolean multiple = uris.size() > 1;
        String firstType = types.get(0);
        String firstFamily = firstType.substring(0, firstType.indexOf('/'));
        String combined = firstType;
        Set<String> distinct = new LinkedHashSet<>(types);
        for (String type : distinct) {
            if (!type.startsWith(firstFamily + "/")) {
                combined = "*/*";
                break;
            }
            if (!type.equals(firstType)) combined = firstFamily + "/*";
        }
        Intent send = new Intent(multiple ? Intent.ACTION_SEND_MULTIPLE : Intent.ACTION_SEND)
            .setPackage(CAPCUT_PACKAGE)
            .setType(combined)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        if (multiple) send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
        else send.putExtra(Intent.EXTRA_STREAM, uris.get(0));

        ClipData clip = new ClipData("DocuALL media", distinct.toArray(new String[0]),
            new ClipData.Item(uris.get(0)));
        for (int i = 1; i < uris.size(); i++) clip.addItem(new ClipData.Item(uris.get(i)));
        send.setClipData(clip);
        return send;
    }

    @PluginMethod
    public void listPendingReceipts(PluginCall call) {
        String ownerId = call.getString("ownerId");
        if (!isUuid(ownerId)) {
            call.reject("Open your Vaults first.", "INVALID_OWNER");
            return;
        }
        JSArray receipts = new JSArray();
        for (Map.Entry<String, ?> entry : pendingReceipts().getAll().entrySet()) {
            if (!entry.getKey().startsWith(ownerId + ".") || !(entry.getValue() instanceof String)) continue;
            try {
                receipts.put(new JSObject((String) entry.getValue()));
            } catch (JSONException ignored) {
                // A corrupt receipt must never create a Vault tag.
            }
        }
        call.resolve(new JSObject().put("receipts", receipts));
    }

    @PluginMethod
    public void acknowledgeReceipt(PluginCall call) {
        String ownerId = call.getString("ownerId");
        String id = call.getString("id");
        if (!isUuid(ownerId) || !isUuid(id)) {
            call.reject("Invalid Vault receipt.", "INVALID_RECEIPT");
            return;
        }
        if (pendingReceipts().edit().remove(receiptKey(ownerId, id)).commit()) call.resolve();
        else call.reject("The device could not update its Vault queue.", "QUEUE_UNAVAILABLE");
    }

    private SharedPreferences pendingReceipts() {
        return getContext().getSharedPreferences("docuall_capcut_pending", Context.MODE_PRIVATE);
    }

    private static String receiptKey(String ownerId, String id) {
        return ownerId + "." + id;
    }

    private void fail(PluginCall call, String message, String code) {
        busy.set(false);
        call.reject(message, code);
    }

    private static boolean isUuid(String value) {
        if (value == null) return false;
        try {
            return UUID.fromString(value).toString().equalsIgnoreCase(value);
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private static String cleanName(String value) {
        if (value == null) return "media";
        String name = value.replace('/', '_').replace('\\', '_').replaceAll("\\p{Cntrl}", "_").trim();
        if (name.isEmpty() || name.equals(".") || name.equals("..")) return "media";
        if (name.codePointCount(0, name.length()) <= 240) return name;
        return name.substring(0, name.offsetByCodePoints(0, 240));
    }

    private static String mediaType(String value, String name) {
        String type = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        if (type.isEmpty() || type.equals("application/octet-stream")) {
            int dot = name.lastIndexOf('.');
            if (dot >= 0) type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(
                name.substring(dot + 1).toLowerCase(Locale.ROOT));
        }
        return type != null && type.matches("(image|video|audio)/[a-z0-9][a-z0-9.+_-]{0,79}") ? type : null;
    }

    private static String toHex(byte[] bytes) {
        char[] out = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            out[i * 2] = HEX[(bytes[i] & 0xff) >>> 4];
            out[i * 2 + 1] = HEX[bytes[i] & 0x0f];
        }
        return new String(out);
    }

    @Override
    protected void handleOnDestroy() {
        worker.shutdown();
        super.handleOnDestroy();
    }
}

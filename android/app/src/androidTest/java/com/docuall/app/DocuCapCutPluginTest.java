package com.docuall.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Intent;
import android.net.Uri;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class DocuCapCutPluginTest {
    @Test
    public void singleMediaGetsReadOnlyGrantAndExactType() {
        Uri clip = Uri.parse("content://media/external/video/media/21");
        Intent send = DocuCapCutPlugin.createSendIntent(
            new ArrayList<>(Collections.singletonList(clip)),
            new ArrayList<>(Collections.singletonList("video/mp4")));
        assertEquals(Intent.ACTION_SEND, send.getAction());
        assertEquals(DocuCapCutPlugin.CAPCUT_PACKAGE, send.getPackage());
        assertEquals("video/mp4", send.getType());
        assertEquals(clip, send.getParcelableExtra(Intent.EXTRA_STREAM));
        assertEquals(clip, send.getClipData().getItemAt(0).getUri());
        assertEquals(0, send.getFlags() & Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        assertTrue((send.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0);
    }

    @Test
    public void mixedBatchIncludesEveryUriInOrder() {
        Uri clip = Uri.parse("content://media/external/video/media/21");
        Uri photo = Uri.parse("content://media/external/images/media/22");
        ArrayList<Uri> uris = new ArrayList<>(Arrays.asList(clip, photo));
        Intent send = DocuCapCutPlugin.createSendIntent(
            uris, new ArrayList<>(Arrays.asList("video/mp4", "image/jpeg")));
        assertEquals(Intent.ACTION_SEND_MULTIPLE, send.getAction());
        assertEquals("*/*", send.getType());
        assertEquals(uris, send.getParcelableArrayListExtra(Intent.EXTRA_STREAM));
        assertEquals(2, send.getClipData().getItemCount());
        assertEquals(clip, send.getClipData().getItemAt(0).getUri());
        assertEquals(photo, send.getClipData().getItemAt(1).getUri());
    }
}

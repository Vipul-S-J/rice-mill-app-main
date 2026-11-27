package com.vipulsj.ricemill;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

/**
 * Lets the user choose where a file is saved (system "Save as" dialog, Storage Access Framework).
 * JS: FileSave.saveFile({ filename, mimeType, data(base64) }) -> { uri }. Rejects with "cancelled" if the user backs out.
 */
@CapacitorPlugin(name = "FileSave")
public class FileSavePlugin extends Plugin {

    @PluginMethod
    public void saveFile(PluginCall call) {
        String data = call.getString("data");
        if (data == null || data.isEmpty()) {
            call.reject("No data to save");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mimeType", "application/octet-stream"));
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("filename", "file"));
        startActivityForResult(call, intent, "onSaveResult");
    }

    @ActivityCallback
    private void onSaveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri uri = result.getData().getData();
        try (OutputStream os = getContext().getContentResolver().openOutputStream(uri, "w")) {
            if (os == null) {
                call.reject("Could not open the chosen location");
                return;
            }
            os.write(Base64.decode(call.getString("data"), Base64.DEFAULT));
            os.flush();
        } catch (Exception e) {
            call.reject("Save failed: " + e.getMessage());
            return;
        }
        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        call.resolve(ret);
    }
}

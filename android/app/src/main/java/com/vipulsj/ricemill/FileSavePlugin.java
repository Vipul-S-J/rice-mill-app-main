package com.vipulsj.ricemill;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

/**
 * File access for backups and PDFs through Android's Storage Access Framework (no storage permission needed):
 *  - saveFile:      "Save as" dialog, the user chooses where one file goes
 *  - pickFolder:    the user chooses a folder once; access is remembered
 *  - writeToFolder / listFolder / deleteInFolder / openFolder: work inside that chosen folder
 */
@CapacitorPlugin(name = "FileSave")
public class FileSavePlugin extends Plugin {

    // ---------- single file: "Save as" ----------
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

    // ---------- folder for backups ----------
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "onFolderResult");
    }

    @ActivityCallback
    private void onFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri tree = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception e) {
            call.reject("Could not keep access to the folder: " + e.getMessage());
            return;
        }
        String docId = DocumentsContract.getTreeDocumentId(tree);
        String name = docId;
        int i = docId.lastIndexOf(':');
        if (i >= 0 && i < docId.length() - 1) name = docId.substring(i + 1);
        else if (i >= 0) name = "Storage root";
        JSObject ret = new JSObject();
        ret.put("uri", tree.toString());
        ret.put("name", name);
        call.resolve(ret);
    }

    private Uri folderUri(Uri tree) {
        return DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
    }

    @PluginMethod
    public void writeToFolder(PluginCall call) {
        String treeStr = call.getString("treeUri");
        String data = call.getString("data");
        if (treeStr == null || data == null) {
            call.reject("Missing folder or data");
            return;
        }
        try {
            Uri tree = Uri.parse(treeStr);
            ContentResolver cr = getContext().getContentResolver();
            // a new document is created; Android adds "(1)" if a file with the same name exists, so nothing is overwritten
            Uri doc = DocumentsContract.createDocument(cr, folderUri(tree),
                    call.getString("mimeType", "application/octet-stream"), call.getString("filename", "backup"));
            if (doc == null) {
                call.reject("Could not create the file in the chosen folder");
                return;
            }
            try (OutputStream os = cr.openOutputStream(doc, "w")) {
                if (os == null) {
                    call.reject("Could not open the new file");
                    return;
                }
                os.write(Base64.decode(data, Base64.DEFAULT));
                os.flush();
            }
            JSObject ret = new JSObject();
            ret.put("uri", doc.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Folder write failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void listFolder(PluginCall call) {
        String treeStr = call.getString("treeUri");
        if (treeStr == null) {
            call.reject("Missing folder");
            return;
        }
        try {
            Uri tree = Uri.parse(treeStr);
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            JSArray files = new JSArray();
            try (Cursor c = getContext().getContentResolver().query(children, new String[]{
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED}, null, null, null)) {
                while (c != null && c.moveToNext()) {
                    JSObject f = new JSObject();
                    f.put("name", c.getString(0));
                    f.put("size", c.getLong(1));
                    f.put("modified", c.getLong(2));
                    files.put(f);
                }
            }
            JSObject ret = new JSObject();
            ret.put("files", files);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not read the folder: " + e.getMessage());
        }
    }

    @PluginMethod
    public void deleteInFolder(PluginCall call) {
        String treeStr = call.getString("treeUri");
        String filename = call.getString("filename");
        if (treeStr == null || filename == null) {
            call.reject("Missing folder or file name");
            return;
        }
        try {
            Uri tree = Uri.parse(treeStr);
            ContentResolver cr = getContext().getContentResolver();
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            String docId = null;
            try (Cursor c = cr.query(children, new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                while (c != null && c.moveToNext()) {
                    if (filename.equals(c.getString(1))) {
                        docId = c.getString(0);
                        break;
                    }
                }
            }
            if (docId == null) {
                call.resolve();
                return;
            }
            DocumentsContract.deleteDocument(cr, DocumentsContract.buildDocumentUriUsingTree(tree, docId));
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not delete the old backup: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openFolder(PluginCall call) {
        String treeStr = call.getString("treeUri");
        if (treeStr == null) {
            call.reject("Missing folder");
            return;
        }
        try {
            Uri tree = Uri.parse(treeStr);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(folderUri(tree), DocumentsContract.Document.MIME_TYPE_DIR);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("This phone could not open the folder: " + e.getMessage());
        }
    }
}

package cn.cocloud.workbench;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.UUID;

/** Private temporary JPEGs; only the launched camera receives a URI grant. */
public final class CameraProvider extends ContentProvider {
    private static final String AUTHORITY = "cn.cocloud.workbench.camera";
    @Override public boolean onCreate() { return true; }
    static File file(Context context, Uri uri) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (!"content".equals(uri.getScheme()) || !AUTHORITY.equals(uri.getAuthority())
                || !CameraPolicy.validName(name) || !("/" + name).equals(uri.getPath())
                || uri.getQuery() != null || uri.getFragment() != null) throw new FileNotFoundException();
        return new File(new File(context.getCacheDir(), "camera"), name);
    }
    static Uri create(Context context) throws IOException {
        Uri uri = Uri.parse("content://" + AUTHORITY + "/photo-" + UUID.randomUUID() + ".jpg");
        File file = file(context, uri);
        if ((!file.getParentFile().isDirectory() && !file.getParentFile().mkdirs()) || !file.createNewFile())
            throw new IOException("Cannot create camera output");
        return uri;
    }
    static boolean hasPhoto(Context context, Uri uri) {
        try { return file(context, uri).length() > 0; } catch (IOException ex) { return false; }
    }
    static void remove(Context context, Uri uri) {
        try { file(context, uri).delete(); } catch (IOException ignored) { }
    }
    static void prune(Context context) {
        File[] files = new File(context.getCacheDir(), "camera").listFiles();
        if (files != null) for (File file : files)
            if (file.lastModified() < System.currentTimeMillis() - 86400000L) file.delete();
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode) && !"w".equals(mode) && !"rw".equals(mode) && !"rwt".equals(mode))
            throw new FileNotFoundException();
        return ParcelFileDescriptor.open(file(getContext(), uri), ParcelFileDescriptor.parseMode(mode));
    }
    @Override public String getType(Uri uri) { return "image/jpeg"; }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) {
        try {
            File photo = file(getContext(), uri);
            String[] columns = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
            MatrixCursor cursor = new MatrixCursor(columns);
            Object[] row = new Object[columns.length];
            for (int i = 0; i < columns.length; i++) row[i] = OpenableColumns.DISPLAY_NAME.equals(columns[i])
                ? photo.getName() : OpenableColumns.SIZE.equals(columns[i]) ? photo.length() : null;
            cursor.addRow(row); return cursor;
        } catch (IOException ex) { return null; }
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String where, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String where, String[] args) { throw new UnsupportedOperationException(); }
}

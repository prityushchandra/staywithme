package in.co.staywithme.app;

import android.app.DownloadManager;
import android.content.Context;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.SystemClock;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    /** Let the retro intro finish even when the site loads instantly. */
    private static final long MIN_SPLASH_MS = 2600;

    /** Never strand the user on the splash if the network stalls. */
    private static final long MAX_SPLASH_MS = 9000;

    private WebView splashOverlay;
    private long splashShownAt;
    private boolean splashDismissing;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        enableWebViewHistoryBack();
        enableFileDownloads();
        showRetroSplash();
    }

    /** Without this the hardware back button quits the app instead of navigating the site. */
    private void enableWebViewHistoryBack() {
        final WebView webView = getBridge().getWebView();
        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        if (webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            setEnabled(false);
                            getOnBackPressedDispatcher().onBackPressed();
                        }
                    }
                }
            );
    }

    /** WebViews drop Content-Disposition attachments, so hand receipt PDFs to DownloadManager. */
    private void enableFileDownloads() {
        getBridge()
            .getWebView()
            .setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
                try {
                    String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                    request.addRequestHeader("User-Agent", userAgent);

                    // The receipt route is session-gated, so replay the WebView's cookies.
                    String cookie = CookieManager.getInstance().getCookie(url);
                    if (cookie != null) {
                        request.addRequestHeader("Cookie", cookie);
                    }

                    request.setMimeType(mimeType);
                    request.setTitle(fileName);
                    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

                    DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (manager != null) {
                        manager.enqueue(request);
                        Toast.makeText(this, "Downloading " + fileName, Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception e) {
                    Toast.makeText(this, "Download failed", Toast.LENGTH_SHORT).show();
                }
            });
    }

    /**
     * The app shell loads staywithme.co.in over the network, so the first paint can lag.
     * A local animated splash covers that gap instead of showing a blank WebView.
     */
    private void showRetroSplash() {
        splashOverlay = new WebView(this);
        splashOverlay.setBackgroundColor(Color.parseColor("#140F0D"));
        splashOverlay.getSettings().setJavaScriptEnabled(true);
        splashOverlay.loadUrl("file:///android_asset/public/splash.html");

        addContentView(
            splashOverlay,
            new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        splashShownAt = SystemClock.uptimeMillis();

        getBridge()
            .addWebViewListener(
                new WebViewListener() {
                    @Override
                    public void onPageLoaded(WebView webView) {
                        dismissRetroSplash();
                    }
                }
            );

        splashOverlay.postDelayed(this::dismissRetroSplash, MAX_SPLASH_MS);
    }

    private void dismissRetroSplash() {
        if (splashOverlay == null || splashDismissing) return;

        long remaining = MIN_SPLASH_MS - (SystemClock.uptimeMillis() - splashShownAt);
        if (remaining > 0) {
            splashDismissing = true;
            splashOverlay.postDelayed(
                () -> {
                    splashDismissing = false;
                    dismissRetroSplash();
                },
                remaining
            );
            return;
        }

        final WebView overlay = splashOverlay;
        splashOverlay = null;
        overlay
            .animate()
            .alpha(0f)
            .setDuration(420)
            .withEndAction(() -> {
                ViewGroup parent = (ViewGroup) overlay.getParent();
                if (parent != null) parent.removeView(overlay);
                overlay.destroy();
            })
            .start();
    }
}

    /** Without this the hardware back button quits the app instead of navigating the site. */
    private void enableWebViewHistoryBack() {
        final WebView webView = getBridge().getWebView();
        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        if (webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            setEnabled(false);
                            getOnBackPressedDispatcher().onBackPressed();
                        }
                    }
                }
            );
    }

    /** WebViews drop Content-Disposition attachments, so hand receipt PDFs to DownloadManager. */
    private void enableFileDownloads() {
        getBridge()
            .getWebView()
            .setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
                try {
                    String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                    request.addRequestHeader("User-Agent", userAgent);

                    // The receipt route is session-gated, so replay the WebView's cookies.
                    String cookie = CookieManager.getInstance().getCookie(url);
                    if (cookie != null) {
                        request.addRequestHeader("Cookie", cookie);
                    }

                    request.setMimeType(mimeType);
                    request.setTitle(fileName);
                    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

                    DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (manager != null) {
                        manager.enqueue(request);
                        Toast.makeText(this, "Downloading " + fileName, Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception e) {
                    Toast.makeText(this, "Download failed", Toast.LENGTH_SHORT).show();
                }
            });
    }
}

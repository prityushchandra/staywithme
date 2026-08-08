import UIKit
import WebKit
import Capacitor

/**
 The shell loads staywithme.co.in over the network, so this subclass adds the
 pieces a remote-hosted Capacitor app doesn't get for free: an animated splash
 covering the first paint, edge-swipe navigation, and receipt/CSV downloads.
 */
class MainViewController: CAPBridgeViewController {

    /// Let the retro intro finish even when the site loads instantly.
    private let minimumSplashDuration: TimeInterval = 2.6

    /// Never strand the user on the splash if the network stalls.
    private let maximumSplashDuration: TimeInterval = 9.0

    private var splashOverlay: WKWebView?
    private var splashShownAt = Date()
    private var progressObservation: NSKeyValueObservation?
    private var pendingMinimumWait = false

    /// `navigationDelegate` is weak, so the proxy has to be retained here.
    private var downloadDelegate: DownloadingNavigationDelegate?

    override func viewDidLoad() {
        super.viewDidLoad()

        // WKWebView ships this off by default; without it there's no way back.
        webView?.allowsBackForwardNavigationGestures = true

        enableDownloads()
        installSplashOverlay()
    }

    // MARK: - Downloads

    private func enableDownloads() {
        guard let webView, let capacitorDelegate = webView.navigationDelegate else { return }

        let proxy = DownloadingNavigationDelegate(wrapping: capacitorDelegate, presenter: self)
        downloadDelegate = proxy
        webView.navigationDelegate = proxy
    }

    // MARK: - Splash

    private func installSplashOverlay() {
        guard let splashURL = Bundle.main.url(
            forResource: "splash", withExtension: "html", subdirectory: "public"
        ) else { return }

        let overlay = WKWebView(frame: view.bounds)
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlay.isUserInteractionEnabled = false
        overlay.scrollView.isScrollEnabled = false
        overlay.backgroundColor = UIColor(red: 0.078, green: 0.059, blue: 0.051, alpha: 1)
        overlay.isOpaque = true
        overlay.loadFileURL(splashURL, allowingReadAccessTo: splashURL.deletingLastPathComponent())

        view.addSubview(overlay)
        splashOverlay = overlay
        splashShownAt = Date()
        // Light text reads over the dark splash; the site itself is cream.
        setStatusBarStyle(.lightContent)

        // Capacitor owns the navigation delegate, so watch load progress instead.
        progressObservation = webView?.observe(\.estimatedProgress, options: [.new]) { [weak self] _, change in
            guard let progress = change.newValue, progress >= 1.0 else { return }
            DispatchQueue.main.async { self?.dismissSplashOverlay() }
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + maximumSplashDuration) { [weak self] in
            self?.dismissSplashOverlay()
        }
    }

    private func dismissSplashOverlay() {
        guard let overlay = splashOverlay else { return }

        let elapsed = Date().timeIntervalSince(splashShownAt)
        if elapsed < minimumSplashDuration {
            guard !pendingMinimumWait else { return }
            pendingMinimumWait = true
            DispatchQueue.main.asyncAfter(deadline: .now() + (minimumSplashDuration - elapsed)) { [weak self] in
                self?.pendingMinimumWait = false
                self?.dismissSplashOverlay()
            }
            return
        }

        splashOverlay = nil
        progressObservation?.invalidate()
        progressObservation = nil
        setStatusBarStyle(.darkContent)

        UIView.animate(withDuration: 0.42) {
            overlay.alpha = 0
        } completion: { _ in
            overlay.removeFromSuperview()
        }
    }
}

/**
 Capacitor installs its own `WKNavigationDelegate` and offers no download hook,
 so this proxy handles the two download callbacks and forwards every other
 selector to Capacitor untouched via Objective-C message forwarding.
 */
private final class DownloadingNavigationDelegate: NSObject, WKNavigationDelegate, WKDownloadDelegate {

    private let wrapped: WKNavigationDelegate
    private weak var presenter: UIViewController?
    private var destinations: [ObjectIdentifier: URL] = [:]

    init(wrapping wrapped: WKNavigationDelegate, presenter: UIViewController) {
        self.wrapped = wrapped
        self.presenter = presenter
        super.init()
    }

    // MARK: Forwarding

    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || wrapped.responds(to: aSelector)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        wrapped.responds(to: aSelector) ? wrapped : super.forwardingTarget(for: aSelector)
    }

    // MARK: Downloads

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

        let destination = folder.appendingPathComponent(suggestedFilename)
        try? FileManager.default.removeItem(at: destination)
        destinations[ObjectIdentifier(download)] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = destinations.removeValue(forKey: ObjectIdentifier(download)),
              let presenter else { return }

        let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        // iPad crashes without a popover anchor.
        share.popoverPresentationController?.sourceView = presenter.view
        share.popoverPresentationController?.sourceRect = CGRect(
            x: presenter.view.bounds.midX, y: presenter.view.bounds.maxY, width: 0, height: 0
        )
        presenter.present(share, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        destinations.removeValue(forKey: ObjectIdentifier(download))
    }
}

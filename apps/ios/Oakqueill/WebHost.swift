import UIKit
import SwiftUI
import WebKit

typealias WKWebViewHolder = WKWebView

/// Owns the web view that runs the Oakqueill page. The page is served from the app bundle through its own URL scheme
/// (ES modules and workers do not load from file:// in a web view) and talks to Swift through one message handler.
final class WebHost: NSObject, WKNavigationDelegate, WKUIDelegate {
    static let shared = WebHost()

    let view: WKWebView
    private let bridge = NativeBridge()
    private var pageLoaded = false
    private var pendingOpens: [URL] = []

    override init() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: BundleSchemeHandler.scheme)
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "native")
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.allowsInlineMediaPlayback = true
        view = WKWebView(frame: .zero, configuration: config)
        super.init()
        bridge.onPageReady = { [weak self] in self?.pageIsReady() }
        view.navigationDelegate = self
        view.uiDelegate = self
        view.scrollView.bounces = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.allowsLinkPreview = false
        #if DEBUG
        view.isInspectable = true
        #endif
        #if DEBUG
        // simulator testing: launch with `-OpenFile /path/to.pdf` to open a file without the picker
        if let path = UserDefaults.standard.string(forKey: "OpenFile") { pendingOpens.append(URL(fileURLWithPath: path)) }
        #endif
        view.load(URLRequest(url: URL(string: "\(BundleSchemeHandler.scheme)://app/index.html")!))
    }

    // MARK: system hands us a PDF (Files, share sheet, "Open in")

    func openFromSystem(_ url: URL) {
        guard pageLoaded else { pendingOpens.append(url); return }
        deliver(url)
    }

    private func deliver(_ url: URL) {
        let result: [String: Any]
        do {
            let file = try bridge.adopt(url: url)
            result = ["token": file.token, "name": file.name, "base64": file.data.base64EncodedString()]
        } catch {
            result = ["error": "Cannot open “\(url.lastPathComponent)”: \(error.localizedDescription)"]
        }
        guard let json = try? JSONSerialization.data(withJSONObject: result), let text = String(data: json, encoding: .utf8) else { return }
        view.evaluateJavaScript("window.__oakqueill && window.__oakqueill.deliverOpened(\(text))")
    }

    /// The page installed window.docedit and window.__oakqueill; only now can files and tests be delivered to it.
    private func pageIsReady() {
        guard !pageLoaded else { return }
        pageLoaded = true
        let queued = pendingOpens; pendingOpens = []
        queued.forEach(deliver)
        #if DEBUG
        if UserDefaults.standard.bool(forKey: "SelfTest") {
            Task { @MainActor in
                do {
                    let r = try await view.callAsyncJavaScript("return await window.__oakqueill.selfTest()", contentWorld: .page)
                    NSLog("OAKQUEILL-SELFTEST \(r ?? "nil")")
                } catch { NSLog("OAKQUEILL-SELFTEST ERROR \(error)") }
            }
        }
        #endif
    }

    // Anything that is not the app page leaves through the system, never inside this view.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = action.request.url else { return .cancel }
        if url.scheme == BundleSchemeHandler.scheme || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { return .allow }
        return .cancel
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

    // JavaScript alert/confirm from the page (the renderer uses its own dialogs, but these must not hang)
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        UIApplication.topViewController()?.present(a, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        UIApplication.topViewController()?.present(a, animated: true)
    }
}

/// Serves the page's files from the app bundle's Web folder under oakqueill://app/.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "oakqueill"

    private static let types: [String: String] = [
        "html": "text/html", "js": "text/javascript", "mjs": "text/javascript", "css": "text/css", "json": "application/json",
        "map": "application/json", "wasm": "application/wasm", "png": "image/png", "jpg": "image/jpeg", "svg": "image/svg+xml",
        "ttf": "font/ttf", "woff2": "font/woff2", "bcmap": "application/octet-stream", "pfb": "application/octet-stream", "txt": "text/plain",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let root = Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true) else {
            task.didFailWithError(URLError(.badURL)); return
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        // stay inside the Web folder
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path), let data = try? Data(contentsOf: file) else {
            let r = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain"])!
            task.didReceive(r); task.didReceive(Data("Not found".utf8)); task.didFinish(); return
        }
        let mime = Self.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let headers = ["Content-Type": mime, "Content-Length": String(data.count), "Cache-Control": "no-store"]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

extension UIApplication {
    static func topViewController(base: UIViewController? = nil) -> UIViewController? {
        let root = base ?? UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }.first?.rootViewController
        if let presented = root?.presentedViewController { return topViewController(base: presented) }
        return root
    }
}

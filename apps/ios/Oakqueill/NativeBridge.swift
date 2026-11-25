import UIKit
import WebKit
import UniformTypeIdentifiers

struct BridgeError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
    init(_ m: String) { message = m }
}

/// The Swift half of window.docedit: only what needs the system. Files stay under security-scoped access for the
/// session and are addressed by an opaque token, so the page never sees a path.
final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    struct Adopted { let token: String; let name: String; let data: Data }

    private var scoped: [String: URL] = [:]
    private var pickerHolder: PickerHolder?
    /// Called when the page says its bridge is installed (see main.ts); system-opened files wait for it.
    var onPageReady: (() -> Void)?
    static let maxBytes = 512 * 1024 * 1024

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor (Any?, String?) -> Void) {
        // Only the app's own page, in the main frame, may ask Swift for anything: not another frame and not a page that got loaded
        // some other way (the handler is attached to the whole web view).
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == BundleSchemeHandler.scheme, message.frameInfo.securityOrigin.host == "app" else {
            replyHandler(nil, "Not allowed from this page"); return
        }
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else { replyHandler(nil, "Bad message"); return }
        let args = body["args"] as? [String: Any] ?? [:]
        Task { @MainActor in
            do { replyHandler(try await self.handle(op, args), nil) }
            catch { replyHandler(nil, error.localizedDescription) }
        }
    }

    @MainActor
    private func handle(_ op: String, _ a: [String: Any]) async throws -> Any? {
        switch op {
        case "pickPdfs":
            let urls = try await pick(types: [.pdf], multi: a["multi"] as? Bool ?? false, asCopy: false)
            guard let urls else { return NSNull() }
            return try urls.map(describe)
        case "pickFiles":
            let kind = a["kind"] as? String ?? ""
            let types: [UTType]
            switch kind {
            case "images": types = [.jpeg, .png]
            case "text": types = [.plainText, .utf8PlainText, .commaSeparatedText, .text]
            default: throw BridgeError("Choosing this kind of file is not available on iOS yet.")
            }
            let urls = try await pick(types: types, multi: kind == "images", asCopy: true)
            guard let urls else { return NSNull() }
            return try urls.map(describe)
        case "readFile":
            guard let token = a["token"] as? String, let url = scoped[token] else { throw BridgeError("That file was not opened in this session.") }
            return try describe(url, token: token)
        case "writeFile":
            guard let token = a["token"] as? String, let url = scoped[token], let b64 = a["base64"] as? String, let data = Data(base64Encoded: b64) else {
                return ["ok": false, "message": "That file was not opened in this session."]
            }
            do { try coordinatedWrite(data, to: url); return ["ok": true] }
            catch { return ["ok": false, "message": "The file could not be written: \(error.localizedDescription)"] }
        case "saveFile":
            guard let name = a["name"] as? String, let b64 = a["base64"] as? String, let data = Data(base64Encoded: b64) else { throw BridgeError("Nothing to save.") }
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let tmp = dir.appendingPathComponent(Self.safeName(name))
            try data.write(to: tmp)
            defer { try? FileManager.default.removeItem(at: dir) }
            guard let urls = try await present(UIDocumentPickerViewController(forExporting: [tmp], asCopy: true)), let url = urls.first else {
                return ["ok": false, "cancelled": true]
            }
            let token = keep(url)
            return ["ok": true, "token": token, "name": url.lastPathComponent]
        case "saveFolder":
            guard let files = a["files"] as? [[String: Any]] else { throw BridgeError("Nothing to save.") }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            guard let urls = try await present(picker), let folder = urls.first else { return ["ok": false, "cancelled": true] }
            let access = folder.startAccessingSecurityScopedResource()
            defer { if access { folder.stopAccessingSecurityScopedResource() } }
            var written: [String] = []
            for f in files {
                guard let name = f["name"] as? String, let b64 = f["base64"] as? String, let data = Data(base64Encoded: b64) else { continue }
                let target = folder.appendingPathComponent(Self.safeName(name))
                try coordinatedWrite(data, to: target)
                written.append(target.lastPathComponent)
            }
            return ["ok": true, "folder": folder.lastPathComponent, "files": written]
        case "bridgeReady":
            onPageReady?()
            return true
        case "print":
            return await printPages(a)
        case "openExternal":
            return await openExternal(a["url"] as? String ?? "")
        default:
            throw BridgeError("Unknown native operation \(op)")
        }
    }

    // MARK: files

    /// Takes a URL the system gave the app (picker or "Open in"), keeps access to it and reads it.
    func adopt(url: URL) throws -> Adopted {
        let token = keep(url)
        let d = try describe(url, token: token)
        return Adopted(token: token, name: d["name"] as! String, data: try readData(url))
    }

    private func keep(_ url: URL) -> String {
        _ = url.startAccessingSecurityScopedResource() // stays open for the session so Save can write back
        let token = UUID().uuidString
        scoped[token] = url
        return token
    }

    private func readData(_ url: URL) throws -> Data {
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if size > Self.maxBytes { throw BridgeError("“\(url.lastPathComponent)” is \(size / 1_048_576) MB; files over \(Self.maxBytes / 1_048_576) MB are not supported yet.") }
        var result: Result<Data, Error> = .failure(BridgeError("Could not read the file."))
        var coordError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordError) { u in
            result = Result { try Data(contentsOf: u, options: .mappedIfSafe) }
        }
        if let coordError { throw coordError }
        return try result.get()
    }

    private func describe(_ url: URL) throws -> [String: Any] { try describe(url, token: keep(url)) }
    private func describe(_ url: URL, token: String) throws -> [String: Any] {
        ["token": token, "name": url.lastPathComponent, "base64": try readData(url).base64EncodedString()]
    }

    private func coordinatedWrite(_ data: Data, to url: URL) throws {
        var coordError: NSError?
        var inner: Error?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordError) { u in
            do { try data.write(to: u, options: .atomic) } catch { inner = error }
        }
        if let coordError { throw coordError }
        if let inner { throw inner }
    }

    static func safeName(_ name: String) -> String {
        let base = (name as NSString).lastPathComponent.replacingOccurrences(of: ":", with: "-")
        return base.isEmpty || base.hasPrefix(".") ? "Document.pdf" : base
    }

    // MARK: pickers

    private func pick(types: [UTType], multi: Bool, asCopy: Bool) async throws -> [URL]? {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: asCopy)
        picker.allowsMultipleSelection = multi
        return try await present(picker)
    }

    @MainActor
    private func present(_ picker: UIDocumentPickerViewController) async throws -> [URL]? {
        guard let top = UIApplication.topViewController() else { throw BridgeError("Nothing to show the picker on.") }
        return await withCheckedContinuation { cont in
            let holder = PickerHolder { urls in cont.resume(returning: urls) }
            pickerHolder = holder
            picker.delegate = holder
            top.present(picker, animated: true)
        }
    }

    // MARK: printing and links

    @MainActor
    private func printPages(_ a: [String: Any]) async -> [String: Any] {
        guard let pages = a["pages"] as? [[String: Any]], !pages.isEmpty else { return ["ok": false, "message": "Nothing to print."] }
        let images = pages.compactMap { p -> UIImage? in
            guard let b64 = p["png"] as? String, let d = Data(base64Encoded: b64) else { return nil }
            return UIImage(data: d)
        }
        guard !images.isEmpty else { return ["ok": false, "message": "The pages could not be prepared for printing."] }
        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .general
        info.jobName = a["title"] as? String ?? "Oakqueill"
        switch a["orientation"] as? String {
        case "portrait": info.orientation = .portrait
        case "landscape": info.orientation = .landscape
        default: break
        }
        let controller = UIPrintInteractionController.shared
        controller.printInfo = info
        controller.printingItems = images
        return await withCheckedContinuation { cont in
            controller.present(animated: true) { _, completed, error in
                if let error { cont.resume(returning: ["ok": false, "message": error.localizedDescription]) }
                else if completed { cont.resume(returning: ["ok": true]) }
                else { cont.resume(returning: ["ok": false, "cancelled": true]) }
            }
        }
    }

    /// Web and email links only, and only after the user has seen the full address (a document cannot open one silently).
    @MainActor
    private func openExternal(_ raw: String) async -> Bool {
        guard let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)), let scheme = url.scheme?.lowercased(),
              ["http", "https", "mailto"].contains(scheme), let top = UIApplication.topViewController() else { return false }
        let mail = scheme == "mailto"
        let ok: Bool = await withCheckedContinuation { cont in
            let alert = UIAlertController(title: mail ? "Write an email from this link?" : "Open this link?", message: url.absoluteString, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in cont.resume(returning: false) })
            alert.addAction(UIAlertAction(title: mail ? "Write email" : "Open link", style: .default) { _ in cont.resume(returning: true) })
            top.present(alert, animated: true)
        }
        guard ok else { return false }
        return await UIApplication.shared.open(url)
    }
}

/// Delegate for one document picker; answers nil when the user cancels.
final class PickerHolder: NSObject, UIDocumentPickerDelegate {
    private var done: (([URL]?) -> Void)?
    init(_ done: @escaping ([URL]?) -> Void) { self.done = done }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finish(urls) }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish(nil) }
    private func finish(_ urls: [URL]?) { let d = done; done = nil; d?(urls) }
}

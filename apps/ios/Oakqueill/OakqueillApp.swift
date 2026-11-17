import WebKit
import SwiftUI

@main
struct OakqueillApp: App {
    var body: some Scene {
        WindowGroup {
            WebContainer()
                .ignoresSafeArea() // the page handles the safe areas itself (viewport-fit=cover)
                .onOpenURL { WebHost.shared.openFromSystem($0) }
        }
    }
}

struct WebContainer: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebViewHolder { WebHost.shared.view }
    func updateUIView(_ uiView: WKWebViewHolder, context: Context) {}
}

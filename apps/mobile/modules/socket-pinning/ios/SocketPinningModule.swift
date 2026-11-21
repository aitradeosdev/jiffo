import ExpoModulesCore

/**
 * Certificate pinning for WebSockets (docs/security/pinning.md, MB7). The pinning library pins React Native's
 * requests only, through TrustKit; socket.io's WebSocket, which carries the sign-in token too, is built on
 * SocketRocket instead. JiffoSocketPinning (Objective-C, beside this file) gives each new one TrustKit's check
 * with the same pins.
 */
public class SocketPinningModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SocketPinning")

    AsyncFunction("pinWebSockets") { (hosts: [String: Any]) in
      // Looked up by name, so Swift needs no Objective-C header from this pod.
      guard let pinning = NSClassFromString("JiffoSocketPinning") as AnyObject? else {
        throw SocketPinningError("WebSocket pinning isn't in this build")
      }
      _ = pinning.perform(NSSelectorFromString("pinHosts:"), with: hosts)
    }
  }
}

struct SocketPinningError: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}

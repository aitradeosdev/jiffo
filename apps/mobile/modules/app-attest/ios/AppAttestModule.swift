import Darwin
import DeviceCheck
import ExpoModulesCore
import MachO
import UIKit

/// Apple App Attest (docs/security-plan.md, MB3): a key made in the Secure Enclave that Apple attests is our
/// store app's, on a genuine iPhone. Apple attests it once; after that it signs an assertion over each checked
/// request. Hashes come in as hex; Apple's answers go back as base64.
public class AppAttestModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppAttest")

    /// A new key; its id. Not on the simulator, or on a phone too old for App Attest.
    AsyncFunction("newAppleKey") { (promise: Promise) in
      let service = DCAppAttestService.shared
      guard service.isSupported else { return promise.reject(AppAttestError("App Attest isn't available here")) }
      service.generateKey { keyId, error in
        if let keyId { promise.resolve(keyId) } else { promise.reject(AppAttestError(error)) }
      }
    }

    /// Apple's attestation of the key, over the hash of the server's single-use code.
    AsyncFunction("attestAppleKey") { (keyId: String, clientDataHash: String, promise: Promise) in
      guard let hash = Data(hex: clientDataHash) else { return promise.reject(AppAttestError("Bad hash")) }
      DCAppAttestService.shared.attestKey(keyId, clientDataHash: hash) { attestation, error in
        if let attestation { promise.resolve(attestation.base64EncodedString()) } else {
          promise.reject(AppAttestError(error))
        }
      }
    }

    /// The key's assertion over a request's hash.
    AsyncFunction("appleAssertion") { (keyId: String, clientDataHash: String, promise: Promise) in
      guard let hash = Data(hex: clientDataHash) else { return promise.reject(AppAttestError("Bad hash")) }
      DCAppAttestService.shared.generateAssertion(keyId, clientDataHash: hash) { assertion, error in
        if let assertion { promise.resolve(assertion.base64EncodedString()) } else {
          promise.reject(AppAttestError(error))
        }
      }
    }

    /// What the app finds on the phone (docs/security-plan.md, MB4). The app's own word: it adds to App Attest.
    AsyncFunction("riskSignals") { () -> [String] in
      var found: [String] = []
      if RiskChecks.jailbroken() { found.append("rooted") }
      if RiskChecks.simulator() { found.append("emulator") }
      if RiskChecks.hooked() { found.append("hooking") }
      if RiskChecks.debugged() { found.append("debugger") }
      return found
    }

    /// The phone's id for one developer's apps (docs/security-plan.md, I3, E6): the same in both Jiffo apps on
    /// one iPhone, so accounts sharing a phone can be flagged. The server keeps only a keyed hash of it.
    AsyncFunction("phoneId") { () -> String? in
      UIDevice.current.identifierForVendor?.uuidString
    }

    /// Play Integrity is Android's.
    AsyncFunction("prepareIntegrity") { (_: String) in }
    AsyncFunction("integrityToken") { (_: String, _: String) -> String in
      throw AppAttestError("Play Integrity is for Android")
    }
  }
}

final class AppAttestError: Exception {
  private let text: String
  init(_ text: String) {
    self.text = text
    super.init()
  }
  convenience init(_ error: Error?) {
    self.init(error?.localizedDescription ?? "App Attest didn't answer")
  }
  override var reason: String { text }
}

extension Data {
  /// Bytes from hex, or nil if it isn't hex.
  init?(hex: String) {
    guard hex.count % 2 == 0 else { return nil }
    var bytes = [UInt8]()
    bytes.reserveCapacity(hex.count / 2)
    var index = hex.startIndex
    while index < hex.endIndex {
      let next = hex.index(index, offsetBy: 2)
      guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
      bytes.append(byte)
      index = next
    }
    self.init(bytes)
  }
}

/// Signs of a phone that isn't as Apple ships it, or of someone watching the app.
enum RiskChecks {
  private static let jailbreakPaths = [
    "/Applications/Cydia.app", "/Applications/Sileo.app", "/Library/MobileSubstrate/MobileSubstrate.dylib",
    "/bin/bash", "/usr/sbin/sshd", "/etc/apt", "/private/var/lib/apt/", "/usr/bin/ssh", "/var/jb",
    "/private/var/jb", "/usr/lib/libjailbreak.dylib",
  ]
  private static let hookNames = [
    "frida", "fridagadget", "cynject", "libcycript", "substrateloader", "sslkillswitch", "mobilesubstrate",
    "libhooker", "substitute", "tweakinject",
  ]

  static func jailbroken() -> Bool {
    #if targetEnvironment(simulator)
      return false
    #else
      if jailbreakPaths.contains(where: { FileManager.default.fileExists(atPath: $0) }) { return true }
      // An app can't write outside its sandbox on a phone as Apple ships it.
      let probe = "/private/jiffo-\(UUID().uuidString)"
      if (try? "x".write(toFile: probe, atomically: true, encoding: .utf8)) != nil {
        try? FileManager.default.removeItem(atPath: probe)
        return true
      }
      return false
    #endif
  }

  static func simulator() -> Bool {
    #if targetEnvironment(simulator)
      return true
    #else
      return false
    #endif
  }

  /// A hooking library loaded into the app, or Frida's server listening on the phone.
  static func hooked() -> Bool {
    for index in 0..<_dyld_image_count() {
      guard let raw = _dyld_get_image_name(index) else { continue }
      let name = String(cString: raw).lowercased()
      if hookNames.contains(where: { name.contains($0) }) { return true }
    }
    return listening(on: 27042)
  }

  /// A debugger attached to the app.
  static func debugged() -> Bool {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    guard sysctl(&mib, UInt32(mib.count), &info, &size, nil, 0) == 0 else { return false }
    return (info.kp_proc.p_flag & P_TRACED) != 0
  }

  private static func listening(on port: UInt16) -> Bool {
    let socketFd = socket(AF_INET, SOCK_STREAM, 0)
    guard socketFd >= 0 else { return false }
    defer { close(socketFd) }
    var address = sockaddr_in()
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = port.bigEndian
    address.sin_addr.s_addr = inet_addr("127.0.0.1")
    let result = withUnsafePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        connect(socketFd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    return result == 0
  }
}

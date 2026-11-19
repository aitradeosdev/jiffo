import DeviceCheck
import ExpoModulesCore

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

    /// Play Integrity is Android's.
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

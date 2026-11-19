import ExpoModulesCore
import Security

/// The phone's own signing key (docs/security-plan.md, A3): a P-256 key made in the Secure Enclave, which
/// never leaves it. Money requests are signed with it; the server keeps only the public half.
public class DeviceKeyModule: Module {
  /// DER prefix that turns a raw P-256 point (04 || X || Y) into SubjectPublicKeyInfo, as the server reads it.
  private static let spkiPrefix: [UInt8] = [
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
    0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
  ]

  public func definition() -> ModuleDefinition {
    Name("DeviceKey")

    /// The public half, as base64 SPKI; the key is made the first time.
    AsyncFunction("publicKey") { (alias: String) -> String in
      // One at a time: two callers finding no key would otherwise make two under the same tag.
      self.lock.lock()
      defer { self.lock.unlock() }
      let key = try self.privateKey(alias) ?? self.makeKey(alias)
      guard let pub = SecKeyCopyPublicKey(key),
        let raw = SecKeyCopyExternalRepresentation(pub, nil) as Data?
      else { throw DeviceKeyError("Couldn't read this phone's key") }
      return (Data(Self.spkiPrefix) + raw).base64EncodedString()
    }

    /// An ECDSA P-256 SHA-256 signature over the text's UTF-8 bytes, as base64 DER.
    AsyncFunction("sign") { (alias: String, text: String) -> String in
      guard let key = try self.privateKey(alias) else { throw DeviceKeyError("This phone has no key yet") }
      var error: Unmanaged<CFError>?
      guard let signature = SecKeyCreateSignature(
        key, .ecdsaSignatureMessageX962SHA256, Data(text.utf8) as CFData, &error) as Data?
      else { throw DeviceKeyError("Couldn't sign with this phone's key") }
      return signature.base64EncodedString()
    }

    /// Removes the key, for signing out of an install for good.
    AsyncFunction("remove") { (alias: String) in
      SecItemDelete(self.query(alias) as CFDictionary)
    }
  }

  private let lock = NSLock()

  private func tag(_ alias: String) -> Data { Data("com.jiffo.devicekey.\(alias)".utf8) }

  private func query(_ alias: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag(alias),
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
    ]
  }

  private func privateKey(_ alias: String) throws -> SecKey? {
    var query = self.query(alias)
    query[kSecReturnRef as String] = true
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let found = item else { throw DeviceKeyError("Couldn't read this phone's key") }
    return (found as! SecKey)
  }

  private func makeKey(_ alias: String) throws -> SecKey {
    // Usable only while the phone is unlocked, never backed up or moved to another phone. The usage flag is
    // for Secure Enclave keys, which the simulator can't make.
    #if targetEnvironment(simulator)
      let flags: SecAccessControlCreateFlags = []
    #else
      let flags: SecAccessControlCreateFlags = .privateKeyUsage
    #endif
    guard let access = SecAccessControlCreateWithFlags(
      nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, flags, nil)
    else { throw DeviceKeyError("Couldn't set up this phone's key") }
    var attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: tag(alias),
        kSecAttrAccessControl as String: access,
      ] as [String: Any],
    ]
    #if !targetEnvironment(simulator)
      // The simulator has no Secure Enclave; a real phone always makes the key there.
      attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
    #endif
    var error: Unmanaged<CFError>?
    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
      throw DeviceKeyError("Couldn't make this phone's key")
    }
    return key
  }
}

struct DeviceKeyError: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}

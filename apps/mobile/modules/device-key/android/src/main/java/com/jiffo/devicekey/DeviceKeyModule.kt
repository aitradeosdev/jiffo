package com.jiffo.devicekey

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * The phone's own signing key (docs/security-plan.md, A3): a P-256 key made in the Android Keystore (in
 * StrongBox where the phone has it), which can't be exported. Money requests are signed with it; the server
 * keeps only the public half.
 */
class DeviceKeyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DeviceKey")

    /** The public half, as base64 SPKI; the key is made the first time. */
    AsyncFunction("publicKey") { alias: String ->
      val store = keyStore()
      if (!store.containsAlias(name(alias))) makeKey(name(alias))
      val certificate = store.getCertificate(name(alias)) ?: throw DeviceKeyException("Couldn't read this phone's key")
      Base64.encodeToString(certificate.publicKey.encoded, Base64.NO_WRAP)
    }

    /** An ECDSA P-256 SHA-256 signature over the text's UTF-8 bytes, as base64 DER. */
    AsyncFunction("sign") { alias: String, text: String ->
      val key = keyStore().getKey(name(alias), null) as? PrivateKey
        ?: throw DeviceKeyException("This phone has no key yet")
      val signature = Signature.getInstance("SHA256withECDSA").run {
        initSign(key)
        update(text.toByteArray(Charsets.UTF_8))
        sign()
      }
      Base64.encodeToString(signature, Base64.NO_WRAP)
    }

    /** Removes the key, for signing out of an install for good. */
    AsyncFunction("remove") { alias: String ->
      keyStore().deleteEntry(name(alias))
    }
  }

  private fun name(alias: String) = "com.jiffo.devicekey.$alias"

  private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun makeKey(alias: String) {
    fun spec(strongBox: Boolean) =
      KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
        .apply { if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) setIsStrongBoxBacked(true) }
        .build()
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
    try {
      generator.initialize(spec(strongBox = true))
      generator.generateKeyPair()
    } catch (e: StrongBoxUnavailableException) {
      // Most phones have no StrongBox: the Keystore's trusted environment holds the key instead.
      generator.initialize(spec(strongBox = false))
      generator.generateKeyPair()
    }
  }
}

class DeviceKeyException(message: String) : CodedException(message)

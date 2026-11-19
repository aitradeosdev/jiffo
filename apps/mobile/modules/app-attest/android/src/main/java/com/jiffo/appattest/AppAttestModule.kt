package com.jiffo.appattest

import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityManager.PrepareIntegrityTokenRequest
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityToken
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenProvider
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenRequest
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Google Play Integrity, standard requests (docs/security-plan.md, MB3): Google vouches, over a request's
 * hash, that this is our app as Play installed it on a genuine phone. The token provider is prepared once and
 * made again if Google says it has expired.
 */
class AppAttestModule : Module() {
  private var provider: StandardIntegrityTokenProvider? = null
  private var preparedFor: Long? = null

  override fun definition() = ModuleDefinition {
    Name("AppAttest")

    /** A token over the request's hash (hex), for the Google Cloud project linked to the app in Play Console. */
    AsyncFunction("integrityToken") { requestHash: String, cloudProjectNumber: String, promise: Promise ->
      val number = cloudProjectNumber.toLongOrNull()
        ?: return@AsyncFunction promise.reject(AppAttestException("No Google Cloud project number"))
      withProvider(number, promise) { ready ->
        ready.request(StandardIntegrityTokenRequest.builder().setRequestHash(requestHash).build())
          .addOnSuccessListener { token: StandardIntegrityToken -> promise.resolve(token.token()) }
          .addOnFailureListener { error ->
            // A provider that has expired is made again next time.
            provider = null
            promise.reject(AppAttestException(error.message ?: "Play Integrity didn't answer"))
          }
      }
    }

    AsyncFunction("newAppleKey") { -> throw AppAttestException("App Attest is for iPhones") }
    AsyncFunction("attestAppleKey") { _: String, _: String -> throw AppAttestException("App Attest is for iPhones") }
    AsyncFunction("appleAssertion") { _: String, _: String -> throw AppAttestException("App Attest is for iPhones") }
  }

  private fun withProvider(number: Long, promise: Promise, use: (StandardIntegrityTokenProvider) -> Unit) {
    val ready = provider
    if (ready != null && preparedFor == number) return use(ready)
    val context = appContext.reactContext?.applicationContext
      ?: return promise.reject(AppAttestException("No app context"))
    IntegrityManagerFactory.createStandard(context)
      .prepareIntegrityToken(PrepareIntegrityTokenRequest.builder().setCloudProjectNumber(number).build())
      .addOnSuccessListener { made ->
        provider = made
        preparedFor = number
        use(made)
      }
      .addOnFailureListener { error -> promise.reject(AppAttestException(error.message ?: "Play Integrity didn't answer")) }
  }
}

class AppAttestException(message: String) : CodedException(message)

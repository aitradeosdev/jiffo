package com.jiffo.appattest

import com.google.android.gms.tasks.Task
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
 * hash, that this is our app as Play installed it on a genuine phone. The token provider is prepared once,
 * shared by requests made while it is being prepared, and made again if Google says it has expired.
 */
class AppAttestModule : Module() {
  private val lock = Any()
  private var provider: StandardIntegrityTokenProvider? = null
  private var preparing: Task<StandardIntegrityTokenProvider>? = null
  private var preparedFor: Long? = null

  override fun definition() = ModuleDefinition {
    Name("AppAttest")

    /** Prepares the token provider ahead of the first check, for the app's Google Cloud project. */
    AsyncFunction("prepareIntegrity") { cloudProjectNumber: String, promise: Promise ->
      val number = cloudProjectNumber.toLongOrNull()
        ?: return@AsyncFunction promise.reject(AppAttestException("No Google Cloud project number"))
      providerTask(number)
        ?.addOnSuccessListener { promise.resolve(null) }
        ?.addOnFailureListener { error -> promise.reject(AppAttestException(error.message ?: "Play Integrity didn't answer")) }
        ?: promise.reject(AppAttestException("No app context"))
    }

    /** A token over the request's hash (hex), for the Google Cloud project linked to the app in Play Console. */
    AsyncFunction("integrityToken") { requestHash: String, cloudProjectNumber: String, promise: Promise ->
      val number = cloudProjectNumber.toLongOrNull()
        ?: return@AsyncFunction promise.reject(AppAttestException("No Google Cloud project number"))
      val task = providerTask(number) ?: return@AsyncFunction promise.reject(AppAttestException("No app context"))
      task
        .addOnSuccessListener { ready ->
          ready.request(StandardIntegrityTokenRequest.builder().setRequestHash(requestHash).build())
            .addOnSuccessListener { token: StandardIntegrityToken -> promise.resolve(token.token()) }
            .addOnFailureListener { error ->
              // A provider that has expired is made again next time.
              forget(ready)
              promise.reject(AppAttestException(error.message ?: "Play Integrity didn't answer"))
            }
        }
        .addOnFailureListener { error -> promise.reject(AppAttestException(error.message ?: "Play Integrity didn't answer")) }
    }

    AsyncFunction("newAppleKey") { -> throw AppAttestException("App Attest is for iPhones") }
    AsyncFunction("attestAppleKey") { _: String, _: String -> throw AppAttestException("App Attest is for iPhones") }
    AsyncFunction("appleAssertion") { _: String, _: String -> throw AppAttestException("App Attest is for iPhones") }
  }

  /** The provider, or the one being prepared; one prepare at a time, whichever thread asks. */
  private fun providerTask(number: Long): Task<StandardIntegrityTokenProvider>? = synchronized(lock) {
    val ready = provider
    if (ready != null && preparedFor == number) {
      return com.google.android.gms.tasks.Tasks.forResult(ready)
    }
    val inFlight = preparing
    if (inFlight != null && preparedFor == number) return inFlight
    val context = appContext.reactContext?.applicationContext ?: return null
    val task = IntegrityManagerFactory.createStandard(context)
      .prepareIntegrityToken(PrepareIntegrityTokenRequest.builder().setCloudProjectNumber(number).build())
    preparing = task
    preparedFor = number
    task.addOnCompleteListener { done ->
      synchronized(lock) {
        if (preparing === task) {
          preparing = null
          provider = if (done.isSuccessful) done.result else null
        }
      }
    }
    task
  }

  private fun forget(failed: StandardIntegrityTokenProvider) = synchronized(lock) {
    if (provider === failed) provider = null
  }
}

class AppAttestException(message: String) : CodedException(message)

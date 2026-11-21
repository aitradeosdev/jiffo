package com.jiffo.appattest

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Debug
import android.provider.Settings
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
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket

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

    /** What the app finds on the phone (docs/security-plan.md, MB4). The app's own word: it adds to Play Integrity. */
    AsyncFunction("riskSignals") {
      val context = appContext.reactContext?.applicationContext
      buildList {
        if (RiskChecks.rooted()) add("rooted")
        if (RiskChecks.emulator()) add("emulator")
        if (RiskChecks.hooked()) add("hooking")
        if (RiskChecks.debugged()) add("debugger")
        if (context != null && RiskChecks.spoofer(context)) add("location_spoofer")
      }
    }

    /**
     * The phone's id for apps signed with one key (docs/security-plan.md, I3, E6): the same in both Jiffo apps
     * when Play signs them with the same key, so accounts sharing a phone can be flagged. It stays the same
     * when an app is reinstalled. The server keeps only a keyed hash of it.
     */
    AsyncFunction("phoneId") {
      val context = appContext.reactContext?.applicationContext ?: return@AsyncFunction null
      Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
    }

    /**
     * What the connection is (docs/security-plan.md, E6): wifi, cellular, ethernet, vpn, or none. Sent with
     * requests, so a phone network's or a VPN's address, which thousands share, isn't taken for a home's.
     */
    AsyncFunction("networkType") {
      val context = appContext.reactContext?.applicationContext ?: return@AsyncFunction null
      val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        ?: return@AsyncFunction null
      val caps = manager.getNetworkCapabilities(manager.activeNetwork) ?: return@AsyncFunction "none"
      when {
        caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
        else -> "other"
      }
    }

    // Apple's App Attest, which the app asks only on an iPhone. Typed as the iPhone's answers are (a string),
    // since Expo can't name a function's result after one that only throws.
    AsyncFunction("newAppleKey") { -> iPhoneOnly<String>() }
    AsyncFunction("attestAppleKey") { _: String, _: String -> iPhoneOnly<String>() }
    AsyncFunction("appleAssertion") { _: String, _: String -> iPhoneOnly<String>() }
  }

  private fun <T> iPhoneOnly(): T = throw AppAttestException("App Attest is for iPhones")

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

/** Signs of a phone that isn't as its maker ships it, or of someone watching the app. */
object RiskChecks {
  private val suPaths = listOf(
    "/system/app/Superuser.apk", "/sbin/su", "/system/bin/su", "/system/xbin/su", "/data/local/xbin/su",
    "/data/local/bin/su", "/system/sd/xbin/su", "/system/bin/failsafe/su", "/data/local/su", "/su/bin/su",
    "/system/bin/.ext/su", "/system/usr/we-need-root/su", "/cache/su", "/data/adb/magisk",
  )
  private val hookLibraries = listOf("frida", "linjector", "xposed", "lsposed", "substrate")
  /** Frida's own threads, by the names they run under. */
  private val hookThreads = setOf("gum-js-loop", "gmain", "gdbus", "pool-frida", "frida-main")

  fun rooted(): Boolean =
    Build.TAGS?.contains("test-keys") == true || suPaths.any { File(it).exists() }

  /**
   * Google's emulator and the usual others, by the markers they are known by, not loose matches a real
   * phone's build could share.
   */
  fun emulator(): Boolean {
    val product = Build.PRODUCT
    return Build.HARDWARE in setOf("goldfish", "ranchu", "vbox86") ||
      product == "sdk" || product == "google_sdk" || product.startsWith("sdk_gphone") ||
      product.startsWith("sdk_x86") || product == "vbox86p" ||
      Build.FINGERPRINT.startsWith("generic/sdk") || Build.FINGERPRINT.startsWith("google/sdk_gphone") ||
      Build.MODEL.startsWith("Android SDK built for") || Build.MANUFACTURER.contains("Genymotion") ||
      File("/dev/qemu_pipe").exists() || File("/dev/socket/qemud").exists()
  }

  /**
   * A hooking library loaded into the app, Frida's threads in it, the Xposed bridge, or Frida's server
   * listening on the phone.
   */
  fun hooked(): Boolean {
    val maps = runCatching { File("/proc/self/maps").readText().lowercase() }.getOrDefault("")
    if (hookLibraries.any { maps.contains(it) }) return true
    val threads = runCatching {
      File("/proc/self/task").listFiles().orEmpty().map { File(it, "comm").readText().trim().lowercase() }
    }.getOrDefault(emptyList())
    if (threads.any { it in hookThreads }) return true
    if (runCatching { Class.forName("de.robv.android.xposed.XposedBridge") }.isSuccess) return true
    return runCatching {
      Socket().use { it.connect(InetSocketAddress("127.0.0.1", 27042), 150) }
      true
    }.getOrDefault(false)
  }

  fun debugged(): Boolean = Debug.isDebuggerConnected() || Debug.waitingForDebugger()

  /** Fake-location apps, by package: only those listed in the manifest's queries can be seen (G1). */
  private val spoofers = listOf(
    "fr.dvilleneuve.lockito", "com.lexa.fakegps", "com.incorporateapps.fakegps.fre",
    "com.theappninjas.fakegpsjoystick", "com.rosteam.gpsemulator", "ru.gavrikov.mocklocations",
    "org.hola.gpslocation",
  )

  @Suppress("DEPRECATION")
  fun spoofer(context: Context): Boolean = spoofers.any { name ->
    runCatching { context.packageManager.getPackageInfo(name, 0) }.isSuccess
  }
}

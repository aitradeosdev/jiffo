package com.jiffo.socketpinning

import com.facebook.react.modules.network.CustomClientBuilder
import com.facebook.react.modules.websocket.WebSocketModule
import com.sslpublickeypinning.SslPublicKeyPinningModule
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Certificate pinning for WebSockets (docs/security/pinning.md, MB7). The pinning library sets its pins on React
 * Native's requests only; React Native's WebSockets build their own connections, so socket.io's, which carries the
 * sign-in token, would go unpinned. Each new WebSocket gets the library's pins here, so both always agree, and
 * none once the library has none (its pins' end date has passed).
 */
class SocketPinningModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SocketPinning")

    /** The hosts come from the app for iOS; on Android the library's own pinner already holds them. */
    AsyncFunction("pinWebSockets") { _: Map<String, Any?> ->
      WebSocketModule.setCustomClientBuilder(
        CustomClientBuilder { builder ->
          SslPublicKeyPinningModule.getCertificatePinner()?.let { builder.certificatePinner(it) }
        },
      )
    }
  }
}

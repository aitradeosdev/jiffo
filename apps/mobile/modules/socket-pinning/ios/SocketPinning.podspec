Pod::Spec.new do |s|
  s.name           = 'SocketPinning'
  s.version        = '1.0.0'
  s.summary        = "Certificate pinning for React Native's WebSockets"
  s.author         = ''
  s.homepage       = 'https://github.com/aitradeosdev/jiffo'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  # The same pinning library the requests use (through react-native-ssl-public-key-pinning), and the WebSocket
  # library React Native's WebSockets are built on.
  s.dependency 'TrustKit'
  s.dependency 'SocketRocket'
  s.source_files = '**/*.{h,m,swift}'
end

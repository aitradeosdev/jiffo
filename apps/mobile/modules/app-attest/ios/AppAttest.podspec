Pod::Spec.new do |s|
  s.name           = 'AppAttest'
  s.version        = '1.0.0'
  s.summary        = "Apple App Attest: a key in the Secure Enclave that Apple vouches is the store app's"
  s.author         = ''
  s.homepage       = 'https://github.com/aitradeosdev/jiffo'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'DeviceCheck'
  s.source_files = '**/*.{h,m,swift}'
end

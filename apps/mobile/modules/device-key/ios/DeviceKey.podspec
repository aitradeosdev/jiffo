Pod::Spec.new do |s|
  s.name           = 'DeviceKey'
  s.version        = '1.0.0'
  s.summary        = "The phone's own signing key, in the Secure Enclave"
  s.author         = ''
  s.homepage       = 'https://github.com/aitradeosdev/jiffo'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,swift}'
end

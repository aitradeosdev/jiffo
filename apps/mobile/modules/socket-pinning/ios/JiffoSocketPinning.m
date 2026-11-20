#import "JiffoSocketPinning.h"

#import <SocketRocket/SRSecurityPolicy.h>
#import <SocketRocket/SRWebSocket.h>
#import <TrustKit/TrustKit.h>

// React Native's hook for making its WebSockets (React/CoreModules/RCTWebSocketModule.h). Declared here so this
// pod needs none of React Native's headers; React Native defines it with C linkage.
typedef SRWebSocket *_Nullable (^JiffoWebSocketProvider)(NSURLRequest *request);
extern void RCTSetCustomSRWebSocketProvider(JiffoWebSocketProvider provider);

static TrustKit *pinningKit = nil;

/// SocketRocket's usual certificate checks, then TrustKit's pins for a pinned host.
@interface JiffoPinnedSocketPolicy : SRSecurityPolicy
@end

@implementation JiffoPinnedSocketPolicy

- (BOOL)evaluateServerTrust:(SecTrustRef)serverTrust forDomain:(NSString *)domain
{
  if (![super evaluateServerTrust:serverTrust forDomain:domain]) {
    return NO;
  }
  TrustKit *kit = pinningKit;
  if (kit == nil) {
    return YES;
  }
  return [kit.pinningValidator evaluateTrust:serverTrust forHostname:domain] != TSKTrustDecisionShouldBlockConnection;
}

@end

@implementation JiffoSocketPinning

+ (void)pinHosts:(NSDictionary<NSString *, NSDictionary *> *)hosts
{
  NSMutableDictionary *domains = [NSMutableDictionary dictionary];
  for (NSString *host in hosts) {
    NSDictionary *options = hosts[host];
    NSMutableDictionary *domain = [NSMutableDictionary dictionary];
    domain[kTSKPublicKeyHashes] = options[@"publicKeyHashes"];
    domain[kTSKIncludeSubdomains] = @([options[@"includeSubdomains"] boolValue]);
    if (options[@"expirationDate"] != nil) {
      domain[kTSKExpirationDate] = options[@"expirationDate"];
    }
    domain[kTSKDisableDefaultReportUri] = @YES;
    domains[host] = domain;
  }
  pinningKit = [[TrustKit alloc] initWithConfiguration:@{kTSKPinnedDomains : domains}];

  // Every new WebSocket checks the pins; one to a host that isn't pinned is checked as usual.
  RCTSetCustomSRWebSocketProvider(^SRWebSocket *_Nullable(NSURLRequest *request) {
    return [[SRWebSocket alloc] initWithURLRequest:request
                                         protocols:nil
                                    securityPolicy:[JiffoPinnedSocketPolicy new]];
  });
}

@end

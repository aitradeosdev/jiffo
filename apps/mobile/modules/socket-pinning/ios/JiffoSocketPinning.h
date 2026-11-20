#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Pins React Native's WebSockets to the same certificate authorities' keys as its requests (MB7).
@interface JiffoSocketPinning : NSObject

/// Hosts as the pinning library takes them: host => { publicKeyHashes, includeSubdomains, expirationDate }.
+ (void)pinHosts:(NSDictionary<NSString *, NSDictionary *> *)hosts;

@end

NS_ASSUME_NONNULL_END

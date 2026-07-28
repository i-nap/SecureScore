package com.securescore.gateway.filter;

import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import reactor.core.publisher.Mono;

@Configuration
public class RateLimiterConfig {

    /**
     * Rate-limit key: the client's real IP address.
     * Falls back to "anonymous" if the header is absent (direct connections).
     */
    // Bucket rate limits per client IP (first X-Forwarded-For hop, else socket address).
    @Bean
    public KeyResolver ipKeyResolver() {
        return exchange -> {
            String ip = exchange.getRequest().getHeaders().getFirst("X-Forwarded-For");
            if (ip == null || ip.isBlank()) {
                ip = exchange.getRequest().getRemoteAddress() != null
                    ? exchange.getRequest().getRemoteAddress().getAddress().getHostAddress()
                    : "anonymous";
            } else {
                // X-Forwarded-For can be a comma-separated list; take the first (originating) IP
                ip = ip.split(",")[0].trim();
            }
            return Mono.just(ip);
        };
    }
}

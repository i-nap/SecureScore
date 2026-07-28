package com.securescore.gateway.filter;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * Logs every request with method, path, status code, and latency.
 * Runs after JwtAuthFilter (order -99) so auth failures are also logged.
 */
@Component
public class LoggingFilter implements GlobalFilter, Ordered {

    private static final Logger log = LoggerFactory.getLogger(LoggingFilter.class);

    // Just after the auth filter, so rejected requests still get logged.
    @Override
    public int getOrder() {
        return -99;
    }

    // Time the request and log method/path/status/latency at a level matching the status.
    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        long start = System.currentTimeMillis();
        ServerHttpRequest req = exchange.getRequest();
        String method = req.getMethod().name();
        String path   = req.getURI().getPath();

        return chain.filter(exchange).doFinally(signal -> {
            long ms = System.currentTimeMillis() - start;
            int status = exchange.getResponse().getStatusCode() != null
                ? exchange.getResponse().getStatusCode().value() : 0;

            if (status >= 500) {
                log.error("{} {} → {} {}ms", method, path, status, ms);
            } else if (status >= 400) {
                log.warn("{} {} → {} {}ms", method, path, status, ms);
            } else {
                log.info("{} {} → {} {}ms", method, path, status, ms);
            }
        });
    }
}

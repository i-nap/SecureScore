package com.securescore.gateway.filter;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.InvalidKeySpecException;
import java.security.spec.X509EncodedKeySpec;
import java.time.Instant;
import java.util.Base64;
import java.util.List;

/**
 * Global JWT validation filter.
 *
 * Validates RS256 tokens issued by java-auth (same RSA key pair as Go auth).
 * Public paths (auth, webhooks, health) bypass JWT validation.
 * On success, user identity is forwarded downstream as X-User-* headers.
 */
@Component
public class JwtAuthFilter implements GlobalFilter, Ordered {

    private static final Logger log = LoggerFactory.getLogger(JwtAuthFilter.class);

    private static final List<String> PUBLIC_PREFIXES = List.of(
        "/api/auth/",
        "/api/webhook/",
        "/api/branch/",
        "/api/customer/",
        "/api/hq/",
        "/ws/",
        "/health",
        "/actuator/"
    );

    @Value("${gateway.jwt.public-key-path:/secrets/jwt_public.pem}")
    private String publicKeyPath;

    @Value("${gateway.jwt.issuer:securescore-auth}")
    private String issuer;

    @Value("${gateway.jwt.audience:securescore-api}")
    private String audience;

    private RSAPublicKey rsaPublicKey;

    // Read and parse the shared RSA public key once at startup.
    @PostConstruct
    public void loadPublicKey() throws IOException, NoSuchAlgorithmException, InvalidKeySpecException {
        String pem = Files.readString(Path.of(publicKeyPath));
        String base64 = pem
            .replaceAll("-----BEGIN.*?-----", "")
            .replaceAll("-----END.*?-----", "")
            .replaceAll("\\s+", "");
        byte[] der = Base64.getDecoder().decode(base64);
        rsaPublicKey = (RSAPublicKey) KeyFactory.getInstance("RSA")
            .generatePublic(new X509EncodedKeySpec(der));
        log.info("Gateway RSA public key loaded from {}", publicKeyPath);
    }

    // Run early in the chain, before routing filters.
    @Override
    public int getOrder() {
        return -100;
    }

    // Verify the bearer token and, on success, forward identity downstream as X-User-* headers.
    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getURI().getPath();

        if (isPublic(path)) {
            return chain.filter(exchange);
        }

        String authHeader = exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION);

        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            log.warn("Missing Authorization header for path: {}", path);
            return unauthorized(exchange, "Missing or malformed Authorization header");
        }

        String token = authHeader.substring(7);

        try {
            Claims claims = Jwts.parser()
                .verifyWith(rsaPublicKey)
                .requireIssuer(issuer)
                .requireAudience(audience)
                .build()
                .parseSignedClaims(token)
                .getPayload();

            ServerHttpRequest mutatedRequest = exchange.getRequest().mutate()
                .header("X-User-ID",    safeGet(claims, "sub",    claims.getSubject()))
                .header("X-User-Role",  safeGet(claims, "role",   ""))
                .header("X-Branch-ID",  safeGet(claims, "branch", ""))
                .header("X-User-Email", safeGet(claims, "email",  ""))
                .build();

            log.debug("JWT valid — user={} role={} path={}",
                claims.getSubject(), claims.get("role"), path);

            return chain.filter(exchange.mutate().request(mutatedRequest).build());

        } catch (JwtException e) {
            log.warn("Invalid JWT for path {}: {}", path, e.getMessage());
            return unauthorized(exchange, "Invalid or expired token");
        } catch (Exception e) {
            log.error("JWT filter error for path {}: {}", path, e.getMessage(), e);
            return unauthorized(exchange, "Token validation failed");
        }
    }

    // True for paths that skip auth (login, webhooks, health, etc.).
    private boolean isPublic(String path) {
        return PUBLIC_PREFIXES.stream().anyMatch(path::startsWith);
    }

    // Short-circuit the request with a 401 JSON body.
    private Mono<Void> unauthorized(ServerWebExchange exchange, String message) {
        ServerHttpResponse response = exchange.getResponse();
        response.setStatusCode(HttpStatus.UNAUTHORIZED);
        response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
        String body = String.format(
            "{\"status\":401,\"error\":\"Unauthorized\",\"message\":\"%s\",\"timestamp\":\"%s\"}",
            message, Instant.now());
        DataBuffer buffer = response.bufferFactory()
            .wrap(body.getBytes(StandardCharsets.UTF_8));
        return response.writeWith(Mono.just(buffer));
    }

    // Read a claim as a string, falling back to a default when it's missing.
    private String safeGet(Claims claims, String key, String defaultVal) {
        Object val = claims.get(key);
        return val != null ? val.toString() : defaultVal;
    }
}

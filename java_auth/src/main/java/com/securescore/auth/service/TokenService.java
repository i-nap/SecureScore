package com.securescore.auth.service;

import com.securescore.auth.domain.RefreshToken;
import com.securescore.auth.domain.User;
import com.securescore.auth.dto.TokenPair;
import com.securescore.auth.repository.RefreshTokenRepository;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;

import static java.nio.charset.StandardCharsets.UTF_8;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

@Service
@RequiredArgsConstructor
public class TokenService {

    private final RSAPrivateKey rsaPrivateKey;
    private final RSAPublicKey rsaPublicKey;
    private final RefreshTokenRepository refreshTokenRepo;
    private final StringRedisTemplate redis;

    @Value("${auth.jwt.issuer:securescore-auth}")
    private String issuer;

    @Value("${auth.jwt.audience:securescore-api}")
    private String audience;

    @Value("${auth.jwt.access-ttl-seconds:900}")
    private long accessTtlSeconds;

    @Value("${auth.jwt.refresh-ttl-seconds:604800}")
    private long refreshTtlSeconds;

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    // Mint a signed RS256 access JWT plus an opaque, hashed-at-rest refresh token in one family.
    @Transactional
    public TokenPair issueTokenPair(User user, UUID family) {
        UUID resolvedFamily = (family != null) ? family : UUID.randomUUID();
        Instant now = Instant.now();
        Instant accessExp = now.plusSeconds(accessTtlSeconds);
        String jti = UUID.randomUUID().toString();

        String accessToken = Jwts.builder()
            .issuer(issuer)
            .subject(user.getId().toString())
            .audience().add(audience).and()
            .expiration(java.util.Date.from(accessExp))
            .issuedAt(java.util.Date.from(now))
            .id(jti)
            .claim("uid", user.getId().toString())
            .claim("role", user.getRole())
            .claim("branch", user.getBranchCode())
            .signWith(rsaPrivateKey, Jwts.SIG.RS256)
            .compact();

        // Opaque refresh token: 32 random bytes hex-encoded
        byte[] rawBytes = new byte[32];
        SECURE_RANDOM.nextBytes(rawBytes);
        String rawRefresh = HexFormat.of().formatHex(rawBytes);
        String tokenHash = sha256Hex(rawRefresh);

        RefreshToken rt = new RefreshToken();
        rt.setUserId(user.getId());
        rt.setTokenHash(tokenHash);
        rt.setFamily(resolvedFamily);
        rt.setIssuedAt(now);
        rt.setExpiresAt(now.plusSeconds(refreshTtlSeconds));
        refreshTokenRepo.save(rt);

        return TokenPair.of(accessToken, rawRefresh, accessExp);
    }

    // Verify signature, issuer and audience, returning the claims or throwing on any tamper.
    public Claims validateAccessToken(String tokenStr) {
        try {
            return Jwts.parser()
                .verifyWith(rsaPublicKey)
                .requireIssuer(issuer)
                .requireAudience(audience)
                .build()
                .parseSignedClaims(tokenStr)
                .getPayload();
        } catch (JwtException e) {
            throw new TokenException("invalid_token", e.getMessage());
        }
    }

    // Has this access token's id been blacklisted in Redis?
    public boolean isJtiRevoked(String jti) {
        return Boolean.TRUE.equals(redis.hasKey("revoked_jti:" + jti));
    }

    // Blacklist an access token's id until it would have expired anyway.
    public void revokeJti(String jti) {
        redis.opsForValue().set("revoked_jti:" + jti, "1",
            Duration.ofSeconds(accessTtlSeconds));
    }

    // Look up a refresh token by the hash of its raw value (we never store the raw token).
    public Optional<RefreshToken> findAndValidateRefreshToken(String rawToken) {
        String hash = sha256Hex(rawToken);
        return refreshTokenRepo.findByTokenHash(hash);
    }

    // Mark a single refresh token revoked, stamping when and why.
    @Transactional
    public void revokeRefreshToken(UUID id, String reason) {
        refreshTokenRepo.findById(id).ifPresent(rt -> {
            rt.setRevoked(true);
            rt.setRevokedAt(Instant.now());
            rt.setRevokedReason(reason);
            refreshTokenRepo.save(rt);
        });
    }

    // Nuke every live token in a family at once — used when we suspect token theft.
    @Transactional
    public void revokeFamilyTokens(UUID family, String reason) {
        refreshTokenRepo.findByFamilyAndRevokedFalse(family).forEach(rt -> {
            rt.setRevoked(true);
            rt.setRevokedAt(Instant.now());
            rt.setRevokedReason(reason);
            refreshTokenRepo.save(rt);
        });
    }

    // Hex-encoded SHA-256 — how we fingerprint refresh tokens before storing them.
    public static String sha256Hex(String input) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(input.getBytes(UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    // Token-layer error with a stable code for callers to branch on.
    public static class TokenException extends RuntimeException {
        private final String code;
        public TokenException(String code, String message) {
            super(message);
            this.code = code;
        }
        // The stable error code.
        public String getCode() { return code; }
    }
}

package com.securescore.auth.service;

import com.securescore.auth.domain.LoginEvent;
import com.securescore.auth.domain.RefreshToken;
import com.securescore.auth.domain.User;
import com.securescore.auth.dto.LoginRequest;
import com.securescore.auth.dto.RegisterRequest;
import com.securescore.auth.dto.TokenPair;
import com.securescore.auth.repository.LoginEventRepository;
import com.securescore.auth.repository.UserRepository;
import io.jsonwebtoken.Claims;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class AuthService {

    private static final int MAX_FAILED_ATTEMPTS = 5;

    private final UserRepository userRepo;
    private final LoginEventRepository loginEventRepo;
    private final TokenService tokenService;
    private final Argon2Service argon2;

    // Verify credentials, handle lockout/failed-attempt counting, then hand back a fresh token pair.
    @Transactional
    public TokenPair login(LoginRequest req, String ip, String userAgent) {
        Optional<User> found = userRepo.findByUsername(req.username());

        if (found.isEmpty()) {
            argon2.dummyVerify(); // constant-time: prevent username enumeration
            audit(null, req.username(), false, "user_not_found", ip, userAgent);
            throw new AuthException("invalid_credentials", "username or password is incorrect");
        }

        User user = found.get();
        boolean match = argon2.verify(req.password(), user.getPasswordHash());

        if (!match) {
            userRepo.incrementFailedAttempts(user.getId());
            if (user.getFailedAttempts() + 1 >= MAX_FAILED_ATTEMPTS) {
                userRepo.lockAccount(user.getId(), Instant.now());
                log.warn("Account locked due to failed attempts: user={}", user.getId());
            }
            audit(user.getId(), user.getUsername(), false, "wrong_password", ip, userAgent);
            throw new AuthException("invalid_credentials", "username or password is incorrect");
        }

        if (user.isLocked()) {
            audit(user.getId(), user.getUsername(), false, "account_locked", ip, userAgent);
            throw new AuthException("account_locked", "account has been locked due to too many failed attempts");
        }
        if (!user.isActive()) {
            audit(user.getId(), user.getUsername(), false, "account_inactive", ip, userAgent);
            throw new AuthException("account_inactive", "account is not active");
        }

        if (user.getFailedAttempts() > 0) {
            userRepo.resetFailedAttempts(user.getId());
        }
        userRepo.updateLastLogin(user.getId(), Instant.now());

        audit(user.getId(), user.getUsername(), true, null, ip, userAgent);
        return tokenService.issueTokenPair(user, null);
    }

    // Rotate a refresh token: reject reuse of a revoked one (theft), else mint a new pair in the same family.
    @Transactional
    public TokenPair refresh(String rawRefreshToken) {
        Optional<RefreshToken> found = tokenService.findAndValidateRefreshToken(rawRefreshToken);

        if (found.isEmpty()) {
            throw new AuthException("token_not_found", "token not found");
        }

        RefreshToken rt = found.get();

        if (rt.isRevoked()) {
            // Token reuse detected — revoke entire family (theft detection)
            log.warn("Refresh token reuse detected — revoking family={}", rt.getFamily());
            tokenService.revokeFamilyTokens(rt.getFamily(), "theft_detection");
            throw new AuthException("token_revoked", "token has been revoked");
        }

        if (Instant.now().isAfter(rt.getExpiresAt())) {
            throw new AuthException("token_expired", "token has expired");
        }

        tokenService.revokeRefreshToken(rt.getId(), "rotated");

        User user = userRepo.findById(rt.getUserId())
            .orElseThrow(() -> new AuthException("user_not_found", "user not found"));

        if (user.isLocked())  throw new AuthException("account_locked", "account is locked");
        if (!user.isActive()) throw new AuthException("account_inactive", "account is inactive");

        return tokenService.issueTokenPair(user, rt.getFamily());
    }

    // Best-effort logout: revoke the access token's jti and its refresh token, ignoring already-dead tokens.
    @Transactional
    public void logout(String bearerToken, String rawRefreshToken) {
        if (bearerToken != null && !bearerToken.isBlank()) {
            try {
                Claims claims = tokenService.validateAccessToken(bearerToken);
                tokenService.revokeJti(claims.getId());
            } catch (TokenService.TokenException ignored) {
                // Already invalid — still proceed to revoke refresh token
            }
        }

        if (rawRefreshToken != null && !rawRefreshToken.isBlank()) {
            tokenService.findAndValidateRefreshToken(rawRefreshToken).ifPresent(rt -> {
                if (!rt.isRevoked()) {
                    tokenService.revokeRefreshToken(rt.getId(), "logout");
                }
            });
        }
    }

    // Admin-only user creation — the caller's JWT must be valid, unrevoked, and carry the admin role.
    @Transactional
    public User register(String callerJwt, RegisterRequest req) {
        Claims claims = tokenService.validateAccessToken(callerJwt);
        if (tokenService.isJtiRevoked(claims.getId())) {
            throw new AuthException("token_revoked", "token has been revoked");
        }
        String callerRole = claims.get("role", String.class);
        if (!"admin".equals(callerRole)) {
            throw new AuthException("forbidden", "insufficient permissions");
        }
        return createUser(req);
    }

    // First-run only: create the very first admin, but slam the door once any user exists.
    @Transactional
    public User bootstrap(RegisterRequest req) {
        if (userRepo.count() > 0) {
            throw new AuthException("forbidden", "system already has users — bootstrap closed");
        }
        return createUser(req.username() != null ? req : req, "admin");
    }

    // ---------------------------------------------------------------------------

    // Convenience overload — use the role carried on the request itself.
    private User createUser(RegisterRequest req) {
        return createUser(req, req.role());
    }

    // Build and persist a new user, mapping the DB unique-violation back to a clean duplicate error.
    private User createUser(RegisterRequest req, String role) {
        if (userRepo.findByUsername(req.username()).isPresent()) {
            throw new AuthException("duplicate_user", "username or email already exists");
        }

        User user = new User();
        user.setUsername(req.username());
        user.setEmail(req.email());
        user.setPasswordHash(argon2.hash(req.password()));
        user.setRole(role);
        user.setBranchCode(req.branch_code() != null ? req.branch_code() : "");
        user.setActive(true);
        user.setLocked(false);
        user.setPasswordChangedAt(Instant.now());

        try {
            return userRepo.save(user);
        } catch (Exception e) {
            if (e.getMessage() != null && (e.getMessage().contains("23505") || e.getMessage().contains("unique"))) {
                throw new AuthException("duplicate_user", "username or email already exists");
            }
            throw e;
        }
    }

    // Write one login-attempt row to the audit trail, success or failure.
    private void audit(UUID userId, String username, boolean success, String reason, String ip, String ua) {
        LoginEvent event = new LoginEvent();
        event.setUserId(userId);
        event.setUsername(username);
        event.setSuccess(success);
        event.setFailureReason(reason);
        event.setIpAddress(ip != null ? ip : "");
        event.setUserAgent(ua != null ? ua : "");
        event.setOccurredAt(Instant.now());
        loginEventRepo.save(event);
    }

    // Domain error carrying a stable machine-readable code alongside the human message.
    public static class AuthException extends RuntimeException {
        private final String code;
        public AuthException(String code, String message) {
            super(message);
            this.code = code;
        }
        // The stable error code clients switch on.
        public String getCode() { return code; }
    }
}

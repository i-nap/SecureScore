package com.securescore.auth.controller;

import com.securescore.auth.dto.LoginRequest;
import com.securescore.auth.dto.RegisterRequest;
import com.securescore.auth.dto.TokenPair;
import com.securescore.auth.domain.User;
import com.securescore.auth.service.AuthService;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Arrays;
import java.util.Map;

@RestController
@RequestMapping("/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    // POST /auth/login — authenticate and drop the refresh token into an HttpOnly cookie.
    @PostMapping("/login")
    public ResponseEntity<TokenPair> login(@Valid @RequestBody LoginRequest req,
                                           HttpServletRequest httpReq,
                                           HttpServletResponse httpRes) {
        String ip = resolveClientIp(httpReq);
        String ua = httpReq.getHeader("User-Agent");
        TokenPair pair = authService.login(req, ip, ua);
        setRefreshCookie(httpRes, pair.refreshToken());
        return ResponseEntity.ok(pair);
    }

    // POST /auth/refresh — swap the cookie's refresh token for a new access/refresh pair.
    @PostMapping("/refresh")
    public ResponseEntity<TokenPair> refresh(HttpServletRequest httpReq,
                                             HttpServletResponse httpRes) {
        String rawToken = extractRefreshToken(httpReq);
        if (rawToken == null || rawToken.isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        TokenPair pair = authService.refresh(rawToken);
        setRefreshCookie(httpRes, pair.refreshToken());
        return ResponseEntity.ok(pair);
    }

    // POST /auth/logout — revoke the current tokens and clear the refresh cookie.
    @PostMapping("/logout")
    public ResponseEntity<Map<String, String>> logout(HttpServletRequest httpReq,
                                                       HttpServletResponse httpRes) {
        String bearer = extractBearerToken(httpReq);
        String rawRefresh = extractRefreshToken(httpReq);
        authService.logout(bearer, rawRefresh);
        clearRefreshCookie(httpRes);
        return ResponseEntity.ok(Map.of("message", "logged out successfully"));
    }

    // POST /auth/register — admin-only endpoint to create another user.
    @PostMapping("/register")
    public ResponseEntity<Map<String, Object>> register(@Valid @RequestBody RegisterRequest req,
                                                         HttpServletRequest httpReq) {
        String bearer = extractBearerToken(httpReq);
        if (bearer == null || bearer.isBlank()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "unauthorized", "detail", "authorization header required"));
        }
        User user = authService.register(bearer, req);
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
            "id", user.getId(),
            "username", user.getUsername(),
            "email", user.getEmail(),
            "role", user.getRole()
        ));
    }

    // POST /auth/setup — one-time first-admin creation; disables itself afterwards.
    @PostMapping("/setup")
    public ResponseEntity<Map<String, Object>> bootstrap(@Valid @RequestBody RegisterRequest req) {
        User user = authService.bootstrap(req);
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
            "id", user.getId(),
            "username", user.getUsername(),
            "role", user.getRole(),
            "message", "admin user created; /auth/setup is now disabled"
        ));
    }

    // Write the refresh token as an HttpOnly, SameSite=Strict, path-scoped cookie.
    private void setRefreshCookie(HttpServletResponse res, String token) {
        Cookie cookie = new Cookie("refresh_token", token);
        cookie.setHttpOnly(true);
        cookie.setPath("/auth");
        cookie.setMaxAge(7 * 24 * 60 * 60); // 7 days
        res.addCookie(cookie);
        // Append SameSite=Strict — Cookie API doesn't expose this directly
        String existing = res.getHeader("Set-Cookie");
        if (existing != null) {
            res.setHeader("Set-Cookie", existing + "; SameSite=Strict");
        }
    }

    // Expire the refresh cookie by setting it empty with max-age 0.
    private void clearRefreshCookie(HttpServletResponse res) {
        Cookie cookie = new Cookie("refresh_token", "");
        cookie.setHttpOnly(true);
        cookie.setPath("/auth");
        cookie.setMaxAge(0);
        res.addCookie(cookie);
    }

    // Pull the refresh_token value out of the request cookies, or null if absent.
    private String extractRefreshToken(HttpServletRequest req) {
        if (req.getCookies() != null) {
            return Arrays.stream(req.getCookies())
                .filter(c -> "refresh_token".equals(c.getName()))
                .map(Cookie::getValue)
                .findFirst()
                .orElse(null);
        }
        return null;
    }

    // Strip the "Bearer " prefix off the Authorization header, or null if not present.
    private String extractBearerToken(HttpServletRequest req) {
        String header = req.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            return header.substring(7);
        }
        return null;
    }

    // Prefer the first X-Forwarded-For hop (behind a proxy), else the socket address.
    private String resolveClientIp(HttpServletRequest req) {
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            return xff.split(",")[0].trim();
        }
        return req.getRemoteAddr();
    }
}

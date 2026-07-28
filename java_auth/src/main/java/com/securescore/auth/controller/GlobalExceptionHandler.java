package com.securescore.auth.controller;

import com.securescore.auth.service.AuthService;
import com.securescore.auth.service.TokenService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.Instant;
import java.util.Map;
import java.util.stream.Collectors;

@RestControllerAdvice
public class GlobalExceptionHandler {

    // Map each auth error code to the right HTTP status.
    @ExceptionHandler(AuthService.AuthException.class)
    public ResponseEntity<Map<String, Object>> handleAuth(AuthService.AuthException ex) {
        HttpStatus status = switch (ex.getCode()) {
            case "forbidden" -> HttpStatus.FORBIDDEN;
            case "duplicate_user" -> HttpStatus.CONFLICT;
            case "invalid_credentials", "account_locked", "account_inactive",
                 "token_revoked", "token_expired", "token_invalid", "token_not_found",
                 "user_not_found" -> HttpStatus.UNAUTHORIZED;
            default -> HttpStatus.INTERNAL_SERVER_ERROR;
        };
        return ResponseEntity.status(status).body(errorBody(ex.getCode(), ex.getMessage()));
    }

    // Any token problem is a 401.
    @ExceptionHandler(TokenService.TokenException.class)
    public ResponseEntity<Map<String, Object>> handleToken(TokenService.TokenException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
            .body(errorBody(ex.getCode(), ex.getMessage()));
    }

    // Flatten bean-validation field errors into one readable 400 message.
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> handleValidation(MethodArgumentNotValidException ex) {
        String detail = ex.getBindingResult().getFieldErrors().stream()
            .map(f -> f.getField() + ": " + f.getDefaultMessage())
            .collect(Collectors.joining("; "));
        return ResponseEntity.badRequest().body(errorBody("validation_error", detail));
    }

    // Catch-all: never leak internals, just a generic 500.
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGeneral(Exception ex) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(errorBody("internal_error", "an unexpected error occurred"));
    }

    // Consistent error envelope: code, detail, timestamp.
    private Map<String, Object> errorBody(String error, String detail) {
        return Map.of(
            "error", error,
            "detail", detail,
            "timestamp", Instant.now().toString()
        );
    }
}

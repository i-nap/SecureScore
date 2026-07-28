package com.securescore.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
    @NotBlank @Size(min = 3, max = 50) String username,
    @NotBlank @Email String email,
    @NotBlank @Size(min = 12, max = 128) String password,
    @NotBlank @Pattern(regexp = "customer|teller|branch_manager|credit_officer|auditor|admin") String role,
    String branch_code
) {}

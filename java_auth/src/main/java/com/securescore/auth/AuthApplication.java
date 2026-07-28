package com.securescore.auth;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.security.servlet.SecurityAutoConfiguration;

@SpringBootApplication(exclude = {SecurityAutoConfiguration.class})
public class AuthApplication {
    // Boot the auth service (Spring Security auto-config off — we roll our own JWT flow).
    public static void main(String[] args) {
        SpringApplication.run(AuthApplication.class, args);
    }
}

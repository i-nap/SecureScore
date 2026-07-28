package com.securescore.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class GatewayApplication {
    // Boot the API gateway (routing, JWT filter, rate limiting, circuit breakers).
    public static void main(String[] args) {
        SpringApplication.run(GatewayApplication.class, args);
    }
}

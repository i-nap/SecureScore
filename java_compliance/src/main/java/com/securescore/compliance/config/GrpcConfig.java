package com.securescore.compliance.config;

import ai.inference.v1.InferenceServiceGrpc;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.concurrent.TimeUnit;

@Configuration
@ConditionalOnProperty(name = "compliance.grpc.enabled", havingValue = "true", matchIfMissing = true)
public class GrpcConfig {

    private static final Logger log = LoggerFactory.getLogger(GrpcConfig.class);

    @Value("${compliance.grpc.ai-addr:localhost:50051}")
    private String aiGrpcAddr;

    private ManagedChannel channel;

    @Bean
    public ManagedChannel aiGrpcChannel() {
        String[] parts = aiGrpcAddr.split(":", 2);
        String host = parts[0];
        int port = parts.length > 1 ? Integer.parseInt(parts[1]) : 50051;

        channel = ManagedChannelBuilder.forAddress(host, port)
            .usePlaintext()
            .keepAliveTime(30, TimeUnit.SECONDS)
            .keepAliveTimeout(10, TimeUnit.SECONDS)
            .build();

        log.info("gRPC channel created → {}:{}", host, port);
        return channel;
    }

    @Bean
    public InferenceServiceGrpc.InferenceServiceBlockingStub inferenceStub(ManagedChannel aiGrpcChannel) {
        return InferenceServiceGrpc.newBlockingStub(aiGrpcChannel);
    }

    @PreDestroy
    public void shutdown() throws InterruptedException {
        if (channel != null && !channel.isShutdown()) {
            channel.shutdown().awaitTermination(5, TimeUnit.SECONDS);
            log.info("gRPC channel shut down");
        }
    }
}

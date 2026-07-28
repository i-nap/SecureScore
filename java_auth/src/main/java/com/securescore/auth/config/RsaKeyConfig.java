package com.securescore.auth.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.InvalidKeySpecException;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

@Configuration
public class RsaKeyConfig {

    @Value("${auth.jwt.private-key-path:/secrets/jwt_private.pem}")
    private String privateKeyPath;

    @Value("${auth.jwt.public-key-path:/secrets/jwt_public.pem}")
    private String publicKeyPath;

    // Load the PKCS#8 private key used to sign access tokens.
    @Bean
    public RSAPrivateKey rsaPrivateKey() throws IOException, NoSuchAlgorithmException, InvalidKeySpecException {
        String pem = Files.readString(Path.of(privateKeyPath));
        byte[] der = decodePem(pem);
        return (RSAPrivateKey) KeyFactory.getInstance("RSA")
            .generatePrivate(new PKCS8EncodedKeySpec(der));
    }

    // Load the X.509 public key used to verify access tokens.
    @Bean
    public RSAPublicKey rsaPublicKey() throws IOException, NoSuchAlgorithmException, InvalidKeySpecException {
        String pem = Files.readString(Path.of(publicKeyPath));
        byte[] der = decodePem(pem);
        return (RSAPublicKey) KeyFactory.getInstance("RSA")
            .generatePublic(new X509EncodedKeySpec(der));
    }

    // Strip the PEM header/footer and whitespace, then base64-decode to raw DER.
    private byte[] decodePem(String pem) {
        String base64 = pem
            .replaceAll("-----BEGIN.*?-----", "")
            .replaceAll("-----END.*?-----", "")
            .replaceAll("\\s+", "");
        return Base64.getDecoder().decode(base64);
    }
}

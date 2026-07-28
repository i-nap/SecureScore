package com.securescore.auth.service;

import org.bouncycastle.crypto.generators.Argon2BytesGenerator;
import org.bouncycastle.crypto.params.Argon2Parameters;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * Argon2id hashing compatible with Go's golang.org/x/crypto/argon2 format:
 *   $argon2id$v=19$m=<mem>,t=<iter>,p=<par>$<salt_b64_raw>$<hash_b64_raw>
 * where raw = standard base64 alphabet without padding.
 */
@Service
public class Argon2Service {

    @Value("${auth.argon2.memory:65536}")
    private int memory;

    @Value("${auth.argon2.iterations:3}")
    private int iterations;

    @Value("${auth.argon2.parallelism:4}")
    private int parallelism;

    @Value("${auth.argon2.salt-length:16}")
    private int saltLength;

    @Value("${auth.argon2.key-length:32}")
    private int keyLength;

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    // Hash a password with a fresh random salt into the Go-compatible argon2id string.
    public String hash(String plaintext) {
        byte[] salt = new byte[saltLength];
        SECURE_RANDOM.nextBytes(salt);
        byte[] hash = compute(plaintext.toCharArray(), salt, memory, iterations, parallelism, keyLength);
        return encode(salt, hash, memory, iterations, parallelism);
    }

    // Re-derive the hash from the encoded params and constant-time compare it.
    public boolean verify(String plaintext, String encoded) {
        try {
            String[] parts = encoded.split("\\$");
            // parts: ["", "argon2id", "v=19", "m=<>,t=<>,p=<>", "<salt>", "<hash>"]
            if (parts.length != 6 || !"argon2id".equals(parts[1])) return false;

            int[] params = parseParams(parts[3]);
            int mem = params[0], iter = params[1], par = params[2];

            byte[] salt = decodeRaw(parts[4]);
            byte[] expectedHash = decodeRaw(parts[5]);
            int kLen = expectedHash.length;

            byte[] computed = compute(plaintext.toCharArray(), salt, mem, iter, par, kLen);
            return MessageDigest.isEqual(expectedHash, computed);
        } catch (Exception e) {
            return false;
        }
    }

    // Constant-time dummy verify to normalise timing for non-existent users
    public void dummyVerify() {
        verify("dummy_password_that_will_never_match_anything",
            "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    }

    // Run the actual Argon2id KDF with the given cost parameters.
    private byte[] compute(char[] password, byte[] salt, int mem, int iter, int par, int kLen) {
        Argon2Parameters params = new Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
            .withVersion(Argon2Parameters.ARGON2_VERSION_13)
            .withSalt(salt)
            .withMemoryAsKB(mem)
            .withIterations(iter)
            .withParallelism(par)
            .build();

        Argon2BytesGenerator generator = new Argon2BytesGenerator();
        generator.init(params);
        byte[] output = new byte[kLen];
        generator.generateBytes(password, output);
        return output;
    }

    // Assemble the $argon2id$... string that stores salt, hash and cost params together.
    private String encode(byte[] salt, byte[] hash, int mem, int iter, int par) {
        return "$argon2id$v=19$m=" + mem + ",t=" + iter + ",p=" + par
            + "$" + encodeRaw(salt)
            + "$" + encodeRaw(hash);
    }

    // Base64 without padding — the alphabet Go's argon2 format expects.
    private String encodeRaw(byte[] bytes) {
        return Base64.getEncoder().withoutPadding().encodeToString(bytes);
    }

    // Decode raw (unpadded) base64, re-adding the padding Java's decoder insists on.
    private byte[] decodeRaw(String encoded) {
        // Raw base64 has no padding; add it back for Java's decoder
        int pad = (4 - encoded.length() % 4) % 4;
        return Base64.getDecoder().decode(encoded + "=".repeat(pad));
    }

    // Pull memory/iterations/parallelism out of the "m=..,t=..,p=.." segment.
    private int[] parseParams(String paramStr) {
        // "m=65536,t=3,p=4"
        String[] kv = paramStr.split(",");
        int mem = 0, iter = 0, par = 0;
        for (String s : kv) {
            if (s.startsWith("m=")) mem = Integer.parseInt(s.substring(2));
            else if (s.startsWith("t=")) iter = Integer.parseInt(s.substring(2));
            else if (s.startsWith("p=")) par = Integer.parseInt(s.substring(2));
        }
        return new int[]{mem, iter, par};
    }
}

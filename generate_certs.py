"""
generate_certs.py — mTLS Certificate Authority & Certificate Generator
========================================================================
Creates a full Public Key Infrastructure (PKI) for the SecureScore
federated credit-scoring network:

  1.  CA root certificate  (ca.crt, ca.key)
  2.  HQ server certificate signed by the CA  (hq.crt, hq.key)
  3.  One client certificate per branch  (branch_<name>.crt, branch_<name>.key)

Both HQ and every edge node MUST present a cert signed by the same CA.
A rogue laptop that doesn't have a CA-signed cert is rejected at the
TLS handshake layer — before any Python code even runs.

Usage:
    python generate_certs.py                    # generates certs/ directory
    python generate_certs.py --out-dir my_certs # custom output

Security notes:
    • Private keys are NEVER committed to git (added to .gitignore)
    • In production, use HashiCorp Vault / AWS ACM for key management
    • Certs expire in 365 days by default
"""

from __future__ import annotations

import os
import argparse
from pathlib import Path
from datetime import datetime, timedelta, timezone

from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

# Branch names matching the BRANCH_TYPE dict in edge_node.py / hq_server.py
ALL_BRANCHES = [
    "Kathmandu", "Lalitpur", "Pokhara",
    "Bharatpur", "Biratnagar", "Butwal",
    "Hetauda", "Itahari", "Dharan",
    "Janakpur", "Birgunj", "Nepalgunj", "Sarlahi",
]


def _gen_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _write_key(key: rsa.RSAPrivateKey, path: Path):
    path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )


def _write_cert(cert: x509.Certificate, path: Path):
    path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))


def generate_ca(out_dir: Path, days: int = 365):
    """Generate a self-signed CA root certificate."""
    key = _gen_key()
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "NP"),
        x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "Bagmati"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "SecureScore CA"),
        x509.NameAttribute(NameOID.COMMON_NAME, "SecureScore Root CA"),
    ])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.now(timezone.utc))
        .not_valid_after(datetime.now(timezone.utc) + timedelta(days=days))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .sign(key, hashes.SHA256())
    )
    _write_key(key, out_dir / "ca.key")
    _write_cert(cert, out_dir / "ca.crt")
    print(f"  ✓ CA:   {out_dir / 'ca.crt'}")
    return key, cert


def generate_server_cert(
    ca_key: rsa.RSAPrivateKey,
    ca_cert: x509.Certificate,
    out_dir: Path,
    days: int = 365,
):
    """Generate HQ server certificate signed by the CA."""
    key = _gen_key()
    subject = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "NP"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "SecureScore HQ"),
        x509.NameAttribute(NameOID.COMMON_NAME, "hq.securescore.local"),
    ])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_cert.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.now(timezone.utc))
        .not_valid_after(datetime.now(timezone.utc) + timedelta(days=days))
        .add_extension(
            x509.SubjectAlternativeName([
                x509.DNSName("localhost"),
                x509.DNSName("hq.securescore.local"),
                x509.DNSName("hq-server"),
                x509.IPAddress(__import__("ipaddress").IPv4Address("127.0.0.1")),
            ]),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )
    _write_key(key, out_dir / "hq.key")
    _write_cert(cert, out_dir / "hq.crt")
    print(f"  ✓ HQ:   {out_dir / 'hq.crt'}")
    return key, cert


def generate_branch_cert(
    branch_name: str,
    ca_key: rsa.RSAPrivateKey,
    ca_cert: x509.Certificate,
    out_dir: Path,
    days: int = 365,
):
    """Generate a branch client certificate signed by the CA."""
    slug = branch_name.lower().replace(" ", "_")
    key = _gen_key()
    subject = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "NP"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, f"SecureScore Branch {branch_name}"),
        x509.NameAttribute(NameOID.COMMON_NAME, f"branch.{slug}.securescore.local"),
    ])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_cert.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.now(timezone.utc))
        .not_valid_after(datetime.now(timezone.utc) + timedelta(days=days))
        .add_extension(
            x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.CLIENT_AUTH]),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )
    _write_key(key, out_dir / f"branch_{slug}.key")
    _write_cert(cert, out_dir / f"branch_{slug}.crt")
    print(f"  ✓ Branch: {branch_name:12s}  →  branch_{slug}.crt")


def main():
    parser = argparse.ArgumentParser(description="Generate mTLS certs for SecureScore network")
    parser.add_argument("--out-dir", default="certs", help="Output directory (default: certs/)")
    parser.add_argument("--days", type=int, default=365, help="Certificate validity in days")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'═' * 60}")
    print(f"  SecureScore mTLS Certificate Generator")
    print(f"  Output: {out_dir.resolve()}")
    print(f"{'═' * 60}\n")

    ca_key, ca_cert = generate_ca(out_dir, args.days)
    generate_server_cert(ca_key, ca_cert, out_dir, args.days)

    print()
    for branch in ALL_BRANCHES:
        generate_branch_cert(branch, ca_key, ca_cert, out_dir, args.days)

    print(f"\n{'═' * 60}")
    print(f"  Generated {2 + len(ALL_BRANCHES)} certificates")
    print(f"  CA cert:  {out_dir / 'ca.crt'}")
    print(f"  HQ cert:  {out_dir / 'hq.crt'}")
    print(f"  Branches: {len(ALL_BRANCHES)} client certs")
    print(f"\n  ⚠  NEVER commit *.key files to git!")
    print(f"{'═' * 60}\n")


if __name__ == "__main__":
    main()

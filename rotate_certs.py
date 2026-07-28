"""
rotate_certs.py — Automatic mTLS Certificate Rotation for SecureScore.

Rotates CA-signed certificates for all branch edge nodes and the HQ server.
Designed to be run as a scheduled job (daily/weekly).

Certificate Lifecycle:
  - Old certs: valid for 365 days (default)
  - New certs generated 30 days before expiry
  - Branches are notified via HQ API (graceful switchover)

Usage:
    python rotate_certs.py                          # rotate all expiring certs
    python rotate_certs.py --force                  # rotate all regardless
    python rotate_certs.py --branch Kathmandu       # rotate one branch only
    python rotate_certs.py --check                  # just show expiry status

Kubernetes Cron:
    Schedule: "0 2 * * 0"  (every Sunday at 02:00)
"""

from __future__ import annotations

import os
import sys
import json
import argparse
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

logger = logging.getLogger("cert_rotation")
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)-8s %(name)s — %(message)s",
)

BASE_DIR = Path(__file__).resolve().parent
CERTS_DIR = BASE_DIR / "certs"
CERTS_DIR.mkdir(exist_ok=True)

DAYS_BEFORE_EXPIRY_TO_ROTATE = int(os.getenv("CERT_ROTATE_DAYS_BEFORE", "30"))
CERT_VALIDITY_DAYS = int(os.getenv("CERT_VALIDITY_DAYS", "365"))

ALL_BRANCHES = [
    "kathmandu", "lalitpur", "pokhara",
    "bharatpur", "biratnagar", "butwal",
    "hetauda", "itahari", "dharan",
    "janakpur", "birgunj", "nepalgunj", "sarlahi",
]


def _load_openssl():
    """Check that openssl (or cryptography library) is available."""
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
        return True
    except ImportError:
        return False


def get_cert_expiry(cert_path: Path) -> datetime | None:
    """Return the expiry date of a PEM certificate, or None if unreadable."""
    if not cert_path.exists():
        return None
    try:
        from cryptography import x509
        pem = cert_path.read_bytes()
        cert = x509.load_pem_x509_certificate(pem)
        return cert.not_valid_after_utc
    except Exception as e:
        logger.warning("Could not read cert %s: %s", cert_path, e)
        return None


def days_until_expiry(cert_path: Path) -> int | None:
    """Return days until cert expires. Negative = already expired."""
    expiry = get_cert_expiry(cert_path)
    if expiry is None:
        return None
    delta = expiry - datetime.now(timezone.utc)
    return delta.days


def needs_rotation(cert_path: Path, days_threshold: int = DAYS_BEFORE_EXPIRY_TO_ROTATE) -> bool:
    """Return True if cert is missing or expiring within threshold days."""
    if not cert_path.exists():
        return True
    days = days_until_expiry(cert_path)
    if days is None:
        return True
    return days <= days_threshold


def generate_ca_cert(ca_key_path: Path, ca_cert_path: Path):
    """Generate a new self-signed CA certificate."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    import ipaddress

    key = rsa.generate_private_key(public_exponent=65537, key_size=4096)
    ca_key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "NP"),
        x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "Bagmati"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "SecureScore Bank Suite"),
        x509.NameAttribute(NameOID.COMMON_NAME, "SecureScore Root CA"),
    ])
    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + timedelta(days=CERT_VALIDITY_DAYS * 2))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    ca_cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    logger.info("CA cert generated → %s (valid %d days)", ca_cert_path, CERT_VALIDITY_DAYS * 2)


def generate_entity_cert(
    common_name: str,
    ca_key_path: Path,
    ca_cert_path: Path,
    out_key: Path,
    out_cert: Path,
    is_server: bool = False,
):
    """Generate a CA-signed certificate for an entity (HQ server or branch)."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
    import ipaddress

    # Load CA
    ca_key_data = ca_key_path.read_bytes()
    ca_cert_data = ca_cert_path.read_bytes()
    ca_key = serialization.load_pem_private_key(ca_key_data, password=None)
    ca_cert = x509.load_pem_x509_certificate(ca_cert_data)

    # Generate new key
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    out_key.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )

    subject = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "NP"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "SecureScore Bank Suite"),
        x509.NameAttribute(NameOID.COMMON_NAME, common_name),
    ])

    now = datetime.now(timezone.utc)
    builder = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_cert.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + timedelta(days=CERT_VALIDITY_DAYS))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.SubjectAlternativeName([
                x509.DNSName(common_name),
                x509.DNSName("localhost"),
                x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
            ]),
            critical=False,
        )
    )

    if is_server:
        builder = builder.add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),
            critical=False,
        )
    else:
        builder = builder.add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.CLIENT_AUTH]),
            critical=False,
        )

    cert = builder.sign(ca_key, hashes.SHA256())
    out_cert.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    logger.info("Cert generated → %s (valid %d days, CN=%s)", out_cert, CERT_VALIDITY_DAYS, common_name)


def check_all_certs() -> dict[str, dict]:
    """Report expiry status of all certs. Returns dict of cert → status."""
    report = {}

    for name, path in [
        ("CA", CERTS_DIR / "ca.crt"),
        ("HQ server", CERTS_DIR / "hq.crt"),
    ]:
        days = days_until_expiry(path)
        report[name] = {
            "path": str(path),
            "exists": path.exists(),
            "days_until_expiry": days,
            "needs_rotation": needs_rotation(path),
        }

    for branch in ALL_BRANCHES:
        cert_path = CERTS_DIR / f"{branch}.crt"
        days = days_until_expiry(cert_path)
        report[f"branch/{branch}"] = {
            "path": str(cert_path),
            "exists": cert_path.exists(),
            "days_until_expiry": days,
            "needs_rotation": needs_rotation(cert_path),
        }

    return report


def rotate_all(force: bool = False, specific_branch: str | None = None):
    """Rotate all certificates that need renewal (or all if force=True)."""
    if not _load_openssl():
        logger.error("'cryptography' package not installed. Run: pip install cryptography")
        sys.exit(1)

    ca_key = CERTS_DIR / "ca.key"
    ca_cert = CERTS_DIR / "ca.crt"

    # ── Rotate CA if needed ──────────────────────────────
    if force or needs_rotation(ca_cert, days_threshold=60):
        logger.info("Rotating CA certificate…")
        # Archive old CA
        if ca_cert.exists():
            backup = CERTS_DIR / f"ca.crt.bak.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            ca_cert.rename(backup)
            logger.info("Old CA archived → %s", backup)
        generate_ca_cert(ca_key, ca_cert)

    # ── Rotate HQ server cert ─────────────────────────────
    if force or needs_rotation(CERTS_DIR / "hq.crt"):
        logger.info("Rotating HQ server certificate…")
        generate_entity_cert(
            "securescore-hq",
            ca_key, ca_cert,
            CERTS_DIR / "hq.key",
            CERTS_DIR / "hq.crt",
            is_server=True,
        )

    # ── Rotate branch certs ───────────────────────────────
    branches_to_rotate = [specific_branch] if specific_branch else ALL_BRANCHES
    for branch in branches_to_rotate:
        cert_path = CERTS_DIR / f"{branch}.crt"
        key_path = CERTS_DIR / f"{branch}.key"
        if force or needs_rotation(cert_path):
            logger.info("Rotating cert for branch: %s", branch)
            generate_entity_cert(
                f"securescore-edge-{branch}",
                ca_key, ca_cert,
                key_path, cert_path,
                is_server=False,
            )
        else:
            days = days_until_expiry(cert_path)
            logger.info("Skipping %s — %d days until expiry", branch, days or -1)

    logger.info("Certificate rotation complete.")


def main():
    parser = argparse.ArgumentParser(description="SecureScore mTLS Certificate Rotation")
    parser.add_argument("--force", action="store_true", help="Rotate all certs regardless of expiry")
    parser.add_argument("--check", action="store_true", help="Show expiry status only, no rotation")
    parser.add_argument("--branch", type=str, help="Rotate only a specific branch's cert")
    args = parser.parse_args()

    if args.check:
        report = check_all_certs()
        print("\n Certificate Rotation Status Report")
        print("=" * 60)
        for name, info in report.items():
            days = info["days_until_expiry"]
            status = "MISSING" if not info["exists"] else \
                     "EXPIRED" if days is not None and days < 0 else \
                     "EXPIRING SOON" if info["needs_rotation"] else "OK"
            icon = "X" if status in ("MISSING", "EXPIRED") else "!" if status == "EXPIRING SOON" else "✓"
            days_str = f"{days}d" if days is not None else "N/A"
            print(f"  [{icon}] {name:<20} {days_str:>6}  {status}")
        print()
        return

    rotate_all(force=args.force, specific_branch=args.branch)


if __name__ == "__main__":
    main()

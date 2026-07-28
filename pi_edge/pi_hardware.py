"""
pi_edge/pi_hardware.py

Raspberry Pi hardware telemetry.
Returns CPU temperature, memory, disk, and load stats.
Falls back gracefully on non-Pi systems (Windows/Mac/Linux PC).
"""

from __future__ import annotations

import os
import platform
import time
from datetime import datetime, timezone
from typing import Optional


def get_cpu_temperature() -> Optional[float]:
    """
    Read CPU temperature from the Pi thermal zone.
    Returns degrees Celsius as a float, or None on non-Pi systems.
    """
    thermal_path = "/sys/class/thermal/thermal_zone0/temp"
    try:
        with open(thermal_path) as f:
            return round(int(f.read().strip()) / 1000.0, 1)
    except (OSError, ValueError):
        return None


def get_hardware_snapshot() -> dict:
    """
    Return a dict of hardware metrics.
    Uses psutil when available; falls back to partial data without it.
    """
    cpu_temp = get_cpu_temperature()
    timestamp = datetime.now(timezone.utc).isoformat() + "Z"
    plat = platform.system()

    try:
        import psutil

        cpu_percent   = round(psutil.cpu_percent(interval=0.2), 1)
        mem           = psutil.virtual_memory()
        disk          = psutil.disk_usage("/")
        boot_time     = psutil.boot_time()
        uptime_sec    = int(time.time() - boot_time)

        try:
            load1, _, _ = os.getloadavg()
            load_avg_1m = round(load1, 2)
        except (AttributeError, OSError):
            load_avg_1m = None

        return {
            "cpu_temp_c":      cpu_temp,
            "cpu_percent":     cpu_percent,
            "memory_percent":  round(mem.percent, 1),
            "memory_used_mb":  round(mem.used / 1024 / 1024, 1),
            "memory_total_mb": round(mem.total / 1024 / 1024, 1),
            "disk_percent":    round(disk.percent, 1),
            "disk_used_gb":    round(disk.used / 1024 ** 3, 2),
            "disk_total_gb":   round(disk.total / 1024 ** 3, 2),
            "uptime_seconds":  uptime_sec,
            "load_avg_1m":     load_avg_1m,
            "platform":        plat,
            "timestamp":       timestamp,
        }
    except ImportError:
        # psutil not installed — return minimal snapshot
        return {
            "cpu_temp_c":  cpu_temp,
            "cpu_percent": None,
            "memory_percent": None,
            "memory_used_mb": None,
            "memory_total_mb": None,
            "disk_percent": None,
            "disk_used_gb": None,
            "disk_total_gb": None,
            "uptime_seconds": None,
            "load_avg_1m": None,
            "platform": plat,
            "timestamp": timestamp,
            "note": "psutil not installed — install with: pip install psutil",
        }

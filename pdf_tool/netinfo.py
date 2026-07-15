"""Best-effort MAC address lookup via the local ARP cache.

Only works when the client is on the same local network segment as this
server -- MAC addresses are link-layer and never cross a router, so this
returns nothing for clients reached through a reverse proxy, load balancer,
or over the public internet.
"""
import platform
import re
import subprocess

_MAC_RE_WINDOWS = re.compile(r"([0-9a-fA-F]{2}-){5}[0-9a-fA-F]{2}")


def lookup_mac_address(ip_address: str | None) -> str:
    if not ip_address:
        return ""
    try:
        if platform.system() == "Windows":
            return _lookup_windows(ip_address)
        return _lookup_linux(ip_address)
    except Exception:
        return ""


def _lookup_windows(ip_address: str) -> str:
    output = subprocess.run(
        ["arp", "-a", ip_address],
        capture_output=True,
        text=True,
        timeout=2,
        check=False,
    ).stdout
    match = _MAC_RE_WINDOWS.search(output)
    return match.group(0).replace("-", ":").lower() if match else ""


def _lookup_linux(ip_address: str) -> str:
    with open("/proc/net/arp") as handle:
        for line in handle.readlines()[1:]:
            fields = line.split()
            if len(fields) >= 4 and fields[0] == ip_address:
                mac = fields[3]
                if mac != "00:00:00:00:00:00":
                    return mac.lower()
    return ""

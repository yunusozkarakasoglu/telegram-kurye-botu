import re

from .constants import MAX_CALLBACK_BYTES, MAX_NUMBER, MAX_PAGE


def number(value, maximum=MAX_NUMBER):
    return isinstance(value, str) and bool(re.fullmatch(r"[0-9]{1,19}", value)) and int(value) <= maximum


def page_number(value):
    return number(value, MAX_PAGE)


def callback_valid(data):
    if not isinstance(data, str):
        return False
    try:
        return len(data.encode("utf-8")) <= MAX_CALLBACK_BYTES
    except UnicodeError:
        return False


def valid_coordinates(latitude, longitude):
    try:
        lat, lng = float(latitude), float(longitude)
    except (TypeError, ValueError):
        return False
    return -90 <= lat <= 90 and -180 <= lng <= 180 and not (lat == 0 and lng == 0)


MAP_COORD_PATTERNS = (
    r"[?&](?:q|ll|daddr|destination)=(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)",
    r"@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)",
    r"!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)",
    r"^\s*(-?\d{1,3}(?:[.,]\d+)?)\s*[, ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$",
)


def parse_location(text):
    """Harita bağlantısı veya 'lat,lng' metninden koordinat çıkarır."""
    if not isinstance(text, str):
        return None
    for pattern in MAP_COORD_PATTERNS:
        match = re.search(pattern, text)
        if not match:
            continue
        latitude = float(match[1].replace(",", "."))
        longitude = float(match[2].replace(",", "."))
        if valid_coordinates(latitude, longitude):
            return latitude, longitude
    return None


def call_number(phone):
    """Türkiye numaralarını arama için +90 biçimine çevirir; yabancı numarayı korur."""
    raw = (phone or "").strip()
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return ""
    explicit_international = raw.startswith("+") or digits.startswith("00")
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 12 and digits.startswith("90"):
        national = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        national = digits[1:]
    elif len(digits) == 10 and not explicit_international:
        national = digits
    else:
        return f"+{digits}"
    return f"+90 {national[:3]} {national[3:6]} {national[6:8]} {national[8:]}"


def dial_number(phone):
    """Telegram'ın tıklanabilir saydığı tek parça E.164 biçimi."""
    return call_number(phone).replace(" ", "")

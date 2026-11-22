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

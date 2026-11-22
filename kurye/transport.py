import json
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class APIError(Exception):
    def __init__(self, code, delay=None, description=""):
        self.code = code
        self.delay = delay
        self.description = description
        super().__init__(f"Telegram HTTP/API {code}")


class Telegram:
    def __init__(self, token):
        self.base = f"https://api.telegram.org/bot{token}/"

    def call(self, method, **data):
        request = Request(self.base + method, json.dumps(data).encode(),
                          {"Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=35) as response:
                result = json.load(response)
        except HTTPError as exc:
            try:
                result = json.load(exc)
            except (ValueError, OSError, HTTPException):
                raise APIError(exc.code) from None
        except (URLError, TimeoutError, OSError, ValueError, HTTPException):
            raise APIError(0) from None
        if not isinstance(result, dict) or "ok" not in result:
            raise APIError(0)
        if not result["ok"]:
            raise APIError(result["error_code"], result.get("parameters", {}).get("retry_after"), result.get("description", ""))
        return result["result"]



import argparse
import json
import logging
import sqlite3
import threading
import time
from pathlib import Path

from .constants import ROOT
from .core import Bot
from .database import connect
from .transport import APIError, Telegram

logger = logging.getLogger(__name__)


def sender_loop(path, config, username, stop):
    db = connect(path)
    bot = Bot(db, Telegram(config["token"]), config, username)
    try:
        while not stop.is_set():
            try:
                with db:
                    db.execute("BEGIN IMMEDIATE")
                    bot.expire_reservations()
                bot.drain()
            except (sqlite3.Error, APIError, OSError, ValueError) as exc:
                # Keep credentials and HTTP URLs out of exception logs.
                logger.error("Gönderim işçisi hatası: %s", type(exc).__name__)
            stop.wait(0.05)
    finally:
        db.close()


def valid_config(config):
    if not isinstance(config, dict):
        return False
    token, code, regions = (config.get(key) for key in ("token", "admin_code", "regions"))
    return (isinstance(token, str) and bool(token.strip()) and isinstance(code, str) and len(code) >= 20
            and isinstance(regions, list) and 1 <= len(regions) <= 50
            and all(isinstance(r, str) and 1 <= len(r.strip()) <= 50 for r in regions))


def main():
    parser = argparse.ArgumentParser(description="Telegram kurye botu")
    parser.add_argument("--ayarlar", type=Path, default=ROOT / "ayarlar.json")
    parser.add_argument("--veritabani", type=Path, default=ROOT / "kurye.sqlite3")
    args = parser.parse_args()
    try:
        config = json.loads(args.ayarlar.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        parser.error("Ayar dosyası okunamadı; UTF-8 JSON dosyasını kontrol edin.")
    if not valid_config(config):
        parser.error("Bot anahtarı, en az 20 karakterli yönetici kodu ve 1–50 geçerli bölge girin.")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    api = Telegram(config["token"])
    try:
        username = api.call("getMe")["username"]
    except APIError as exc:
        parser.exit(1, f"Telegram bağlantısı kurulamadı ({exc.code}).\n")
    db = connect(args.veritabani)
    bot = Bot(db, api, config, username)
    stop = threading.Event()
    sender = threading.Thread(target=sender_loop, args=(args.veritabani, config, username, stop), name="telegram-sender")
    sender.start()
    logger.info("@%s çalışıyor.", username)
    try:
        while True:
            try:
                offset = db.execute("SELECT offset FROM checkpoint").fetchone()[0]
                updates = api.call("getUpdates", offset=offset, timeout=20,
                                   allowed_updates=["message", "callback_query"])
                for update in updates:
                    bot.process(update)
            except APIError as exc:
                if exc.code == 409:
                    parser.exit(1, "Bot için başka bir süreç veya webhook etkin.\n")
                logger.warning("Güncelleme alınamadı (%s). Yeniden deneniyor.", exc.code)
                time.sleep(exc.delay or 3)
    except KeyboardInterrupt:
        logger.info("Bot durduruldu.")
    finally:
        stop.set()
        sender.join(timeout=40)
        db.close()

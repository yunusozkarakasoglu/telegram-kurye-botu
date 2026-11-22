"""Çalıştırma: python3 bot.py --ayarlar ayarlar.json --veritabani kurye.sqlite3"""
from kurye.core import Bot
from kurye.database import connect
from kurye.runner import main
from kurye.transport import APIError, Telegram

__all__ = ["APIError", "Bot", "Telegram", "connect", "main"]

if __name__ == "__main__":
    main()

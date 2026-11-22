"""Token/veritabanı içermeyen, taşınabilir v2 dağıtımı oluşturur."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "Telegram-Kurye-Botu-v2.zip"
ROOT_FILES = ("bot.py", "ayarlar.example.json", "Readme.md", "Kurulum-Kilavuzu.md")


def main():
    files = [ROOT / name for name in ROOT_FILES]
    files += sorted((ROOT / "kurye").glob("*.py"))
    with ZipFile(DESTINATION, "w", compression=ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(ROOT).as_posix())
    print(f"{DESTINATION.name}: {len(files)} dosya, {DESTINATION.stat().st_size} bayt")


if __name__ == "__main__":
    main()

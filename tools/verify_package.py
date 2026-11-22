"""Dağıtım kaynaklarını geçici alana çıkarıp aynı testleri onlara karşı çalıştırır."""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "Telegram-Kurye-Botu-v2.zip"


def main():
    ramdisk = "/dev/shm" if Path("/dev/shm").is_dir() else None
    with tempfile.TemporaryDirectory(prefix="kurye-package-check-", dir=ramdisk) as directory:
        stage = Path(directory)
        with ZipFile(ARCHIVE) as archive:
            names = archive.namelist()
            for name in names:
                path = Path(name)
                if path.is_absolute() or ".." in path.parts or name.endswith((".sqlite3", "ayarlar.json", ".pyc")):
                    raise ValueError("Güvenli olmayan dağıtım girdisi")
            archive.extractall(stage)
        # Tests and legacy reference are fixtures, not shipped production files.
        shutil.copytree(ROOT / "tests", stage / "tests", ignore=shutil.ignore_patterns("__pycache__", "results"))
        shutil.copy2(ROOT / "Telegram-Kurye-Botu.zip", stage)
        subprocess.run([sys.executable, "bot.py", "--help"], cwd=stage, check=True)
        subprocess.run([sys.executable, "-m", "compileall", "-q", "bot.py", "kurye"], cwd=stage, check=True)
        subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"], cwd=stage, check=True)
        print(f"PACKAGE_VERIFIED: {ARCHIVE.name}; {len(names)} shipped files")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Mini App ↔ yerel Worker (D1) uçtan uca doğrulaması."""
import asyncio, sys, pathlib
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8787"
OUT = pathlib.Path("/workspace/repo-inspect/cf/shots")
OUT.mkdir(parents=True, exist_ok=True)
errors = []


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(
            executable_path="/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome",
            args=["--no-sandbox", "--disable-dev-shm-usage"])
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="tr-TR")
        page = await ctx.new_page()
        page.on("console", lambda m: errors.append(f"[console.error] {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))

        # kurye (canlı Worker + D1)
        await page.goto(f"{BASE}/?dev_tg=101&dev_auth=localdev", wait_until="networkidle")
        await page.wait_for_selector(".card .row", timeout=15000)
        print("mod rozeti:", (await page.locator("#mode").inner_text()).strip())
        print("havuz satırı:", await page.locator(".card .row").count())
        print("başlık:", await page.locator("#ttl").inner_text())
        await page.screenshot(path=str(OUT / "01-kurye-havuz-canli.png"))

        # çoklu seçim + kabul
        boxes = page.locator('.card input[type="checkbox"]')
        await boxes.nth(0).check()
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(OUT / "02-kurye-secim-canli.png"))
        await page.click("#kb")
        await page.wait_for_timeout(1500)
        print("kabul sonrası sekme:", await page.locator("#ttl").inner_text())
        await page.screenshot(path=str(OUT / "03-kurye-acik-paketler-canli.png"))

        # km girişi → gerçek tarife ile canlı önizleme
        km_btn = page.locator('button[data-a="km"]').first
        if await km_btn.count():
            await km_btn.click()
            await page.wait_for_timeout(600)
            await page.fill("#kmin", "3.5")
            await page.wait_for_timeout(400)
            print("km önizleme:", await page.locator("#kpv").inner_text())
            await page.screenshot(path=str(OUT / "04-kurye-km-canli.png"))
            await page.click("#kok")
            await page.wait_for_timeout(1500)
            await page.screenshot(path=str(OUT / "05-kurye-teslim-aldim-canli.png"))
            del_btn = page.locator('button[data-a="teslim"]').first
            if await del_btn.count():
                await del_btn.click()
                await page.wait_for_timeout(1500)
                print("teslim sonrası:", await page.locator("#ttl").inner_text())
                await page.screenshot(path=str(OUT / "06-kurye-teslim-ettim-canli.png"))

        # kazanç
        await page.click('nav button[data-p="kazanc"]')
        await page.wait_for_timeout(900)
        print("kazanç:", (await page.locator("#mn").inner_text()).replace("\n", " | "))
        await page.screenshot(path=str(OUT / "07-kurye-kazanc-canli.png"))

        # restoran
        r = await ctx.new_page()
        r.on("pageerror", lambda e: errors.append(f"[restoran] {e}"))
        await r.goto(f"{BASE}/?dev_tg=201&dev_auth=localdev", wait_until="networkidle")
        await r.wait_for_timeout(1200)
        print("restoran başlığı:", await r.locator("#ttl").inner_text())
        await r.screenshot(path=str(OUT / "08-restoran-talep-canli.png"))

        # yönetici
        a = await b.new_context(viewport={"width": 1280, "height": 900}, locale="tr-TR")
        ap = await a.new_page()
        ap.on("pageerror", lambda e: errors.append(f"[admin] {e}"))
        ap.on("console", lambda m: errors.append(f"[admin console.error] {m.text}") if m.type == "error" else None)
        await ap.goto(f"{BASE}/admin.html?dev_tg=999&dev_auth=localdev", wait_until="networkidle")
        await ap.wait_for_timeout(1200)
        await ap.screenshot(path=str(OUT / "09-yonetim-ozet-canli.png"), full_page=True)
        await ap.click('#adm-nav button[data-t="tarife"]')
        await ap.wait_for_timeout(900)
        await ap.screenshot(path=str(OUT / "10-yonetim-tarife-canli.png"), full_page=True)
        await ap.click('#adm-nav button[data-t="davet"]')
        await ap.wait_for_timeout(900)
        await ap.screenshot(path=str(OUT / "11-yonetim-davet-canli.png"), full_page=True)
        await b.close()

    print("\n--- konsol hataları ---")
    print("\n".join("  " + e for e in errors) if errors else "  yok")
    return 1 if errors else 0


sys.exit(asyncio.run(main()))

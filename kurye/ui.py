def keyboard(rows):
    """(etiket, callback) veya (etiket, url) satırlarını Telegram klavyesine çevirir."""
    result = []
    for row in rows:
        buttons = []
        for label, target in row:
            if isinstance(target, str) and target.startswith("http"):
                buttons.append({"text": label, "url": target})
            else:
                buttons.append({"text": label, "callback_data": target})
        result.append(buttons)
    return {"inline_keyboard": result}

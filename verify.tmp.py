"""Throwaway: re-verify the live Players tab after the column changes."""
from playwright.sync_api import sync_playwright

URL = "https://zgreds1.github.io/givash-gals/"
res = []


def check(name, ok, detail=""):
    res.append((ok, name))
    print(("PASS  " if ok else "FAIL  ") + name + (f"  [{detail}]" if detail else ""))


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL, wait_until="networkidle")
    pg.click('nav button[data-view="players"]')
    pg.wait_for_selector("#players .controls", timeout=25000)
    pg.click('#players [data-season="2025"]')
    pg.wait_for_selector("#players tbody tr", timeout=25000)

    heads = pg.eval_on_selector_all("#players thead th", "e => e.map(x => x.textContent.trim())")
    check("headers: Saved gone, Total renamed", heads ==
          ["#", "Player", "Team", "Pos", "Owner", "GP", "Raw", "+20s", "True +20s", "Total", "PPG"],
          str(heads))

    cells = pg.eval_on_selector_all("#players tbody tr:first-child td",
                                    "e => e.map(x => x.textContent.trim())")
    check("row has 11 cells matching the header", len(cells) == len(heads), str(cells))

    tips = pg.eval_on_selector_all("#players thead th[title]",
                                   "e => e.map(x => [x.textContent.trim(), x.title])")
    check("only True +20s has a tooltip", len(tips) == 1 and tips[0][0] == "True +20s",
          str([t[0] for t in tips]))
    check("tooltip text explains it", "actually played and still scored exactly 0" in tips[0][1],
          tips[0][1][:70] + "...")

    deco = pg.eval_on_selector('#players th[title]',
                               "e => getComputedStyle(e).textDecorationStyle + ' ' + getComputedStyle(e).textDecorationLine")
    check("tooltip header is visually marked", "dotted" in deco and "underline" in deco, deco)

    notes = pg.eval_on_selector_all("#players .note", "e => e.map(x => x.textContent.trim())")
    check("standing notes are gone", notes == [], str(notes))

    # nothing regressed
    n = pg.eval_on_selector_all("#players tbody tr", "e => e.length")
    check("still 709 rows", n == 709, f"{n} rows")
    pg.click('#players th[data-k="total"]')
    pg.wait_for_timeout(300)
    tot = pg.eval_on_selector_all("#players tbody td:nth-child(10)",
                                  "e => e.slice(0,4).map(x => parseFloat(x.textContent))")
    check("Total column still sorts", tot == sorted(tot), str(tot))
    pg.click('#players [data-metric="ppg"]')
    pg.wait_for_selector("#players .stepper", timeout=10000)
    check("stepper still defaults to 1+",
          (pg.text_content("#players .stepper .readout") or "").strip() == "1+ games")
    check("no page errors", not errs, "; ".join(errs[:2]))

    pg.set_viewport_size({"width": 1280, "height": 900})
    pg.click('#players [data-metric="total"]')
    pg.wait_for_timeout(400)
    pg.screenshot(path="players-tab.png")
    b.close()

print("\n" + "=" * 58)
bad = [r for r in res if not r[0]]
print(f"{len(res) - len(bad)}/{len(res)} checks passed")
